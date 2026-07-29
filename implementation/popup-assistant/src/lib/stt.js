// Streaming speech-to-text over a raw WebSocket to Deepgram.
//
// Why a raw WebSocket (and not the SDK)? The @deepgram/sdk v5 streaming clients
// authenticate with an HTTP Authorization header, which browsers are not allowed
// to set on a WebSocket. The browser-native way to authenticate is the
// Sec-WebSocket-Protocol subprotocol, which we do here with our short-lived
// token: `new WebSocket(url, ["bearer", token])`.
//
// ── Two backends, one event shape ───────────────────────────────────────────
// English runs on Flux (/v2/listen), which emits TurnInfo events directly:
//   StartOfTurn · Update · EagerEndOfTurn · TurnResumed · EndOfTurn
// Other languages run on Nova-3 (/v1/listen), which has no turn model. For Nova
// we run a small ADAPTER (novaTurnAdapter) that watches its interim results and
// VAD/utterance events and emits the SAME TurnInfo shape. The orchestrator
// (conversation.js) consumes one vocabulary and never learns which is live.

import { DEEPGRAM_WS } from "./config.js";

/**
 * @param {object} args
 * @param {string} args.token   short-lived Deepgram token
 * @param {object} args.stt     resolved STT config from getVoiceConfig().stt
 * @returns a controller: { sendAudio, finish, close }
 */
export function connectSTT({ token, stt, onEvent, onOpen, onClose, onError }) {
  const isFlux = stt.version === "v2";

  const params = new URLSearchParams({
    model: stt.model,
    encoding: stt.encoding,
    sample_rate: String(stt.sampleRate),
  });

  // Nova-3 needs the extra streaming params that produce the signals the turn
  // adapter relies on: growing interim transcripts, a "speech started" VAD
  // event, and an utterance-end timeout that fires the end-of-turn.
  if (!isFlux) {
    params.set("language", stt.language);
    params.set("interim_results", "true");
    params.set("smart_format", "true");
    params.set("punctuate", "true");
    params.set("vad_events", "true");
    params.set("utterance_end_ms", "1000");
    params.set("endpointing", "300");
  }

  const ws = new WebSocket(`${DEEPGRAM_WS}${stt.endpoint}?${params}`, [
    "bearer",
    token,
  ]);
  ws.binaryType = "arraybuffer";

  // Nova closes the socket after ~10s with no audio. We stream audio frames
  // continuously while listening, but a KeepAlive during any lull is cheap
  // insurance. (Flux keeps the socket on its own; no KeepAlive needed.)
  let keepAlive = null;
  const startKeepAlive = () => {
    if (isFlux) return;
    keepAlive = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "KeepAlive" }));
      }
    }, 5000);
  };
  const stopKeepAlive = () => {
    if (keepAlive) clearInterval(keepAlive);
    keepAlive = null;
  };

  // For Nova, translate raw events into TurnInfo events before handing them up.
  const emit = isFlux ? onEvent : novaTurnAdapter(onEvent);

  ws.onopen = () => {
    startKeepAlive();
    onOpen?.();
  };
  // A browser's WebSocket `error` event is intentionally detail-free (no reason,
  // no status). The real diagnosis lives in the `close` frame that follows.
  ws.onerror = () =>
    console.error(
      `[STT] socket error on ${DEEPGRAM_WS}${stt.endpoint} — waiting for the ` +
        `close frame for the reason. If none follows with a code, check the ` +
        `browser Network ▸ WS tab: usually an ad blocker / privacy extension, a ` +
        `VPN/corporate proxy, or a CSP blocking wss://api.deepgram.com.`
    );
  ws.onclose = (e) => {
    stopKeepAlive();
    if (e.code !== 1000 && e.code !== 1005) {
      const detail = e.reason ? `${e.reason} (code ${e.code})` : `code ${e.code}`;
      const hint =
        e.code === 1006
          ? " — connection blocked before it reached Deepgram (browser extension/ad blocker, VPN, proxy, or CSP)"
          : "";
      console.error(`[STT] socket closed: ${detail}${hint}`);
      onError?.(new Error(`STT connection failed: ${detail}${hint}`));
    }
    onClose?.(e);
  };
  ws.onmessage = (e) => {
    // Both Flux and Nova send JSON to the client on the listen sockets.
    try {
      emit?.(JSON.parse(e.data));
    } catch {
      /* ignore non-JSON frames */
    }
  };

  return {
    /** Send one linear16 audio chunk. Never send empty frames — Deepgram treats
     *  a zero-length binary frame as a stream close. */
    sendAudio(buffer) {
      if (ws.readyState === WebSocket.OPEN && buffer.byteLength > 0) {
        ws.send(buffer);
      }
    },
    /** Flush and end the stream cleanly (Best practice #8). */
    finish() {
      if (ws.readyState === WebSocket.OPEN) {
        // Flux: CloseStream. Nova: CloseStream is also accepted to finalize.
        ws.send(JSON.stringify({ type: "CloseStream" }));
      }
    },
    close() {
      stopKeepAlive();
      try {
        ws.close();
      } catch {}
    },
  };
}

// -----------------------------------------------------------------------------
// Nova-3 → Flux-style TurnInfo adapter.
//
// Nova emits three things we care about:
//   • Results (is_final=false)  — a growing interim transcript for the utterance
//   • Results (is_final=true)   — a finalized SEGMENT; speech_final=true marks
//                                 the end of a spoken utterance
//   • UtteranceEnd              — silence-based end-of-utterance (from
//                                 utterance_end_ms), a backstop for speech_final
//   • SpeechStarted             — VAD detected speech began (vad_events=true)
//
// We reconstruct a single turn out of these: accumulate finalized segments,
// append the live interim, and fire EndOfTurn on the first of speech_final /
// UtteranceEnd. A turn "starts" on the first speech we see after silence, which
// is what lets barge-in work (the orchestrator treats StartOfTurn during
// playback as a barge-in).
// -----------------------------------------------------------------------------
function novaTurnAdapter(onEvent) {
  let turnActive = false;
  let finalText = ""; // committed segments for the in-progress turn
  let turnIndex = 0;

  const beginTurnIfNeeded = () => {
    if (turnActive) return;
    turnActive = true;
    finalText = "";
    onEvent?.({ type: "TurnInfo", event: "StartOfTurn" });
  };

  const currentTranscript = (interim = "") =>
    [finalText, interim].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

  const endTurn = () => {
    if (!turnActive) return;
    const text = currentTranscript();
    turnActive = false;
    if (!text) return; // nothing was said — don't commit an empty turn
    onEvent?.({
      type: "TurnInfo",
      event: "EndOfTurn",
      transcript: text,
      turn_index: turnIndex++,
    });
    finalText = "";
  };

  return function handleNova(msg) {
    switch (msg.type) {
      case "SpeechStarted":
        beginTurnIfNeeded();
        break;

      case "Results": {
        const alt = msg.channel?.alternatives?.[0];
        const transcript = (alt?.transcript || "").trim();

        if (transcript) beginTurnIfNeeded();

        if (msg.is_final) {
          if (transcript) {
            finalText = currentTranscript(transcript);
            onEvent?.({
              type: "TurnInfo",
              event: "Update",
              transcript: finalText,
            });
          }
          // Nova's own end-of-speech signal — commit the turn.
          if (msg.speech_final) endTurn();
        } else if (transcript) {
          // Interim: show finals-so-far plus the live tail.
          onEvent?.({
            type: "TurnInfo",
            event: "Update",
            transcript: currentTranscript(transcript),
          });
        }
        break;
      }

      case "UtteranceEnd":
        // Silence-based backstop in case speech_final never arrived.
        endTurn();
        break;

      default:
        // Metadata and anything else: ignore.
        break;
    }
  };
}
