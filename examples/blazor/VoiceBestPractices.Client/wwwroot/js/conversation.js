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
import { TTS } from "./config.js";
import { echoResponder } from "./respond.js";

// `respond` is the "brain" seam (see respond.js). It defaults to echo; the bridge
// (voice-interop.js) can pass llmResponder instead to route turns through the
// server-side LLM. A responder may return a string to speak, or stream speech
// itself via the { speak, flush } sink and honour the { signal } for barge-in.
export function createConversation({ onState, onTranscript, onLevel, onError, respond = echoResponder }) {
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

  function setState(next) {
    if (state === next) return;
    state = next;
    onState?.(state);
  }

  // --- barge-in ---------------------------------------------------------------
  // Called when the user starts talking while the agent is (or is about to be)
  // speaking. Stop playback locally AND tell the server to drop queued audio.
  // Done here in JS at the point of detection so the cut-off is instant
  // (Best practice #4 — barge-in is non-negotiable).
  function interrupt() {
    if (state !== "speaking" && state !== "thinking") return;
    // Cancel any response still being produced (stops the LLM stream), then kill
    // audio that's already playing. Both halves matter: (1) stop more text/audio
    // arriving, (2) stop what's already in the speakers. Invalidating the turn
    // and clearing the flush counters guarantees a late reply — and any sentence
    // still streaming in through the sink — is dropped.
    activeTurnIndex = Number.NaN;
    generating = false;
    outstandingFlushes = 0;
    responseAbort?.abort();
    player?.flush();
    tts?.clear();
  }

  // Decide whether playback for the current turn is truly finished. Because a
  // responder streams TTS sentence-by-sentence, the player queue empties between
  // sentences — that's a gap, not the end. We only return to "listening" once
  // ALL of these hold: the responder has stopped generating, every flush has
  // been acknowledged (so no more audio is coming), and the player has drained.
  function maybeSettle() {
    if (generating) return;
    if (outstandingFlushes > 0) return;
    if (player?.isPlaying) return;
    if (state === "speaking" || state === "thinking") setState("listening");
  }

  // Click-driven barge-in: the same cut-off as voice barge-in, but triggered by
  // the user pressing a Stop button instead of speaking. Unlike interrupt(), it
  // also abandons a reply that's still being produced ("thinking") — there's no
  // incoming turn to invalidate it, so we do it here — and always drops us back
  // to "listening". NaN never equals any real turn index, so a pending
  // commitTurn() reply is guaranteed to be discarded.
  function interruptResponse() {
    if (state !== "speaking" && state !== "thinking") return;
    interrupt();
    setState("listening");
  }

  // --- Flux turn events -------------------------------------------------------
  function handleSTTEvent(msg) {
    if (msg.type !== "TurnInfo") return;

    switch (msg.event) {
      case "StartOfTurn":
        // The user began a new turn. If the agent was talking, cut it off.
        interrupt();
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
        // preparing (e.g. fire the LLM request) here and cancel on TurnResumed.
        // For the echo demo there's nothing to pre-warm.
        break;

      case "TurnResumed":
        // False alarm — the user kept talking. Cancel anything we started
        // speaking speculatively.
        interrupt();
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

    // Fresh abort controller for this response so barge-in can cancel it.
    const controller = new AbortController();
    responseAbort = controller;

    // Every flush is one unit of audio still owed to us — count it so
    // maybeSettle() knows the turn isn't over just because the player ran dry
    // between sentences. Deepgram acks each flush with a "Flushed" (see below).
    const countedFlush = () => {
      if (activeTurnIndex !== turnIndex) return;
      tts?.flush();
      outstandingFlushes++;
    };

    try {
      const reply = await respond(clean, {
        signal: controller.signal,
        speak: (t) => tts?.speak(t),
        flush: countedFlush,
      });
      // If the user barged in while we were "thinking", abandon this reply.
      if (activeTurnIndex !== turnIndex) return;
      // A responder either returns a string to speak, or streamed it itself via
      // the sink above (and returned nothing).
      if (typeof reply === "string" && reply.trim()) {
        tts?.speak(reply);
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
