import { useEffect, useState } from "react";

import { useChat } from "../hooks/useChat.js";
import { useConversation } from "../hooks/useConversation.js";
import { LauncherPill } from "./LauncherPill.jsx";
import { MinimizedStatus } from "./MinimizedStatus.jsx";
import { AssistantPanel } from "./AssistantPanel.jsx";
import { DEFAULT_LANGUAGE } from "../lib/config.js";

const ANCHORS = new Set(["bottom-left", "bottom-right", "top-left", "top-right"]);

// The one component a developer drops into their app:
//
//   <VoiceAssistant anchor="bottom-left" defaultLanguage="en" />
//
// It pins itself to a screen corner (anchor prop) and manages three surfaces:
//   • collapsed  → the "Voice Chat" launcher pill (mock #2 collapsed)
//   • expanded   → the full AssistantPanel (mocks #1 / #3)
//   • minimized  → a floating status pill, shown ONLY while a session is live
//                  (mock #2) — minimizing does NOT end the call.
//
// It owns the voice engine (useConversation) and the chat brain + message store
// (useChat), wiring them together exactly as the reference examples do. The UI
// is a pure projection of the orchestrator's state (Best practice #2).
export function VoiceAssistant({
  anchor = "bottom-left",
  defaultLanguage = DEFAULT_LANGUAGE,
}) {
  const safeAnchor = ANCHORS.has(anchor) ? anchor : "bottom-left";

  const [open, setOpen] = useState(false);
  const [view, setView] = useState("voice"); // "voice" | "text"
  const [language, setLanguage] = useState(defaultLanguage);

  // The chat "brain" + message store. Provides the seams the voice loop needs.
  const { messages, isGenerating, respond, sendTyped, onResponseInterrupted } =
    useChat();

  // The voice orchestrator (idle → connecting → listening → thinking → speaking).
  const {
    state,
    transcript,
    level,
    outputLevel,
    error,
    start,
    stop,
    restartWith,
    interruptResponse,
  } = useConversation({ respond, onResponseInterrupted, language });

  const running = state !== "idle" && state !== "error";

  // If the session ends while a reply is still generating, abort it so nothing
  // keeps streaming into a chat no one is listening to.
  useEffect(() => {
    if (state === "idle") onResponseInterrupted();
  }, [state, onResponseInterrupted]);

  const onLanguageChange = (code) => {
    setLanguage(code);
    // Reconnect on the new STT model + Aura-2 voice if a session is live.
    restartWith(code);
  };

  // Which surface to render when the panel is closed.
  const collapsed = running ? (
    <MinimizedStatus state={state} onExpand={() => setOpen(true)} />
  ) : (
    <LauncherPill onOpen={() => setOpen(true)} />
  );

  return (
    <div className="va-root" data-anchor={safeAnchor} data-state={state}>
      {open ? (
        <AssistantPanel
          state={state}
          level={level}
          outputLevel={outputLevel}
          error={error}
          messages={messages}
          isGenerating={isGenerating}
          transcript={transcript}
          language={language}
          onLanguageChange={onLanguageChange}
          view={view}
          onToggleView={() => setView((v) => (v === "voice" ? "text" : "voice"))}
          onStart={start}
          onEnd={stop}
          onBargeIn={interruptResponse}
          onSendTyped={sendTyped}
          onMinimize={() => setOpen(false)}
        />
      ) : (
        collapsed
      )}
    </div>
  );
}
