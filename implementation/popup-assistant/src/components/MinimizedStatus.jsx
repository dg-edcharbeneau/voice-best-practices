import { STATE_LABEL } from "../lib/preflight.js";

// The minimized-while-live state (mock #2): a small floating pill showing a tiny
// live orb, the "Voice chat" label, and the current status ("Listening…"). The
// session keeps running while minimized — teardown only happens on an explicit
// End/Close (Best practice #8). Clicking re-expands the panel.
export function MinimizedStatus({ state, onExpand }) {
  return (
    <button
      type="button"
      className="va-mini"
      onClick={onExpand}
      aria-label="Expand Voice Chat"
    >
      <span className="va-mini-orb" aria-hidden="true">
        <span className="va-orb-gradient" />
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
