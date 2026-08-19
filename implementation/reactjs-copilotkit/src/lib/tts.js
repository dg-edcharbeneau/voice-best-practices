// Streaming text-to-speech over a raw WebSocket to Deepgram.
//
// Two generations of the API are supported, chosen automatically from the
// configured voice:
//
//   flux-*  ->  /v2/speak  (Flux TTS — streaming-first, native interruption)
//   aura*   ->  /v1/speak  (Aura / Aura-2 — still the only option outside English)
//
// Flux TTS is English-only at the time of writing, so the Aura path stays for
// non-English voices. The protocols are close but not identical, and the
// difference that matters here is barge-in:
//
//   v1: { type: "Clear" }      — drop buffered audio
//   v2: { type: "Interrupt", playback_offset: {...} }
//                              — drop it AND tell the server how much of the
//                                turn the listener actually heard
//
// Cross-turn context (v2 only): Flux carries its own acoustic state — the
// prosody, tone, and pacing of its prior generations — forward from turn to
// turn, so turn 10 sounds like a continuation of turn 1 instead of a cold
// start. There is no field to switch this on; it is simply how /v2/speak
// behaves. What switches it *off* is a new connection, because the state lives
// on the socket.
//
// That makes socket lifetime a correctness concern, not just an efficiency one:
// open the TTS socket once per *session* and keep it — never one per turn.
// `Flush` (end of turn) and `Interrupt` (barge-in) both preserve the state;
// only `Close` or a reconnect drops it. See conversation.js, where connectTTS()
// is called once in start() and closed only in stop().
//
// Caveat: Deepgram ends a session after one hour. Anything that runs that long
// has to reconnect, and the voice will reset at that seam.
// https://developers.deepgram.com/docs/flux-tts/context
//
// Same auth story as STT either way: browser-native subprotocol auth with a
// short-lived token. We use a raw WebSocket for a second reason too — the SDK's
// Speak socket JSON-parses every incoming frame, so it can't hand us the
// *binary* audio. Here we set binaryType = "arraybuffer" and treat binary
// frames as audio (linear16 PCM) and text frames as JSON control messages.
//
// Control messages we send:
//   Speak  { text }  - queue text to synthesize
//   Flush            - end the turn: synthesize everything buffered so far
//   Clear/Interrupt  - drop buffered audio (barge-in; see interrupt() below)
//   Close            - close the stream
//
// Control messages we receive:
//   v1: Metadata / Flushed / Cleared / Warning
//   v2: Connected / SpeechStarted / Flushed / SpeechMetadata /
//       SpeechInterrupted / SessionMetadata / Warning / Error
// `Flushed` means the same thing on both, which is what conversation.js uses to
// decide a turn is over.

import { DEEPGRAM_WS, TTS } from "./config.js";

/** Flux TTS lives on /v2/speak; everything else is the v1 Aura endpoint. */
export function isFluxVoice(model) {
  return typeof model === "string" && model.startsWith("flux-");
}

export function connectTTS({ token, onAudio, onOpen, onClose, onError, onControl }) {
  const flux = isFluxVoice(TTS.model);
  const params = new URLSearchParams({
    model: TTS.model,
    encoding: TTS.encoding,
    sample_rate: String(TTS.sampleRate),
  });
  // Delivery controls exist only on v2, which rejects unknown query params.
  // Sending defaults is just noise, so both are conditional.
  if (flux) {
    if (TTS.speed !== 1) params.set("speed", String(TTS.speed));
    if (TTS.expressivity !== 0) params.set("expressivity", String(TTS.expressivity));
  }
  const path = flux ? "/v2/speak" : "/v1/speak";
  const ws = new WebSocket(`${DEEPGRAM_WS}${path}?${params}`, ["bearer", token]);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => onOpen?.();
  ws.onclose = (e) => onClose?.(e);
  ws.onerror = () => onError?.(new Error("TTS socket error"));
  ws.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) {
      onAudio?.(e.data); // linear16 PCM
      return;
    }
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    // v2 has an explicit fatal Error message; surface it rather than letting
    // the socket just go quiet.
    if (msg?.type === "Error") {
      onError?.(new Error(msg.description || msg.message || "TTS error"));
    }
    onControl?.(msg);
  };

  const send = (obj) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };

  return {
    /** Which wire protocol this socket ended up on — handy for logging. */
    endpoint: path,

    /** Queue text. Empty text returns a 400 from Deepgram, so we guard it. */
    speak(text) {
      const t = (text ?? "").trim();
      if (t) send({ type: "Speak", text: t });
    },
    flush() {
      send({ type: "Flush" });
    },
    /**
     * Barge-in — discard audio the server hasn't sent yet.
     *
     * @param {number} [heardMs] how much of the turn actually reached the
     *   listener's ears. v2 uses it to record where the speech was cut; v1 has
     *   no equivalent and ignores it.
     */
    interrupt(heardMs) {
      if (!flux) {
        send({ type: "Clear" });
        return;
      }
      const msg = { type: "Interrupt" };
      if (Number.isFinite(heardMs)) {
        msg.playback_offset = {
          type: "time_ms",
          value: Math.max(0, Math.round(heardMs)),
        };
      }
      send(msg);
    },
    close() {
      send({ type: "Close" });
      try {
        ws.close();
      } catch {}
    },
  };
}
