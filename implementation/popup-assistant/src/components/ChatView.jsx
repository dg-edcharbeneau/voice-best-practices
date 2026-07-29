import { useEffect, useRef } from "react";

// The text transcript view — the accessibility fallback and the "conversation of
// record". Every spoken turn AND every typed turn lands here as a bubble, so a
// user who prefers reading/typing gets the same conversation as a voice user.
// The translucent "ghost" bubble shows Deepgram's live interim transcript before
// a turn commits (Best practice #3/#5).
export function ChatView({ messages, isGenerating, interim }) {
  const viewportRef = useRef(null);

  // Keep the newest message in view as content streams in or interim changes.
  useEffect(() => {
    const vp = viewportRef.current;
    if (vp) vp.scrollTop = vp.scrollHeight;
  }, [messages, interim, isGenerating]);

  const showInterim = interim && interim.trim().length > 0;

  return (
    <div className="va-chat" ref={viewportRef}>
      <div className="va-chat-list">
        {messages.map((m) => {
          const pending =
            m.role === "assistant" && m.content === "" && isGenerating;
          return (
            <div
              key={m.id}
              className={`va-msg va-msg-${m.role}${m.error ? " is-error" : ""}`}
            >
              {pending ? (
                <span className="va-typing" aria-label="Assistant is replying">
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                m.content
              )}
            </div>
          );
        })}

        {showInterim && (
          <div className="va-msg va-msg-user is-ghost">{interim}</div>
        )}
      </div>
    </div>
  );
}
