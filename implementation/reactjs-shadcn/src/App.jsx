import { useEffect } from "react";

import { useChat } from "./hooks/useChat.js";
import { useConversation } from "./hooks/useConversation.js";
import { ChatPanel } from "./components/ChatPanel.jsx";
import { Diagnostics } from "./components/Diagnostics.jsx";
import { ErrorBanner } from "./components/ErrorBanner.jsx";

// This demo wires Deepgram's voice loop to a custom shadcn/ui chat:
//   speak → Flux STT (turn detection) → /api/chat → LLM → Deepgram TTS,
// with barge-in. `data-state` on the root drives the state-based styling (status
// dot, mic-button ring, input glow) from CSS.
//
// The chat is the conversation of record: every spoken turn becomes a user
// message and every reply streams in as an assistant message — and you can type
// into it too. The message store and the LLM call both live in useChat; the
// realtime voice machinery lives in useConversation (shared, unchanged from the
// other React examples).
export default function App() {
  // The "brain" + message store. Provides the two seams the voice loop needs.
  const {
    messages,
    isGenerating,
    respond,
    sendTyped,
    onResponseInterrupted,
    markCut,
    reset,
  } = useChat();

  // The voice orchestrator (idle → connecting → listening → thinking → speaking).
  // It calls respond() on a committed turn and onResponseInterrupted() on barge-in,
  // and reports through onSpeechCut where playback was cut so the bubble can show
  // what the listener actually heard.
  const {
    state,
    transcript,
    level,
    outputLevel,
    error,
    diagnostics,
    start,
    stop,
    interruptResponse,
    clearDiagnostics,
  } = useConversation({ respond, onResponseInterrupted, onSpeechCut: markCut });

  // If the session ends while a reply is still generating, abort it so nothing
  // keeps streaming into a chat no one is listening to.
  useEffect(() => {
    if (state === "idle") onResponseInterrupted();
  }, [state, onResponseInterrupted]);

  return (
    <main
      id="app"
      data-state={state}
      className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-10 sm:py-14"
    >
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Voice + shadcn/ui
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
          A modern chat built with <strong>shadcn/ui</strong>: your microphone
          streams to Deepgram Flux (STT), finished turns go to an LLM via{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/chat</code>
          , and the reply streams back through Deepgram Flux TTS — with
          turn-taking and barge-in. Talk or type; it's the same chat.
        </p>
      </header>

      <ErrorBanner message={error} />

      <div className="grid min-w-0 items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <ChatPanel
          messages={messages}
          isGenerating={isGenerating}
          interim={transcript.interim}
          reset={reset}
          voice={{
            state,
            level,
            outputLevel,
            start,
            stop,
            interruptResponse,
            stopGenerating: onResponseInterrupted,
            sendTyped,
          }}
        />

        <Diagnostics events={diagnostics} onClear={clearDiagnostics} />
      </div>

      <footer className="text-sm text-muted-foreground">
        <p>
          Press <strong>Listen</strong>, speak, then pause — Flux detects the end
          of your turn, the LLM answers, and the answer is spoken back. Start
          talking again <em>while it's speaking</em> (or hit <strong>barge-in</strong>)
          to cut it off instantly — that also stops the model generating.
        </p>
      </footer>
    </main>
  );
}
