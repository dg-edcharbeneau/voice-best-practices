// Central configuration. Everything tunable lives here so the rest of the code
// reads like prose. Change models / rates in one place.
//
// This module is framework-agnostic — it is byte-for-byte the same idea as the
// React example's src/lib/config.js. Blazor only owns the *edges* (the C#
// interop wrapper and the Razor UI); the realtime core stays in JS.

export const DEEPGRAM_WS = "wss://api.deepgram.com";

// --- Speech-to-text: Deepgram Flux (/v2/listen) ------------------------------
// Flux is built for conversational turn-taking: it emits StartOfTurn,
// EagerEndOfTurn, TurnResumed and EndOfTurn events, which is exactly what a
// voice UI needs for VAD and barge-in — no manual endpointing math.
export const STT = {
  model: "flux-general-en",
  encoding: "linear16",
  sampleRate: 16000, // Flux recommends 16 kHz for raw linear16.
};

// --- Text-to-speech: Deepgram Flux TTS (/v2/speak) ---------------------------
// Streamed so playback can start on the first audio frame.
//
// Flux TTS is the current generation: streaming-first, with native interruption
// handling that pairs naturally with Flux STT's turn detection. tts.js picks the
// endpoint from this name — `flux-*` voices go to /v2/speak, `aura*` voices fall
// back to /v1/speak (still the only option outside English).
export const TTS = {
  model: "flux-haley-en",
  encoding: "linear16",
  sampleRate: 24000, // valid on both endpoints (8k / 16k / 24k / 48k).
  // Flux TTS only; the v1 Aura endpoint ignores these.
  speed: 1, // 0.85 (slower) .. 1.15 (faster)
  expressivity: 0, // -2 (calmer) .. 2 (more animated)
};

// --- Microphone capture ------------------------------------------------------
// ~80 ms chunks are Deepgram's recommended streaming granularity: small enough
// for low latency, large enough to avoid per-packet overhead.
export const MIC = {
  targetSampleRate: STT.sampleRate,
  chunkMs: 80,
  // The AudioWorklet is served from the app's wwwroot at this URL.
  workletUrl: "js/pcm-worklet.js",
};

// Fetch a fresh token this many ms before the current one expires.
export const TOKEN_REFRESH_MARGIN_MS = 10_000;

// --- Diagnostics -------------------------------------------------------------
// The turn-taking and barge-in trace surfaced by diagnostics.js. This flag gates
// the console mirror only; the in-app panel's buffer lives on the .NET side (see
// ConversationService.MaxDiagnostics), since that's the edge that renders it.
export const DIAGNOSTICS = {
  console: true, // mirror every event to console.debug
};
