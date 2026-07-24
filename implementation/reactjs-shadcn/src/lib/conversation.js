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

// The "response" seam (Best practice #11). Given the user's finished turn, return
// the assistant's reply (string or Promise<string>). The default just echoes so
// the file runs standalone; the CopilotKit example passes a `respond` that sends
// the turn through <CopilotChat> and resolves with the LLM's answer.
const echoResponder = (finalTranscript) => finalTranscript;

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
    player?.flush();
    tts?.clear();
    onResponseInterrupted?.();
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
    try {
      const reply = await respond(clean);
      // If the user barged in while we were "thinking", abandon this reply.
      if (activeTurnIndex !== turnIndex) return;
      tts?.speak(reply);
      tts?.flush();
      // player.onStart flips us to "speaking"; player.onEnd returns to "listening".
    } catch (err) {
      onError?.(err);
      setState("listening");
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
        onStart: () => setState("speaking"),
        onEnd: () => {
          // Only fall back to listening if we're not mid-interruption.
          if (state === "speaking" || state === "thinking") setState("listening");
        },
        // Playback loudness, for the "agent is speaking" effect in the UI.
        onLevel: (l) => onOutputLevel?.(l),
      });
      // Resume the audio context from within the click that called start().
      await player.resume();

      tts = connectTTS({
        token,
        onAudio: (buf) => player.enqueue(buf),
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
