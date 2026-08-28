import { Bot, User, Zap } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar.jsx";
import { splitAtCut, spokenFraction } from "@/lib/interruption.js";
import { cn } from "@/lib/utils.js";

// A single chat bubble. Assistant messages sit on the left with a bot avatar;
// user messages on the right. `pending` renders an animated typing indicator in
// an assistant bubble that has no text yet (the reply is still streaming).
// `ghost` renders a translucent user bubble for the live interim transcript
// (Best practice #3/#5 — the user sees their words being heard, in real time).
// `cut` marks a reply the user barged in on: the text the listener actually
// heard reads normally, the rest is struck through (Best practice #4).
export function ChatMessage({
  role,
  content,
  pending = false,
  ghost = false,
  error = false,
  cut = null,
}) {
  const isUser = role === "user";
  // Deepgram's unspoken tail located inside this reply. Null when the cut is
  // known but not where it landed — the /v1 Aura path never reports text, and a
  // barge-in during "thinking" happens before any text was queued.
  const parts = cut ? splitAtCut(content, cut.remaining) : null;
  const heard = spokenFraction(parts);

  return (
    <div
      className={cn(
        "flex w-full items-start gap-3",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      <Avatar className="h-8 w-8 border">
        <AvatarFallback
          className={cn(
            "text-xs",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground"
          )}
        >
          {isUser ? (
            <User className="size-4" />
          ) : (
            <Bot className="size-4" />
          )}
        </AvatarFallback>
      </Avatar>

      <div
        className={cn(
          "max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm",
          "[overflow-wrap:anywhere] whitespace-pre-wrap",
          isUser
            ? "rounded-tr-sm bg-primary text-primary-foreground"
            : "rounded-tl-sm bg-muted text-foreground",
          ghost && "opacity-60 ring-1 ring-inset ring-border",
          error && "bg-destructive/10 text-destructive",
          cut && !error && "ring-1 ring-inset ring-state-error/40"
        )}
      >
        {pending ? (
          <TypingDots />
        ) : parts ? (
          <>
            {parts.spoken}
            {/* Never reached the listener's ears. Announced for screen readers,
                since strike-through alone carries no meaning to them. */}
            <span className="sr-only"> (cut off, not spoken: </span>
            <span className="line-through decoration-from-font opacity-45">
              {parts.cut}
            </span>
            <span className="sr-only">)</span>
          </>
        ) : (
          content
        )}

        {cut && <CutFooter heardMs={cut.heardMs} heard={heard} />}
      </div>
    </div>
  );
}

// The "you interrupted here" line under a barged-in reply. Shows how long the
// listener actually heard, and — when Flux TTS told us where the cut landed —
// how much of the reply that was.
function CutFooter({ heardMs, heard }) {
  const seconds = Number.isFinite(heardMs) ? (heardMs / 1000).toFixed(2) : null;
  return (
    <span className="mt-1.5 flex items-center gap-1.5 border-t border-current/15 pt-1.5 text-xs opacity-70">
      <Zap aria-hidden="true" className="size-3 shrink-0" />
      {seconds ? `cut off at ${seconds}s` : "cut off"}
      {heard !== null && ` · ${Math.round(heard * 100)}% spoken`}
    </span>
  );
}

// Three bouncing dots while the assistant's first token hasn't arrived yet.
function TypingDots() {
  return (
    <span className="flex items-center gap-1 py-1" aria-label="Assistant is typing">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-current opacity-60"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}
