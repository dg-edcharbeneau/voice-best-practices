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
// Text-to-speech has the same fork, for a simpler reason — Flux TTS is
// English-only right now:
//   • English → Flux TTS (/v2/speak, flux-*). Streaming-first, and its
//     Interrupt message records how much of a turn the listener actually
//     heard, which is exactly what barge-in wants.
//   • Other languages → Aura-2 (/v1/speak, aura-2-*), still the only option
//     outside English.
// tts.js picks the endpoint from the voice name, so this table just names a
// voice and the right protocol follows. Flux voices are listed in ./voices.js;
// the authoritative Aura list for your account is
// `GET https://api.deepgram.com/v1/models`.

export const DEEPGRAM_WS = "wss://api.deepgram.com";

// --- Shared audio formats ----------------------------------------------------
// Flux recommends 16 kHz linear16; Nova streams accept the same. 24 kHz is
// valid on both TTS endpoints (8k / 16k / 24k / 48k).
const STT_ENCODING = "linear16";
const STT_SAMPLE_RATE = 16000;
export const TTS_ENCODING = "linear16";
export const TTS_SAMPLE_RATE = 24000;
// Flux TTS only; the v1 Aura endpoint ignores these, so they are safe to apply
// to every language.
export const TTS_SPEED = 1; // 0.85 (slower) .. 1.15 (faster)
export const TTS_EXPRESSIVITY = 0; // -2 (calmer) .. 2 (more animated)

// --- Languages offered in the UI ---------------------------------------------
// `code` is what the rest of the app keys on; `label`/`flag` are display only.
export const LANGUAGES = [
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
];

export const DEFAULT_LANGUAGE = "en";

// The one language with a voice catalogue to choose from. Flux TTS is
// English-only, so the voice picker is offered here and nowhere else; every
// other language's voice is decided by VOICE_CONFIG below.
export const VOICE_PICKER_LANGUAGE = "en";

// Per-language STT + TTS wiring. `stt.version` selects the endpoint AND the
// event schema the adapter in stt.js should expect ("v2" = Flux, "v1" = Nova).
// On the TTS side there is no version field — tts.js derives the endpoint from
// the voice name, so a `flux-*` voice implies /v2/speak and `aura-2-*` implies
// /v1/speak.
const VOICE_CONFIG = {
  en: {
    stt: { version: "v2", endpoint: "/v2/listen", model: "flux-general-en" },
    tts: { model: "flux-haley-en" },
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
 *
 * `voice` optionally overrides the language's default voice — that's the voice
 * picker, which only offers alternatives for English since the Flux catalogue is
 * English-only. Pass nothing to get the table's own choice.
 */
export function getVoiceConfig(language, voice) {
  const base = VOICE_CONFIG[language] || VOICE_CONFIG[DEFAULT_LANGUAGE];
  return {
    stt: { ...base.stt, encoding: STT_ENCODING, sampleRate: STT_SAMPLE_RATE },
    tts: {
      ...base.tts,
      ...(voice ? { model: voice } : null),
      encoding: TTS_ENCODING,
      sampleRate: TTS_SAMPLE_RATE,
      speed: TTS_SPEED,
      expressivity: TTS_EXPRESSIVITY,
    },
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
