// Central configuration. Everything tunable lives here so the rest of the code
// reads like prose.
//
// ── Multilingual note ───────────────────────────────────────────────────────
// This popup supports several languages, and Deepgram's speech-to-text has an
// honest fork here:
//   • English → Flux (/v2/listen, flux-general-en). Flux is built for
//     conversational turn-taking and emits StartOfTurn / EagerEndOfTurn /
//     EndOfTurn events, so the orchestrator gets turn detection for free.
//   • Other languages → Nova-3 (/v1/listen, model=nova-3, language=xx). Nova
//     doesn't ship turn events, so stt.js runs a small adapter that turns its
//     interim results + VAD/utterance events into the SAME event shape Flux
//     emits — the orchestrator (conversation.js) never has to know which path
//     is live.
//
// Text-to-speech is Deepgram Aura-2 in every language, just a different voice.
// The voice IDs and language codes below were taken from Deepgram's docs; the
// authoritative list for your account is `GET https://api.deepgram.com/v1/models`.

export const DEEPGRAM_WS = "wss://api.deepgram.com";

// --- Shared audio formats ----------------------------------------------------
// Flux recommends 16 kHz linear16; Nova streams accept the same. Aura-2 streams
// 24 kHz linear16 cleanly.
const STT_ENCODING = "linear16";
const STT_SAMPLE_RATE = 16000;
export const TTS_ENCODING = "linear16";
export const TTS_SAMPLE_RATE = 24000;

// --- Languages offered in the UI ---------------------------------------------
// `code` is what the rest of the app keys on; `label`/`flag` are display only.
export const LANGUAGES = [
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
];

export const DEFAULT_LANGUAGE = "en";

// Per-language STT + TTS wiring. `stt.version` selects the endpoint AND the
// event schema the adapter in stt.js should expect ("v2" = Flux, "v1" = Nova).
const VOICE_CONFIG = {
  en: {
    stt: { version: "v2", endpoint: "/v2/listen", model: "flux-general-en" },
    tts: { model: "aura-2-thalia-en" },
  },
  es: {
    stt: { version: "v1", endpoint: "/v1/listen", model: "nova-3", language: "es" },
    tts: { model: "aura-2-celeste-es" },
  },
  fr: {
    stt: { version: "v1", endpoint: "/v1/listen", model: "nova-3", language: "fr" },
    tts: { model: "aura-2-agathe-fr" },
  },
  de: {
    stt: { version: "v1", endpoint: "/v1/listen", model: "nova-3", language: "de" },
    tts: { model: "aura-2-julius-de" },
  },
};

/**
 * Resolve the full STT + TTS config for a language, folding in the shared audio
 * formats. Falls back to the default language for anything unknown.
 */
export function getVoiceConfig(language) {
  const base = VOICE_CONFIG[language] || VOICE_CONFIG[DEFAULT_LANGUAGE];
  return {
    stt: { ...base.stt, encoding: STT_ENCODING, sampleRate: STT_SAMPLE_RATE },
    tts: { ...base.tts, encoding: TTS_ENCODING, sampleRate: TTS_SAMPLE_RATE },
  };
}

// --- Microphone capture ------------------------------------------------------
// ~80 ms chunks are Deepgram's recommended streaming granularity: small enough
// for low latency, large enough to avoid per-packet overhead.
export const MIC = {
  targetSampleRate: STT_SAMPLE_RATE,
  chunkMs: 80,
};

// Fetch a fresh token this many ms before the current one expires.
export const TOKEN_REFRESH_MARGIN_MS = 10_000;
