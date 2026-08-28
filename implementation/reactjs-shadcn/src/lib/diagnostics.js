// Diagnostics — a structured, human-readable trace of the realtime loop.
//
// A voice UI's hardest behaviors (turn detection, barge-in) are also its least
// visible: the status label says "speaking", then it doesn't, and everything
// interesting happened in between. This module defines the event shape the
// orchestrator emits so both the console and the in-app panel can show *what*
// happened, *when*, and *why*.
//
// Framework-agnostic on purpose — no React, no DOM. conversation.js emits;
// the UI layer renders (see hooks/useConversation.js and
// components/Diagnostics.jsx).
//
// Event shape:
//   {
//     seq:     monotonic counter, unique per session — a stable React key
//     at:      ms since the first event of this session (relative, not wall
//              clock: "+4.21s" reads as latency, which is what you want here)
//     channel: "turn" | "barge-in" | "tts" | "state"
//     label:   short phrase, e.g. "EndOfTurn #4"
//     detail:  optional longer string (a transcript, a reason, counters)
//   }

import { DIAGNOSTICS } from "./config.js";

/** Channels, in the order they tend to fire. Used for the badge colors. */
export const DIAG_CHANNELS = ["turn", "barge-in", "tts", "state"];

// Console styling per channel, so a barge-in is impossible to miss while
// scrolling. Matches the state-color vocabulary used in index.css.
const CHANNEL_STYLE = {
  turn: "color:#1fb46b;font-weight:600",
  "barge-in": "color:#e5484d;font-weight:600",
  tts: "color:#4b5cff;font-weight:600",
  state: "color:#f0a020;font-weight:600",
};

/**
 * Create the event factory for one session. Each call returns a fresh stamper
 * so `seq` and the `at` baseline restart with the session.
 */
export function createDiagnosticStamp() {
  let seq = 0;
  let origin = null;
  return (channel, label, detail) => {
    const now = performance.now();
    if (origin === null) origin = now;
    return { seq: seq++, at: now - origin, channel, label, detail };
  };
}

/** Relative timestamp, e.g. "+4.21s". */
export function formatAt(at) {
  return `+${(at / 1000).toFixed(2)}s`;
}

/** One-line rendering of an event — used for the console mirror. */
export function formatDiagnostic(evt) {
  const head = `${formatAt(evt.at)}  ${evt.channel}  ${evt.label}`;
  return evt.detail ? `${head} — ${evt.detail}` : head;
}

/**
 * Mirror an event to the console. Gated on DIAGNOSTICS.console so the panel can
 * stay on while the console goes quiet. console.debug keeps these out of the
 * default console filter in Chrome DevTools ("Verbose" reveals them).
 */
export function logDiagnostic(evt) {
  if (!DIAGNOSTICS.console) return;
  const style = CHANNEL_STYLE[evt.channel] ?? "font-weight:600";
  console.debug(
    `%c[${evt.channel}]%c ${formatAt(evt.at)} ${evt.label}${evt.detail ? ` — ${evt.detail}` : ""}`,
    style,
    "color:inherit"
  );
}
