// Streaming text-to-speech over a raw WebSocket to Deepgram Speak (/v1/speak).
//
// Same auth story as STT: browser-native subprotocol auth with a short-lived
// token. We use a raw WebSocket here for a second reason too — the SDK's Speak
// socket JSON-parses every incoming frame, so it can't hand us the *binary*
// audio. Here we set binaryType = "arraybuffer" and treat binary frames as
// audio (linear16 PCM) and text frames as JSON control messages
// (Metadata / Flushed / Cleared / Warning).
//
// Control messages we send:
//   Speak  { text }  - queue text to synthesize
//   Flush            - force synthesis of everything buffered so far
//   Clear            - drop server-side buffered audio (used for barge-in)
//   Close            - close the stream

import { DEEPGRAM_WS, TTS } from "./config.js";

export function connectTTS({ token, onAudio, onOpen, onClose, onError, onControl }) {
  const params = new URLSearchParams({
    model: TTS.model,
    encoding: TTS.encoding,
    sample_rate: String(TTS.sampleRate),
  });
  const ws = new WebSocket(`${DEEPGRAM_WS}/v1/speak?${params}`, ["bearer", token]);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => onOpen?.();
  // A browser's WebSocket `error` event is intentionally detail-free (no reason,
  // no status) for security. The real diagnosis lives in the `close` frame that
  // always follows, so we report from there — with the code + reason.
  ws.onerror = () =>
    console.error(
      `[TTS] socket error on ${DEEPGRAM_WS}/v1/speak — waiting for the close ` +
        `frame for the reason. If none follows with a code, check the browser ` +
        `Network ▸ WS tab: this is usually an ad blocker / privacy extension, a ` +
        `VPN/corporate proxy, or a CSP blocking wss://api.deepgram.com.`
    );
  ws.onclose = (e) => {
    // 1000 = normal, 1005 = no status (our own ws.close() on teardown/barge-in).
    // Anything else is abnormal — surface it instead of the old opaque message.
    if (e.code !== 1000 && e.code !== 1005) {
      const detail = e.reason ? `${e.reason} (code ${e.code})` : `code ${e.code}`;
      // 1006 = the connection never completed at the transport level (no close
      // frame from the server) → almost always blocked/interrupted locally.
      const hint =
        e.code === 1006
          ? " — connection blocked before it reached Deepgram (browser extension/ad blocker, VPN, proxy, or CSP)"
          : "";
      console.error(`[TTS] socket closed: ${detail}${hint}`);
      onError?.(new Error(`TTS connection failed: ${detail}${hint}`));
    }
    onClose?.(e);
  };
  ws.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) {
      onAudio?.(e.data); // linear16 PCM
    } else {
      try {
        onControl?.(JSON.parse(e.data));
      } catch {
        /* ignore */
      }
    }
  };

  const send = (obj) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };

  return {
    /** Queue text. Empty text returns a 400 from Deepgram, so we guard it. */
    speak(text) {
      const t = (text ?? "").trim();
      if (t) send({ type: "Speak", text: t });
    },
    flush() {
      send({ type: "Flush" });
    },
    /** Barge-in: tell the server to discard audio it hasn't sent yet. */
    clear() {
      send({ type: "Clear" });
    },
    close() {
      send({ type: "Close" });
      try {
        ws.close();
      } catch {}
    },
  };
}
