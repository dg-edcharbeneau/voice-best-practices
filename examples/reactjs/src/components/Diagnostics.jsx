import { useEffect, useRef } from "react";
import { formatAt } from "../lib/diagnostics.js";

// The turn-taking / barge-in trace, rendered as an event log. Collapsed by
// default: it's a debugging affordance, not part of the demo's main surface.
//
// Deliberately *not* aria-live — these rows arrive several per turn and would
// flood a screen reader. The status row and transcript already carry the
// announcements a user needs (Best practice #9).
export function Diagnostics({ events, onClear }) {
  const listRef = useRef(null);

  // Newest-first: the list is laid out `column-reverse`, so the newest row sits
  // at the top of the scroller and "keep it in view" means scroll to 0.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = 0;
  }, [events.length]);

  return (
    <section className="panel" aria-label="Diagnostics">
      <details className="diagnostics">
        <summary className="panel-title diag-summary">
          Diagnostics <span className="diag-count">{events.length}</span>
        </summary>

        <div className="diag-actions">
          <button
            type="button"
            className="btn btn-small"
            onClick={onClear}
            disabled={events.length === 0}
          >
            Clear
          </button>
        </div>

        <ol ref={listRef} className="diag-list">
          {events.map((evt) => (
            <li key={evt.seq} className="diag-row">
              <span className="diag-time">{formatAt(evt.at)}</span>
              <span className="diag-badge" data-channel={evt.channel}>
                {evt.channel}
              </span>
              <span className="diag-label">{evt.label}</span>
              {evt.detail && <span className="diag-detail">{evt.detail}</span>}
            </li>
          ))}
        </ol>

        {events.length === 0 && (
          <p className="diag-empty">
            Start a session and speak — turn events, barge-in cut-offs, and TTS
            acks show up here.
          </p>
        )}
      </details>
    </section>
  );
}
