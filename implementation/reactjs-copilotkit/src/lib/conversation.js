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
import { TTS } from "./config.js";

// The "response" seam (Best practice #11). Given the user's finished turn, it
// returns the assistant's reply (string or Promise<string>) AND may stream that
// reply chunk-by-chunk via the onChunk callback so audio can start early. The
// default just echoes so the file runs standalone; the CopilotKit example passes
// a `respond` that sends the turn through <CopilotChat> and streams the LLM's
// answer back through onChunk.
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

  function setState(next) {
    if (state === next) return;
    state = next;
    onState?.(state);
  }

  // --- barge-in ---------------------------------------------------------------
  // Abandon the in-flight response completely: stop local playback, tell Deepgram
  // to drop audio it has buffered but not yet sent, invalidate the turn so a late
  // reply is discarded, and notify the host so it can stop the LLM generating
  // (Best practice #4 — the agent stops *immediately*, brain included). NaN never
  // equals any real turn index, so a pending commitTurn() reply is guaranteed to
  // be dropped.
  function abandonResponse() {
    activeTurnIndex = Number.NaN;
    generating = false;
    outstandingFlushes = 0;
    player?.flush();
    tts?.clear();
    onResponseInterrupted?.();
  }

  // Decide whether playback for the current turn is truly finished. Because we
  // now stream TTS sentence-by-sentence, the player queue empties between
  // sentences — that's a gap, not the end. We only return to "listening" once
  // ALL of these hold: the LLM has stopped generating, every flush has been
  // acknowledged (so no more audio is coming), and the player has drained.
  function maybeSettle() {
    if (generating) return;
    if (outstandingFlushes > 0) return;
    if (player?.isPlaying) return;
    if (state === "speaking" || state === "thinking") setState("listening");
  }

  // Click-driven barge-in: the same cut-off as voice barge-in, but triggered by
  // the user pressing "Stop speaking" instead of talking. Always drops us back to
  // "listening".
  function interruptResponse() {
    if (state !== "speaking" && state !== "thinking") return;
    abandonResponse();
    setState("listening");
  }

  // --- Flux turn events -------------------------------------------------------
  function handleSTTEvent(msg) {
    if (msg.type !== "TurnInfo") return;

    switch (msg.event) {
      case "StartOfTurn":
        // The user began a new turn. If a response was in flight, that's a
        // barge-in — cut audio AND generation.
        if (state === "thinking" || state === "speaking") abandonResponse();
        currentTurn = "";
        setState("listening");
        onTranscript?.({ interim: "", committed: false });
        break;

      case "Update":
        // Interim transcription of the in-progress turn.
        currentTurn = msg.transcript || "";
        onTranscript?.({ interim: currentTurn, committed: false });
        break;

      case "EagerEndOfTurn":
        // Deepgram thinks the user *might* be done. A real app can start
        // preparing (e.g. pre-warm the LLM request) here and cancel on
        // TurnResumed. For this demo there's nothing to pre-warm.
        break;

      case "TurnResumed":
        // False alarm — the user kept talking. Cancel anything speculative.
        if (state === "thinking" || state === "speaking") abandonResponse();
        setState("listening");
        break;

      case "EndOfTurn":
        // The user is done. Commit the turn and respond.
        currentTurn = msg.transcript || currentTurn;
        onTranscript?.({ interim: currentTurn, committed: true });
        commitTurn(msg.turn_index ?? -1, currentTurn);
        break;
    }
  }

  async function commitTurn(turnIndex, text) {
    const clean = (text || "").trim();
    if (!clean) {
      setState("listening");
      return;
    }
    activeTurnIndex = turnIndex;
    setState("thinking");
    generating = true;

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
      if (activeTurnIndex !== turnIndex) return;
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

      tts = connectTTS({
        token,
        onAudio: (buf) => player.enqueue(buf),
        // Deepgram acks each Flush with a "Flushed" once it has sent all the
        // audio for it. That's how we know the last sentence's audio is in the
        // player and the turn can settle.
        onControl: (msg) => {
          if (msg?.type === "Flushed" && outstandingFlushes > 0) {
            outstandingFlushes--;
            maybeSettle();
          }
        },
        onError: (e) => onError?.(e),
      });

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
