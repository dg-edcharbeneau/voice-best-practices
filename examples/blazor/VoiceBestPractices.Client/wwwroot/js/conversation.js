// The conversation orchestrator — the state machine that defines the voice UI's
// *behavior*. This is where the best practices come together, and it is
// deliberately identical in spirit to the React example's src/lib/conversation.js.
//
// The repo's thesis: the realtime machinery is framework-agnostic. Blazor, like
// React, owns only the *edges* — turning these callbacks into UI state (see
// voice-interop.js and ConversationInterop.cs). The state machine itself does
// not know or care that a .NET runtime is on the other side.
//
// States (Best practice #2 — one explicit source of truth):
//   idle       - not connected; nothing captured
//   connecting - opening sockets / acquiring mic
//   listening  - mic live, waiting for or hearing the user
//   thinking   - user's turn ended; producing a response
//   speaking   - TTS audio is playing back
//   error      - something failed; surfaced to the user
//
// Turn-taking + barge-in (Best practices #3, #4) are driven by Flux TurnInfo
// events. See handleSTTEvent below.

import { getToken } from "./token.js";
import { startMic } from "./mic.js";
import { connectSTT } from "./stt.js";
import { connectTTS } from "./tts.js";
import { createPlayer } from "./player.js";
import { createDiagnosticStamp } from "./diagnostics.js";
import { TTS } from "./config.js";
import { echoResponder } from "./respond.js";

// `respond` is the "brain" seam (see respond.js). It defaults to echo; the bridge
// (voice-interop.js) can pass llmResponder instead to route turns through the
// server-side LLM. A responder may return a string to speak, or stream speech
// itself via the { speak, flush } sink and honour the { signal } for barge-in.
export function createConversation({
  onState,
  onTranscript,
  onLevel,
  onError,
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
  // AbortController for the response currently being produced, if any. Aborting
  // it cancels an in-flight LLM request (and its server-side generation).
  let responseAbort = null;
  // True while a response is still being produced/streamed. While it's true, a
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
  // Called when the user starts talking while the agent is (or is about to be)
  // speaking. Stop playback locally AND tell the server to drop queued audio.
  // Done here in JS at the point of detection so the cut-off is instant
  // (Best practice #4 — barge-in is non-negotiable).
  //
  // `reason` is diagnostics-only: which of the three triggers fired (a new turn,
  // a resumed turn, or the Stop speaking button). It's worth knowing which one
  // cut the agent off, because "the user talked over it" and "the user gave up
  // and clicked" are very different signals.
  function interrupt(reason) {
    if (state !== "speaking" && state !== "thinking") return;
    const cutState = state;
    const cutTurn = activeTurnIndex;
    // Cancel any response still being produced (stops the LLM stream), then kill
    // audio that's already playing. Both halves matter: (1) stop more text/audio
    // arriving, (2) stop what's already in the speakers. Invalidating the turn
    // and clearing the flush counters guarantees a late reply — and any sentence
    // still streaming in through the sink — is dropped.
    activeTurnIndex = Number.NaN;
    generating = false;
    // Flushes for the abandoned turn will still be acked; zeroing the counter is
    // what makes those late "Flushed" messages harmless (see onControl below).
    const droppedFlushes = outstandingFlushes;
    outstandingFlushes = 0;
    lastSettleBlock = null;
    const aborted = responseAbort !== null;
    responseAbort?.abort();
    // Read how much the listener actually heard BEFORE flushing — flush() resets
    // the player's timeline, and Flux TTS wants that offset to record where the
    // turn was cut. (The v1 Aura path ignores it.)
    const heardMs = player?.playedMs ?? 0;
    player?.flush();
    tts?.interrupt(heardMs);
    // The endpoint tells you which wire message just went out: /v2/speak sends
    // Interrupt + playback_offset (and answers with SpeechInterrupted), /v1/speak
    // sends a bare Clear and reports nothing back. "response aborted" means the
    // responder was still producing — with llmResponder, the LLM request is
    // cancelled server-side too.
    diag(
      "barge-in",
      `cut ${cutState} @${Math.round(heardMs)}ms`,
      `via ${reason} · turn #${Number.isNaN(cutTurn) ? "—" : cutTurn} abandoned · ` +
        `${droppedFlushes} flush(es) dropped · ` +
        `${aborted ? "response aborted · " : ""}${tts?.endpoint ?? "no socket"}`
    );
  }

  // Decide whether playback for the current turn is truly finished. Because a
  // responder streams TTS sentence-by-sentence, the player queue empties between
  // sentences — that's a gap, not the end. We only return to "listening" once
  // ALL of these hold: the responder has stopped generating, every flush has
  // been acknowledged (so no more audio is coming), and the player has drained.
  //
  // This is the counterpart to EndOfTurn: EOT ends the *user's* turn, this ends
  // the *agent's*. When the UI seems stuck on "speaking", the diagnostic below
  // names the exact latch still holding it there.
  function maybeSettle() {
    const blocked = generating
      ? "responder still generating"
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
  // the user pressing a Stop button instead of speaking. Unlike interrupt(), it
  // also abandons a reply that's still being produced ("thinking") — there's no
  // incoming turn to invalidate it, so we do it here — and always drops us back
  // to "listening". NaN never equals any real turn index, so a pending
  // commitTurn() reply is guaranteed to be discarded.
  function interruptResponse() {
    if (state !== "speaking" && state !== "thinking") return;
    interrupt("stop-button");
    setState("listening");
  }

  // --- Flux turn events -------------------------------------------------------
  function handleSTTEvent(msg) {
    if (msg.type !== "TurnInfo") return;

    switch (msg.event) {
      case "StartOfTurn":
        // The user began a new turn. If the agent was talking, cut it off.
        diag("turn", `StartOfTurn #${msg.turn_index ?? "?"}`);
        interrupt("StartOfTurn");
        currentTurn = "";
        setState("listening");
        onTranscript?.({ interim: "", committed: false });
        break;

      case "Update":
        // Interim transcription of the in-progress turn. Deliberately *not*
        // diagnosed: Update fires every few words and would bury every other
        // event. Watch the interim transcript line instead.
        currentTurn = msg.transcript || "";
        onTranscript?.({ interim: currentTurn, committed: false });
        break;

      case "EagerEndOfTurn":
        // Deepgram thinks the user *might* be done. A real app can start
        // preparing (e.g. fire the LLM request) here and cancel on TurnResumed.
        // For the echo demo there's nothing to pre-warm — but the diagnostic
        // shows how much of a head start the eager signal would have bought.
        diag("turn", `EagerEndOfTurn #${msg.turn_index ?? "?"}`, "nothing pre-warmed in this demo");
        break;

      case "TurnResumed":
        // False alarm — the user kept talking. Cancel anything we started
        // speaking speculatively.
        diag("turn", `TurnResumed #${msg.turn_index ?? "?"}`, "eager end was a false alarm");
        interrupt("TurnResumed");
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
      diag("turn", `turn #${turnIndex} dropped`, "empty transcript — nothing to respond to");
      setState("listening");
      return;
    }
    activeTurnIndex = turnIndex;
    setState("thinking");
    generating = true;
    // Fresh turn, fresh settle bookkeeping — its first latch should always log.
    lastSettleBlock = null;

    // Fresh abort controller for this response so barge-in can cancel it.
    const controller = new AbortController();
    responseAbort = controller;

    // Text queued with speak() since the last flush — diagnostics-only, so each
    // Speak + Flush row can show the unit of speech it sent.
    let queued = "";
    const speak = (t) => {
      tts?.speak(t);
      queued += queued ? ` ${t}` : t;
    };

    // Every flush is one unit of audio still owed to us — count it so
    // maybeSettle() knows the turn isn't over just because the player ran dry
    // between sentences. Deepgram acks each flush with a "Flushed" (see below).
    const countedFlush = () => {
      if (activeTurnIndex !== turnIndex) return;
      tts?.flush();
      outstandingFlushes++;
      // One row per speakable unit makes the streaming granularity visible —
      // whether audio started on the first sentence or waited for the whole
      // reply.
      diag("tts", `Speak + Flush (${outstandingFlushes} outstanding)`, JSON.stringify(queued));
      queued = "";
    };

    try {
      const reply = await respond(clean, {
        signal: controller.signal,
        speak,
        flush: countedFlush,
      });
      // If the user barged in while we were "thinking", abandon this reply.
      if (activeTurnIndex !== turnIndex) {
        diag(
          "barge-in",
          `reply abandoned (turn #${turnIndex})`,
          "turn-index guard dropped a response that finished after the barge-in"
        );
        return;
      }
      // A responder either returns a string to speak, or streamed it itself via
      // the sink above (and returned nothing).
      if (typeof reply === "string" && reply.trim()) {
        speak(reply);
        countedFlush();
      }
      // player.onStart flips us to "speaking"; maybeSettle() returns us to
      // "listening" once generation is done and all audio has played.
    } catch (err) {
      // A barge-in aborts the request on purpose — not an error to surface.
      if (err?.name === "AbortError") return;
      onError?.(err);
      setState("listening");
    } finally {
      if (responseAbort === controller) responseAbort = null;
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
              // A flush for an abandoned turn. interrupt() zeroed the counter,
              // so this ack is correctly ignored — it must not settle a turn
              // that barge-in already ended.
              diag("tts", "Flushed ignored", "late ack for a barged-in turn");
            }
            return;
          }
          // Flux TTS answers an Interrupt with an exact account of what the
          // listener did and didn't hear. That reconciliation is the whole
          // reason we send playback_offset — surface it (Best practice #4).
          if (msg?.type === "SpeechInterrupted") {
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
    responseAbort?.abort();
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
    responseAbort = null;
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
