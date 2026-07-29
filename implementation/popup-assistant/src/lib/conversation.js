// The conversation orchestrator — the state machine that defines the voice UI's
// *behavior*. This is where the best practices come together.
//
// States (Best practice #2 — one explicit source of truth):
//   idle       - not connected; nothing captured
//   connecting - opening sockets / acquiring mic
//   listening  - mic live, waiting for or hearing the user
//   thinking   - user's turn ended; the "brain" is producing a response
//   speaking   - TTS audio is playing back
//   error      - something failed; surfaced to the user
//
// Turn-taking + barge-in (Best practices #3, #4) are driven by TurnInfo events.
// English gets them straight from Flux; other languages get an equivalent
// stream synthesized from Nova-3 (see stt.js). Either way this file only ever
// sees TurnInfo — it does not know or care which STT backend is live.
//
// The only per-language knob here is which STT model + Aura-2 voice to connect,
// resolved from getVoiceConfig(language) at start() time. Switching language
// means stop() then start(newLanguage) — you can't swap models on a live socket.

import { getToken } from "./token.js";
import { startMic } from "./mic.js";
import { connectSTT } from "./stt.js";
import { connectTTS } from "./tts.js";
import { createPlayer } from "./player.js";
import { getVoiceConfig, DEFAULT_LANGUAGE } from "./config.js";

// The "response" seam (Best practice #11). Given the user's finished turn, return
// the assistant's reply (string or Promise<string>). The default just echoes so
// the file runs standalone; the app passes a `respond` that sends the turn to
// the chat "brain" and resolves with its answer.
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
  language = DEFAULT_LANGUAGE,
}) {
  let state = "idle";
  let currentLanguage = language;
  let mic = null;
  let stt = null;
  let tts = null;
  let player = null;

  // Tracks the transcript of the turn currently in progress.
  let currentTurn = "";
  // Guards against a late response being spoken after the user barged in.
  let activeTurnIndex = -1;
  // True while the "brain" is still streaming this turn's reply. While it's
  // true, a drained audio queue is just a gap between sentences — not the end of
  // the turn — so we don't fall back to "listening" yet.
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
  // reply is discarded, and notify the host so it can stop the brain generating
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
  // stream TTS sentence-by-sentence, the player queue empties between sentences
  // — that's a gap, not the end. We only return to "listening" once ALL of these
  // hold: generation stopped, every flush acknowledged (no more audio coming),
  // and the player has drained.
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

  // --- TurnInfo events (Flux, or Nova-3 normalized) ---------------------------
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
        // Deepgram thinks the user *might* be done. A real app could pre-warm a
        // request here and cancel on TurnResumed. Nothing to pre-warm here.
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

    const speak = (piece) => {
      const t = (piece || "").trim();
      if (!t || activeTurnIndex !== turnIndex) return;
      tts?.speak(t);
      tts?.flush();
      outstandingFlushes++;
    };

    const onChunk = (chunk) => {
      if (activeTurnIndex !== turnIndex) return;
      streamed = true;
      pending += chunk;
      const { sentences, rest } = extractSentences(pending);
      pending = rest;
      for (const s of sentences) speak(s);
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
      if (activeTurnIndex !== turnIndex) return;
      speak(streamed ? pending : reply);
    } catch (err) {
      onError?.(err);
      setState("listening");
    } finally {
      if (activeTurnIndex === turnIndex) {
        generating = false;
        maybeSettle();
      }
    }
  }

  // --- lifecycle --------------------------------------------------------------
  async function start(nextLanguage = currentLanguage) {
    if (state !== "idle" && state !== "error") return;
    currentLanguage = nextLanguage;
    const cfg = getVoiceConfig(currentLanguage);
    setState("connecting");
    try {
      const token = await getToken();

      player = createPlayer({
        sampleRate: cfg.tts.sampleRate,
        onStart: () => {
          if (!Number.isNaN(activeTurnIndex)) setState("speaking");
        },
        onEnd: () => maybeSettle(),
        onLevel: (l) => onOutputLevel?.(l),
      });
      // Resume the audio context from within the click that called start().
      await player.resume();

      tts = connectTTS({
        token,
        tts: cfg.tts,
        onAudio: (buf) => player.enqueue(buf),
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
        stt: cfg.stt,
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
    get language() {
      return currentLanguage;
    },
  };
}
