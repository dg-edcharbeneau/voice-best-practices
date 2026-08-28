import { useEffect, useRef } from "react";
import { Eraser } from "lucide-react";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Separator } from "@/components/ui/separator.jsx";
import { ScrollArea } from "@/components/ui/scroll-area.jsx";
import { formatAt } from "@/lib/diagnostics.js";
import { cn } from "@/lib/utils.js";

// The turn-taking / barge-in trace, as a sibling card to the chat: same shape
// (header + separator + internally scrolling body) so the two columns read as a
// pair. Stacks under the chat below `lg`.
//
// Channel colors come from the same state-accent tokens the status badge uses
// (Best practice #2 — one color vocabulary), so light and dark both work.
const CHANNEL_COLOR = {
  turn: "text-state-listening",
  "barge-in": "text-state-error",
  tts: "text-state-speaking",
  state: "text-state-thinking",
};

// Deliberately no aria-live: these rows arrive several per turn and would flood
// a screen reader. The status badge and chat already carry the announcements.
export function Diagnostics({ events, onClear }) {
  const viewportRef = useRef(null);

  // Newest-first: the list is laid out `flex-col-reverse`, so the newest row
  // sits at the top of the viewport and "keep it in view" means scroll to 0.
  useEffect(() => {
    const vp = viewportRef.current;
    if (vp) vp.scrollTop = 0;
  }, [events.length]);

  return (
    <Card className="flex h-[320px] flex-col overflow-hidden lg:h-full">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 p-4">
        <CardTitle className="text-base">Diagnostics</CardTitle>
        <div className="flex items-center gap-2">
          <span className="rounded-md border px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
            {events.length}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={onClear}
            disabled={events.length === 0}
            aria-label="Clear diagnostics"
            title="Clear diagnostics"
          >
            <Eraser className="size-4" />
          </Button>
        </div>
      </CardHeader>

      <Separator />

      <CardContent className="min-h-0 flex-1 p-0">
        {events.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            Start a session and speak — turn events, barge-in cut-offs, and TTS
            acks show up here.
          </p>
        ) : (
          <ScrollArea className="h-full" viewportRef={viewportRef}>
            {/* Rows wrap rather than scroll sideways: the column is narrow, and
                a transcript in `detail` can be long. `flex-col-reverse` puts the
                newest event on top without reversing the DOM order, so the
                oldest-to-newest reading order stays intact for assistive tech.
                `gap` rather than `space-y` — the latter's margins land on the
                wrong edge once the axis is flipped. */}
            <ol className="flex flex-col-reverse gap-1.5 p-4 font-mono text-xs leading-relaxed">
              {events.map((evt) => (
                <li
                  key={evt.seq}
                  className="grid grid-cols-[auto_auto] gap-x-2 border-b border-border/60 pb-1.5 first:border-0 first:pb-0"
                >
                  <span className="tabular-nums text-muted-foreground">
                    {formatAt(evt.at)}
                  </span>
                  <span
                    className={cn(
                      "font-semibold",
                      CHANNEL_COLOR[evt.channel] ?? "text-muted-foreground"
                    )}
                  >
                    {evt.channel}
                  </span>
                  <span className="col-span-2 break-words">{evt.label}</span>
                  {evt.detail && (
                    <span className="col-span-2 break-words text-muted-foreground">
                      {evt.detail}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
