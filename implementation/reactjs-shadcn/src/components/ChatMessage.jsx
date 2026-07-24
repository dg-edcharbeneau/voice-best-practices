import { Bot, User } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar.jsx";
import { cn } from "@/lib/utils.js";

// A single chat bubble. Assistant messages sit on the left with a bot avatar;
// user messages on the right. `pending` renders an animated typing indicator in
// an assistant bubble that has no text yet (the reply is still streaming).
// `ghost` renders a translucent user bubble for the live interim transcript
// (Best practice #3/#5 — the user sees their words being heard, in real time).
export function ChatMessage({ role, content, pending = false, ghost = false, error = false }) {
  const isUser = role === "user";

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
          error && "bg-destructive/10 text-destructive"
        )}
      >
        {pending ? <TypingDots /> : content}
      </div>
    </div>
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
