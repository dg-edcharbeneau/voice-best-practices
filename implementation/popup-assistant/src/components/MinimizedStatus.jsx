import { STATE_LABEL } from "../lib/preflight.js";
import { ThinkingOrb } from "../vendor/thinking-orbs";
import { ORB_STATE } from "./VoiceOrb.jsx";

// The minimized-while-live state (mock #2): a small floating pill showing a tiny
// live orb, the "Voice chat" label, and the current status ("Listening…"). The
// session keeps running while minimized — teardown only happens on an explicit
// End/Close (Best practice #8). Clicking re-expands the panel. The orb is the
// thinking-orb's inline (size 20) preset, running the same state as the panel.
export function MinimizedStatus({ state, onExpand }) {
  return (
    <button
      type="button"
      className="va-mini"
      onClick={onExpand}
      aria-label="Expand Voice Chat"
    >
      <span className="va-mini-orb" aria-hidden="true">
        <ThinkingOrb
          state={ORB_STATE[state] ?? "working"}
          size={20}
          theme="auto"
          aria-hidden="true"
        />
      </span>
      <span className="va-mini-text">
        <span className="va-mini-title">Voice chat</span>
        <span className="va-mini-status" role="status" aria-live="polite">
          {STATE_LABEL[state] ?? state}
        </span>
      </span>
    </button>
  );
}
