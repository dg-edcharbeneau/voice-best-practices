// The conversation orchestrator — the state machine that defines the voice UI's
// *behavior*. This is where the best practices come together.
//
// States (Best practice #2 — one explicit source of truth):
//   idle       - not connected; nothing captured
//   connecting - opening sockets / acquiring mic
//   listening  - mic live, waiting for or hearing the user
//   thinking   - user's turn ended; the LLM is producing a response
//   speaking   - TTS audio is playing back
//   error      - something failed; surfaced to the user
//
// Turn-taking + barge-in (Best practices #3, #4) are driven by Flux TurnInfo
// events. See handleSTTEvent below.
//
// ── What differs from ../../../reactjs ──────────────────────────────────────
// This file is the vanilla/React orchestrator with ONE integration seam added
// for CopilotKit: `onResponseInterrupted`. In the plain examples, barge-in only
// has to stop *audio*. Here the "brain" is a remote LLM streaming through the
// CopilotKit runtime, so barge-in must also stop *generation* — otherwise the
// model keeps talking into a room no one is listening to. The React layer wires
// `onResponseInterrupted` to CopilotKit's `stopGeneration()`. Everything else —
// the `respond` seam, the state machine, capture, playback — is unchanged.

import { getToken } from "./token.js";
import { startMic } from "./mic.js";
import { connectSTT } from "./stt.js";
import { connectTTS } from "./tts.js";
import { createPlayer } from "./player.js";
import { createDiagnosticStamp } from "./diagnostics.js";
import { TTS } from "./config.js";

// The "response" seam (Best practice #11). Given the user's finished turn, return
// the assistant's reply (string or Promise<string>). The default just echoes so
// the file runs standalone; the CopilotKit example passes a `respond` that sends
// the turn through <CopilotChat> and resolves with the LLM's answer.
const echoResponder = (finalTranscript) => finalTranscript;

// If a run of text arrives with no sentence boundary (a long list, a code
// block, a rambling clause), don't sit on it forever — flush at a word break
// once the buffer passes this length so audio keeps flowing.
const MAX_SPEAK_BUFFER = 240;

// Pull complete sentences out of a growing text buffer. A sentence ends at
// . ! ? … or a newline. While text is still streaming we only cut at a
// terminator that is *followed by whitespace*, so mid-token boundaries like
// "3.14" or "v1.2" aren't split. Returns the finished sentences plus the
// not-yet-complete remainder to carry into the next chunk.
function extractSentences(buf) {
  const sentences = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    const isTerminator = c === "." || c === "!" || c === "?" || c === "…";
    if (c === "\n" || isTerminator) {
      const next = buf[i + 1];
      // A newline is always a hard break; a terminator only counts once we can
      // see it's followed by whitespace (otherwise wait for the next chunk).
      if (c === "\n" || (next !== undefined && /\s/.test(next))) {
        const piece = buf.slice(start, i + 1).trim();
        if (piece) sentences.push(piece);
        start = i + 1;
      }
    }
  }
  return { sentences, rest: buf.slice(start) };
}

export function createConversation({
  onState,
  onTranscript,
  onLevel,
  onOutputLevel,
  onError,
  onResponseInterrupted,
  onSpeechCut,
  onDiagnostic,
  respond = echoResponder,
}) {
  let state = "idle";
  let mic = null;
  let stt = null;
  let tts = null;
  let player = null;

  // Tracks the transcript of the turn currently in progress.
  let currentTurn = "";
  // Guards against a late response being spoken after the user barged in.
  let activeTurnIndex = -1;
  // True while the LLM is still streaming this turn's reply. While it's true, a
  // drained audio queue is just a gap between sentences — not the end of the
  // turn — so we don't fall back to "listening" yet.
  let generating = false;
  // Flushes sent to TTS but not yet acknowledged with a "Flushed" control
  // message. Non-zero means more audio for this turn is still on its way, even
  // if the player has momentarily run dry.
  let outstandingFlushes = 0;

  // Stamps each diagnostic with a sequence number and a session-relative
  // timestamp. Recreated per session in start() so the trace restarts at +0.00s.
  let stamp = createDiagnosticStamp();
  // Last reason maybeSettle() declined to settle, so it can log a change rather
  // than repeating itself on every check.
  let lastSettleBlock = null;
  // The most recent barge-in, so the SpeechInterrupted that arrives a moment
  // later can be attributed to the same cut.
  let lastCut = null;

  /** Emit one diagnostic event. A no-op when nobody is listening. */
  function diag(channel, label, detail) {
    if (!onDiagnostic) return;
    onDiagnostic(stamp(channel, label, detail));
  }

  function setState(next) {
    if (state === next) return;
    const prev = state;
    state = next;
    diag("state", `${prev} → ${next}`);
    onState?.(state);
  }

  // --- barge-in ---------------------------------------------------------------
  // Abandon the in-flight response completely: stop local playback, tell Deepgram
  // to drop audio it has buffered but not yet sent, invalidate the turn so a late
  // reply is discarded, and notify the host so it can stop the LLM generating
  // (Best practice #4 — the agent stops *immediately*, brain included). NaN never
  // equals any real turn index, so a pending commitTurn() reply is guaranteed to
  // be dropped.
  //
  // `reason` is diagnostics-only: which of the three triggers fired (a new turn,
  // a resumed turn, or the barge-in button). It's worth knowing which one cut the
  // agent off, because "the user talked over it" and "the user gave up and
  // clicked" are very different signals.
  function abandonResponse(reason) {
    const cutState = state;
    const cutTurn = activeTurnIndex;
    activeTurnIndex = Number.NaN;
    generating = false;
    // Flushes for the abandoned turn will still be acked; zeroing the counter is
    // what makes those late "Flushed" messages harmless (see onControl below).
    const droppedFlushes = outstandingFlushes;
    outstandingFlushes = 0;
    lastSettleBlock = null;
    // Read how much the listener actually heard BEFORE flushing — flush() resets
    // the player's timeline, and Flux TTS wants that offset to record where the
    // turn was cut. (The v1 Aura path ignores it.)
    const heardMs = player?.playedMs ?? 0;
    player?.flush();
    tts?.interrupt(heardMs);
    onResponseInterrupted?.();
    // Tell the UI a cut happened *now*, with only what we know locally. The v1
    // Aura endpoint never answers an interrupt, so this is all it will ever get;
    // on /v2/speak the SpeechInterrupted below refines it with exact text.
    lastCut = { turnIndex: cutTurn, heardMs: Math.round(heardMs) };
    onSpeechCut?.({ ...lastCut });
    // The endpoint tells you which wire message just went out: /v2/speak sends
    // Interrupt + playback_offset (and answers with SpeechInterrupted), /v1/speak
    // sends a bare Clear and reports nothing back. Unlike the plain examples this
    // also aborts the LLM request — audio and brain stop together.
    diag(
      "barge-in",
      `cut ${cutState} @${Math.round(heardMs)}ms`,
      `via ${reason} · turn #${Number.isNaN(cutTurn) ? "—" : cutTurn} abandoned · ` +
        `${droppedFlushes} flush(es) dropped · LLM request aborted · ` +
        `${tts?.endpoint ?? "no socket"}`
    );
  }

  // Decide whether playback for the current turn is truly finished. Because we
  // now stream TTS sentence-by-sentence, the player queue empties between
  // sentences — that's a gap, not the end. We only return to "listening" once
  // ALL of these hold: the LLM has stopped generating, every flush has been
  // acknowledged (so no more audio is coming), and the player has drained.
  // This is the counterpart to EndOfTurn: EOT ends the *user's* turn, this ends
  // the *agent's*. When the UI seems stuck on "speaking", the diagnostic below
  // names the exact latch still holding it there.
  function maybeSettle() {
    const blocked = generating
      ? "LLM still generating"
      : outstandingFlushes > 0
        ? `${outstandingFlushes} flush(es) outstanding`
        : player?.isPlaying
          ? "player still draining"
          : null;

    if (blocked) {
      // maybeSettle() runs on every Flushed ack and every player drain, so only
      // log when the answer actually changes — otherwise a multi-sentence reply
      // buries the trace in identical rows.
      if (blocked !== lastSettleBlock) diag("turn", "not settled", blocked);
      lastSettleBlock = blocked;
      return;
    }

    lastSettleBlock = null;
    if (state === "speaking" || state === "thinking") {
      diag("turn", "turn settled", "generation done, flushes acked, player drained");
      setState("listening");
    }
  }

  // Click-driven barge-in: the same cut-off as voice barge-in, but triggered by
  // the user pressing "Stop speaking" instead of talking. Always drops us back to
  // "listening".
  function interruptResponse() {
    if (state !== "speaking" && state !== "thinking") return;
    abandonResponse("barge-in button");
    setState("listening");
  }

  // --- Flux turn events -------------------------------------------------------
  function handleSTTEvent(msg) {
    if (msg.type !== "TurnInfo") return;

    switch (msg.event) {
      case "StartOfTurn":
        // The user began a new turn. If a response was in flight, that's a
        // barge-in — cut audio AND generation.
        diag("turn", `StartOfTurn #${msg.turn_index ?? "?"}`);
        if (state === "thinking" || state === "speaking") abandonResponse("StartOfTurn");
        currentTurn = "";
        setState("listening");
        onTranscript?.({ interim: "", committed: false });
        break;

      case "Update":
        // Interim transcription of the in-progress turn. Deliberately *not*
        // diagnosed: Update fires every few words and would bury every other
        // event. Watch the ghost interim bubble in the chat instead.
        currentTurn = msg.transcript || "";
        onTranscript?.({ interim: currentTurn, committed: false });
        break;

      case "EagerEndOfTurn":
        // Deepgram thinks the user *might* be done. A real app can start
        // preparing (e.g. pre-warm the LLM request) here and cancel on
        // TurnResumed. For this demo there's nothing to pre-warm — but the
        // diagnostic shows how much of a head start it would have bought.
        diag("turn", `EagerEndOfTurn #${msg.turn_index ?? "?"}`, "nothing pre-warmed in this demo");
        break;

      case "TurnResumed":
        // False alarm — the user kept talking. Cancel anything speculative.
        diag("turn", `TurnResumed #${msg.turn_index ?? "?"}`, "eager end was a false alarm");
        if (state === "thinking" || state === "speaking") abandonResponse("TurnResumed");
        setState("listening");
        break;

      case "EndOfTurn":
        // The user is done. Commit the turn and respond.
        currentTurn = msg.transcript || currentTurn;
        diag("turn", `EndOfTurn #${msg.turn_index ?? "?"}`, JSON.stringify(currentTurn));
        onTranscript?.({ interim: currentTurn, committed: true });
        commitTurn(msg.turn_index ?? -1, currentTurn);
        break;
    }
  }

  async function commitTurn(turnIndex, text) {
    const clean = (text || "").trim();
    if (!clean) {
      diag("turn", `turn #${turnIndex} dropped`, "empty transcript — nothing to send to the LLM");
      setState("listening");
      return;
    }
    activeTurnIndex = turnIndex;
    setState("thinking");
    generating = true;
    // Fresh turn, fresh settle bookkeeping — its first latch should always log.
    lastSettleBlock = null;

    // Buffer streamed text and hand TTS one sentence at a time, so audio starts
    // as soon as the first sentence is ready instead of after the whole reply
    // finishes. Each sentence is a Speak + Flush; new chunks only ever *append*
    // audio — they never cut off what's already playing. Only a barge-in does
    // that (see abandonResponse).
    let pending = "";
    let streamed = false;

    // Send one speakable unit to TTS and count the flush so maybeSettle() knows
    // audio is still outstanding. Guards against speaking into a barged-in turn.
    const speak = (piece) => {
      const t = (piece || "").trim();
      if (!t || activeTurnIndex !== turnIndex) return;
      tts?.speak(t);
      tts?.flush();
      outstandingFlushes++;
      // One row per speakable unit makes the streaming granularity visible —
      // whether audio started on the first sentence or waited for the whole
      // reply. (The per-chunk guard in onChunk is *not* diagnosed; it fires far
      // too often to be readable.)
      diag("tts", `Speak + Flush (${outstandingFlushes} outstanding)`, JSON.stringify(t));
    };

    // Each streamed chunk: append, speak any newly-complete sentences, and keep
    // the trailing partial sentence for next time. The player flips us to
    // "speaking" as the first sentence's audio arrives.
    const onChunk = (chunk) => {
      if (activeTurnIndex !== turnIndex) return;
      streamed = true;
      pending += chunk;
      const { sentences, rest } = extractSentences(pending);
      pending = rest;
      for (const s of sentences) speak(s);
      // Long unpunctuated run: flush at the last word break so we don't stall.
      if (pending.length > MAX_SPEAK_BUFFER) {
        const cut = pending.lastIndexOf(" ");
        if (cut > 0) {
          speak(pending.slice(0, cut));
          pending = pending.slice(cut + 1);
        }
      }
    };

    try {
      const reply = await respond(clean, onChunk);
      // If the user barged in while we were generating, abandon this reply.
      if (activeTurnIndex !== turnIndex) {
        diag(
          "barge-in",
          `reply abandoned (turn #${turnIndex})`,
          "turn-index guard dropped a response that finished after the barge-in"
        );
        return;
      }
      // Speak whatever's left: the streamed tail, or — for a non-streaming
      // responder that never called onChunk — the whole reply at once.
      speak(streamed ? pending : reply);
    } catch (err) {
      onError?.(err);
      setState("listening");
    } finally {
      // Only clear generating if this is still the active turn; a barge-in may
      // have already started a new one that now owns the flag.
      if (activeTurnIndex === turnIndex) {
        generating = false;
        maybeSettle();
      }
    }
  }

  // --- lifecycle --------------------------------------------------------------
  async function start() {
    if (state !== "idle" && state !== "error") return;
    // Restart the trace so timestamps read as "time since this session began".
    stamp = createDiagnosticStamp();
    setState("connecting");
    try {
      const token = await getToken();

      player = createPlayer({
        sampleRate: TTS.sampleRate,
        // Ignore stray audio that lands after a barge-in (activeTurnIndex is
        // NaN then); otherwise the first chunk of a sentence flips us to
        // "speaking". Fires once per sentence, but setState is idempotent.
        onStart: () => {
          if (!Number.isNaN(activeTurnIndex)) setState("speaking");
        },
        // The queue drains between sentences while we're still streaming, so we
        // can't treat "empty" as "done" — maybeSettle() decides.
        onEnd: () => maybeSettle(),
        // Playback loudness, for the "agent is speaking" effect in the UI.
        onLevel: (l) => onOutputLevel?.(l),
      });
      // Resume the audio context from within the click that called start().
      await player.resume();

      // One socket for the whole session, not one per turn: Flux TTS keeps its
      // acoustic state on the connection, so reconnecting between turns would
      // throw away cross-turn context and restart the voice cold (#12).
      tts = connectTTS({
        token,
        onAudio: (buf) => player.enqueue(buf),
        // Deepgram acks each Flush with a "Flushed" once it has sent all the
        // audio for it. That's how we know the last sentence's audio is in the
        // player and the turn can settle.
        onControl: (msg) => {
          if (msg?.type === "Flushed") {
            if (outstandingFlushes > 0) {
              outstandingFlushes--;
              diag("tts", `Flushed (${outstandingFlushes} outstanding)`);
              maybeSettle();
            } else {
              // A flush for an abandoned turn. abandonResponse() zeroed the
              // counter, so this ack is correctly ignored — it must not settle a
              // turn that barge-in already ended.
              diag("tts", "Flushed ignored", "late ack for a barged-in turn");
            }
            return;
          }
          // Flux TTS answers an Interrupt with an exact account of what the
          // listener did and didn't hear. That reconciliation is the whole reason
          // we send playback_offset, and here it also tells you what the chat
          // history should record as actually spoken (Best practice #4).
          if (msg?.type === "SpeechInterrupted") {
            // The authoritative account of what the listener heard. Hand it to
            // the UI so the chat can show the reply as it was actually received.
            onSpeechCut?.({
              ...(lastCut ?? {}),
              spoken: msg.text_spoken ?? "",
              remaining: msg.text_remaining ?? "",
            });
            diag(
              "barge-in",
              "SpeechInterrupted",
              `spoken: ${JSON.stringify(msg.text_spoken ?? "")} · ` +
                `remaining: ${JSON.stringify(msg.text_remaining ?? "")}`
            );
            return;
          }
          if (msg?.type === "Warning") {
            diag("tts", "Warning", msg.description || msg.message || "");
          }
        },
        onError: (e) => onError?.(e),
      });
      // Header row for the trace: which TTS generation this session is on
      // decides whether barge-in reports SpeechInterrupted at all.
      diag("tts", `socket open ${tts.endpoint}`, `voice ${TTS.model} @ ${TTS.sampleRate} Hz`);

      stt = connectSTT({
        token,
        onEvent: handleSTTEvent,
        onError: (e) => onError?.(e),
        onClose: () => {
          if (state !== "idle") stop();
        },
      });

      mic = await startMic({
        onFrame: (buf) => stt?.sendAudio(buf),
        onLevel: (lvl) => onLevel?.(lvl),
      });

      setState("listening");
    } catch (err) {
      onError?.(err);
      setState("error");
      await stop();
    }
  }

  async function stop() {
    // Full teardown (Best practice #8). Order matters: stop capturing first.
    mic?.stop();
    stt?.finish();
    stt?.close();
    tts?.close();
    player?.close();
    mic = stt = tts = player = null;
    currentTurn = "";
    activeTurnIndex = -1;
    generating = false;
    outstandingFlushes = 0;
    lastSettleBlock = null;
    lastCut = null;
    setState("idle");
  }

  return {
    start,
    stop,
    interruptResponse,
    get state() {
      return state;
    },
  };
}
