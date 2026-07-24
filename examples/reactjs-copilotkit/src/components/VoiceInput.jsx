import { useState } from "react";
import { useVoiceControls } from "../hooks/voiceControls.jsx";
import { StatusIndicator } from "./StatusIndicator.jsx";
import { MicIcon, StopIcon, MuteIcon, SendIcon } from "./icons.jsx";

// A custom chat input for <CopilotChat> (passed via its `Input` prop). It renders
// the textarea PLUS the voice controls, so the whole interface — type or talk —
// lives in one box. CopilotKit hands us these props:
//   inProgress  — the LLM is generating a response
//   onSend      — submit typed text (returns Promise<Message>)
//   onStop      — stop generation
// The voice controls (state + start/stop/barge-in) come from context, since this
// component is rendered by CopilotKit, out of reach of normal props.
export function VoiceInput({ inProgress, onSend, onStop }) {
  const { state, level, outputLevel, start, stop, interruptResponse } =
    useVoiceControls();
  const [text, setText] = useState("");

  const running = state !== "idle" && state !== "error"; // a session is live
  const responding = state === "speaking" || state === "thinking";

  // Two live levels, both scaled for liveliness and clamped, fed to CSS vars:
  //   --mic drives the ring around the MIC BUTTON while you're talking (input)
  //   --out drives a glow around the whole INPUT BOX while the agent talks (output)
  // Each is zero unless its state is active, so the effects rest quietly. The
  // [data-state] on the app root (see index.css) picks the colors.
  const micLevel = running ? Math.min(1, level * 3) : 0;
  const outLevel = state === "speaking" ? Math.min(1, outputLevel * 4) : 0;

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };

  return (
    <div
      className="voice-input"
      style={{ "--mic": micLevel.toFixed(3), "--out": outLevel.toFixed(3) }}
    >
      <textarea
        className="voice-input__text"
        rows={1}
        value={text}
        placeholder={running ? "Listening… or type here" : "Type a message, or press Listen"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />

      {/* Status indicator on the left, controls grouped on the right. The
          icon-only buttons keep their labels in aria-label + title (hover
          tooltip) so the row stays compact while staying accessible. */}
      <div className="voice-input__controls">
        {/* Session state: accessible dot + label (role=status, aria-live). */}
        <StatusIndicator state={state} />

        <span className="voice-input__spacer" />

        {/* Voice: one toggle for the whole session. */}
        <button
          type="button"
          className={`btn btn-icon voice-input__mic ${running ? "" : "btn-primary"}`}
          onClick={running ? stop : start}
          aria-pressed={running}
          aria-label={running ? "Stop listening" : "Listen"}
          title={running ? "Stop listening" : "Listen"}
        >
          {running ? <StopIcon size={18} /> : <MicIcon size={18} />}
        </button>

        {/* Barge-in: only meaningful while the agent is answering. */}
        {responding && (
          <button
            type="button"
            className="btn btn-icon"
            onClick={interruptResponse}
            aria-label="Barge-in (stop the assistant)"
            title="Barge-in (stop the assistant)"
          >
            <MuteIcon size={18} />
          </button>
        )}

        {/* Typed path: Stop while generating, otherwise Send. */}
        {inProgress ? (
          <button
            type="button"
            className="btn btn-icon"
            onClick={onStop}
            aria-label="Stop generating"
            title="Stop generating"
          >
            <StopIcon size={18} />
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-icon btn-primary"
            onClick={submit}
            disabled={!text.trim()}
            aria-label="Send message"
            title="Send message"
          >
            <SendIcon size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
