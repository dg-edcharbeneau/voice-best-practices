import { STATE_LABEL } from "../lib/preflight.js";

// The single visible source of truth for the state machine (Best practice #2).
// The colored dot is decorative (aria-hidden); the text carries the meaning and
// is announced via aria-live (Best practice #9). One glance answers "is it
// listening to me?".
const PULSING = new Set(["listening", "thinking", "speaking"]);

export function StatusLine({ state, className = "" }) {
  return (
    <div className={`va-status ${className}`}>
      <span
        aria-hidden="true"
        className={`va-status-dot${PULSING.has(state) ? " is-pulsing" : ""}`}
      />
      <span role="status" aria-live="polite" className="va-status-text">
        {STATE_LABEL[state] ?? state}
      </span>
    </div>
  );
}
