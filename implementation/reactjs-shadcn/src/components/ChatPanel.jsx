import { useEffect, useRef } from "react";
import { RotateCcw } from "lucide-react";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Separator } from "@/components/ui/separator.jsx";
import { ScrollArea } from "@/components/ui/scroll-area.jsx";
import { ChatMessage } from "./ChatMessage.jsx";
import { StatusIndicator } from "./StatusIndicator.jsx";
import { VoiceInput } from "./VoiceInput.jsx";

// The chat surface: a shadcn Card with a header (title + live status + reset), a
// scrolling message list, and the composer pinned at the bottom. The whole thing
// is a fixed-height flex column so the messages scroll internally instead of
// growing the page.
export function ChatPanel({
  messages,
  isGenerating,
  interim,
  reset,
  voice, // { state, level, outputLevel, start, stop, interruptResponse, stopGenerating, sendTyped }
}) {
  const viewportRef = useRef(null);

  // Keep the newest message in view as content streams in or the interim line
  // changes. Runs after paint so scrollHeight reflects the new content.
  useEffect(() => {
    const vp = viewportRef.current;
    if (vp) vp.scrollTop = vp.scrollHeight;
  }, [messages, interim, isGenerating]);

  // While listening, the last assistant message may still be empty because we
  // append an empty placeholder only when a turn commits — so show the typing
  // dots only for an empty assistant bubble while generating.
  const showInterim = interim && interim.trim().length > 0;

  return (
    <Card className="flex h-[600px] max-h-[75vh] flex-col overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 p-4">
        <CardTitle className="text-base">Voice Assistant</CardTitle>
        <div className="flex items-center gap-2">
          <StatusIndicator state={voice.state} />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={reset}
            aria-label="Clear conversation"
            title="Clear conversation"
          >
            <RotateCcw className="size-4" />
          </Button>
        </div>
      </CardHeader>

      <Separator />

      <CardContent className="min-h-0 flex-1 p-0">
        <ScrollArea className="h-full" viewportRef={viewportRef}>
          <div className="flex flex-col gap-4 p-4">
            {messages.map((m) => (
              <ChatMessage
                key={m.id}
                role={m.role}
                content={m.content}
                error={m.error}
                pending={
                  m.role === "assistant" && m.content === "" && isGenerating
                }
              />
            ))}

            {/* Live interim transcript — a translucent user bubble showing what
                Flux is hearing before the turn commits (Best practice #3/#5). */}
            {showInterim && (
              <ChatMessage role="user" content={interim} ghost />
            )}
          </div>
        </ScrollArea>
      </CardContent>

      <div className="p-3 pt-0">
        <VoiceInput isGenerating={isGenerating} {...voice} />
      </div>
    </Card>
  );
}
