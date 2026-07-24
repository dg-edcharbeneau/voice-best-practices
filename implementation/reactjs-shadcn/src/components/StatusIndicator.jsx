import { STATE_LABEL } from "@/lib/preflight.js";
import { Badge } from "@/components/ui/badge.jsx";
import { cn } from "@/lib/utils.js";

// The single visible source of truth for the state machine (Best practice #2).
// The colored dot is decorative; the text carries the meaning and is announced
// via aria-live (Best practice #9). One glance answers "is it listening to me?"
const DOT_COLOR = {
  idle: "bg-state-idle",
  connecting: "bg-state-thinking",
  listening: "bg-state-listening",
  thinking: "bg-state-thinking",
  speaking: "bg-state-speaking",
  error: "bg-state-error",
};

// States where the dot should pulse to signal "actively doing something".
const PULSING = new Set(["listening", "thinking", "speaking"]);

export function StatusIndicator({ state }) {
  return (
    <Badge
      variant="secondary"
      className="gap-1.5 py-1 pl-1.5 pr-2.5 font-medium"
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-2 w-2 rounded-full",
          DOT_COLOR[state] ?? "bg-state-idle",
          PULSING.has(state) && "animate-state-pulse"
        )}
      />
      <span role="status" aria-live="polite">
        {STATE_LABEL[state] ?? state}
      </span>
    </Badge>
  );
}
