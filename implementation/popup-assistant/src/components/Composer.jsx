import { useRef, useState } from "react";
import { SendIcon } from "./icons.jsx";

// The text composer — the "Or send a message…" input from the mocks. It is
// ALWAYS available (voice view or text view) so typing is a first-class
// accessibility fallback, not a hidden alternative. Typed turns are sent via the
// caller's onSend; they stream into the transcript but are NOT spoken (you
// typed, so you're reading).
export function Composer({ onSend, disabled, placeholder }) {
  const [text, setText] = useState("");
  const taRef = useRef(null);

  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend?.(t);
    setText("");
    if (taRef.current) taRef.current.style.height = "auto";
  };

  const onInput = (e) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  return (
    <div className="va-composer">
      <textarea
        ref={taRef}
        rows={1}
        value={text}
        onChange={onInput}
        placeholder={placeholder || "Or send a message…"}
        aria-label="Type a message"
        className="va-composer-input"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button
        type="button"
        className="va-composer-send"
        onClick={submit}
        disabled={!text.trim() || disabled}
        aria-label="Send message"
        title="Send message"
      >
        <SendIcon />
      </button>
    </div>
  );
}
