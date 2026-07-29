// Environment checks and error humanizing — framework-agnostic, shared by the
// hook. Best practice #10: never leave the user staring at a dead button while
// the real error hides in the console.

/** Turn a raw capture/permission error into a friendly, actionable message. */
export function friendlyError(err) {
  const name = err?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access was blocked. Allow the mic and try again.";
  }
  if (name === "NotFoundError") {
    return "No microphone was found. Plug one in and try again.";
  }
  return err?.message || "Something went wrong. Check the console for details.";
}

/** Return a blocking message if the browser can't run the demo, else null. */
export function preflight() {
  // Mic capture requires a secure context (https or localhost).
  if (!window.isSecureContext) {
    return "This demo needs a secure context. Open it over http://localhost or https://.";
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return "This browser doesn't support microphone capture (getUserMedia).";
  }
  if (typeof AudioWorkletNode === "undefined") {
    return "This browser doesn't support AudioWorklet.";
  }
  return null;
}

// The human-readable label for each state. The React status component renders
// this; the meaning lives here (single source), the styling in CSS.
export const STATE_LABEL = {
  idle: "Idle",
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking…",
  speaking: "Speaking",
  error: "Error",
};
