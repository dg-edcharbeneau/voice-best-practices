import { STATE_LABEL } from "../lib/preflight.js";

// The single visible source of truth for the state machine. The colored dot is
// decorative (aria-hidden); the text carries the meaning and is announced via
// aria-live (Best practice #9). Dot color/animation come from [data-state] in CSS.
export function StatusIndicator({ state }) {
  return (
    <div className="status-row">
      <span className="dot" aria-hidden="true" />
      <span id="status" role="status" aria-live="polite">
        {STATE_LABEL[state] ?? state}
      </span>
    </div>
  );
}
