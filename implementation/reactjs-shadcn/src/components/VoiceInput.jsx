import { useRef, useState } from "react";
import { Mic, Square, VolumeX, Send } from "lucide-react";

import { Button } from "@/components/ui/button.jsx";
import { Textarea } from "@/components/ui/textarea.jsx";
import { cn } from "@/lib/utils.js";

// The composer: a textarea plus the voice controls in one box, so the whole
// interface — type OR talk — lives together. Unlike the CopilotKit example (where
// CopilotChat rendered a custom input reached via context), here we own the chat,
// so every control comes in as a plain prop.
//
// Two live levels are fed to CSS variables on the wrapper (both 0..1):
//   --mic drives the ring around the MIC BUTTON while you're talking (input)
//   --out drives a glow around the whole INPUT BOX while the agent talks (output)
// Colors come from [data-state] on the app root (see index.css / #app in App.jsx).
export function VoiceInput({
  state,
  level,
  outputLevel,
  start,
  stop,
  interruptResponse,
  stopGenerating,
  sendTyped,
  isGenerating,
}) {
  const [text, setText] = useState("");
  const taRef = useRef(null);

  const running = state !== "idle" && state !== "error"; // a session is live
  const responding = state === "speaking" || state === "thinking";

  const micLevel = running ? Math.min(1, level * 3) : 0;
  const outLevel = state === "speaking" ? Math.min(1, outputLevel * 4) : 0;

  const submit = () => {
    const t = text.trim();
    if (!t || isGenerating) return;
    sendTyped(t);
    setText("");
    if (taRef.current) taRef.current.style.height = "auto";
  };

  // Grow the textarea with its content, up to a cap.
  const onInput = (e) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  return (
    <div
      className={cn(
        "speak-glow flex flex-col gap-2 rounded-xl border bg-background p-2"
      )}
      style={{ "--mic": micLevel.toFixed(3), "--out": outLevel.toFixed(3) }}
    >
      <Textarea
        ref={taRef}
        rows={1}
        value={text}
        onChange={onInput}
        placeholder={
          running ? "Listening… or type here" : "Type a message, or press Listen"
        }
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        className="min-h-[40px] resize-none border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
      />

      <div className="flex items-center gap-2">
        {/* Voice session toggle — one button for the whole session. */}
        <Button
          type="button"
          variant={running ? "secondary" : "default"}
          size="sm"
          onClick={running ? stop : start}
          aria-pressed={running}
          aria-label={running ? "End voice session" : "Listen"}
          title={running ? "End voice session" : "Listen"}
          className="mic-ring gap-2"
        >
          {running ? <Square /> : <Mic />}
          {running ? "End" : "Listen"}
        </Button>

        {/* Barge-in — only meaningful while the agent is answering (Best
            practice #4). Cuts audio AND stops the model generating. */}
        {responding && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={interruptResponse}
            aria-label="Barge-in (stop the assistant)"
            title="Barge-in (stop the assistant)"
          >
            <VolumeX />
          </Button>
        )}

        <div className="flex-1" />

        {/* Right action: Stop while a typed reply is generating, else Send. */}
        {isGenerating && !responding ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={stopGenerating}
            aria-label="Stop generating"
            title="Stop generating"
          >
            <Square />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            onClick={submit}
            disabled={!text.trim() || isGenerating}
            aria-label="Send message"
            title="Send message"
          >
            <Send />
          </Button>
        )}
      </div>
    </div>
  );
}
