import { useEffect } from "react";
import { CopilotChat } from "@copilotkit/react-ui";
import { useConversation } from "./hooks/useConversation.js";
import { useCopilotVoiceBridge } from "./hooks/useCopilotVoiceBridge.js";
import { VoiceControlsContext } from "./hooks/voiceControls.jsx";
import { VoiceInput } from "./components/VoiceInput.jsx";
import { ErrorBanner } from "./components/ErrorBanner.jsx";

// This demo wires Deepgram's voice loop to CopilotKit's <CopilotChat>:
//   speak → Flux STT (turn detection) → CopilotKit runtime → LLM → Deepgram TTS,
// with barge-in. `data-state` on the root drives all the state-based styling
// (status dot, mic-button ring, input-box glow) from CSS.
//
// <CopilotChat> is the conversation of record: every spoken turn is injected as
// a user message and every reply streams in as an assistant message — and you can
// type into it too. The status indicator and all controls live inside the input.
export default function App() {
  // The bridge turns the voice orchestrator's `respond`/interrupt seams into
  // CopilotChat operations. It must live under the <CopilotKit> provider (see
  // main.jsx) so its useCopilotChat() has context.
  const { respond, onResponseInterrupted, cancelPending } =
    useCopilotVoiceBridge();

  const { state, level, outputLevel, error, start, stop, interruptResponse } =
    useConversation({ respond, onResponseInterrupted });

  // If the session ends while a reply is still generating, release the bridge's
  // pending promise so nothing is left hanging.
  useEffect(() => {
    if (state === "idle") cancelPending();
  }, [state, cancelPending]);

  return (
    <main id="app" data-state={state}>
      <header className="hero">
        <h1>Voice + CopilotKit</h1>
        <p className="subtitle">
          A voice-driven <strong>CopilotChat</strong>: your microphone streams to
          Deepgram Flux (STT), finished turns go to the CopilotKit runtime and an
          LLM, and the reply streams back through Deepgram Speak (TTS) — with
          turn-taking and barge-in. Talk or type; it's the same chat.
        </p>
      </header>

      <ErrorBanner message={error} />

      <section className="panel chat-panel" aria-label="Conversation">
        <h2 className="panel-title">Conversation</h2>
        {/* Expose the voice controls to the custom input rendered inside
            <CopilotChat> (it's out of reach of normal props). */}
        <VoiceControlsContext.Provider
          value={{ state, level, outputLevel, start, stop, interruptResponse }}
        >
          <div className="copilot-chat">
            <CopilotChat
              // Our custom input: textarea + voice buttons in one box.
              Input={VoiceInput}
              // Spoken replies are read aloud, so steer the model toward short,
              // speech-friendly answers (no markdown, lists, or code blocks).
              instructions={
                "You are a concise, friendly voice assistant. Your replies are " +
                "spoken aloud, so keep them to one to three short sentences and " +
                "avoid markdown, bullet lists, code blocks, and emoji."
              }
              labels={{
                title: "Voice Assistant",
                initial:
                  "Hi! Press “Listen” and just talk to me — or type below.",
              }}
            />
          </div>
        </VoiceControlsContext.Provider>
      </section>

      <footer className="hint">
        <p>
          Press <strong>Listen</strong> in the input box, speak, then pause — Flux
          detects the end of your turn, the LLM answers, and the answer is spoken
          back. Start talking again <em>while it's speaking</em> (or hit{" "}
          <strong>Barge-in</strong>) to cut it off instantly — that also stops the
          model generating.
        </p>
      </footer>
    </main>
  );
}
