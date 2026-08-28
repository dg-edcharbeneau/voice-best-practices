import { useConversation } from "./hooks/useConversation.js";
import { StatusPanel } from "./components/StatusPanel.jsx";
import { Transcript } from "./components/Transcript.jsx";
import { Diagnostics } from "./components/Diagnostics.jsx";
import { ErrorBanner } from "./components/ErrorBanner.jsx";

// The whole demo is driven by one hook. `data-state` on the root drives all the
// state-based styling (dot color, meter accent) from CSS — the same contract as
// the vanilla example, so styles.css is shared almost verbatim.
export default function App() {
  const {
    state,
    transcript,
    level,
    error,
    diagnostics,
    start,
    stop,
    interruptResponse,
    clearDiagnostics,
  } = useConversation();

  return (
    <main id="app" data-state={state}>
      <header className="hero">
        <h1>Voice UI Best Practices</h1>
        <p className="subtitle">
          Realtime microphone → Deepgram Flux (STT) → turn detection → Deepgram
          Speak (TTS), with start/stop and barge-in — the same behaviors as the
          vanilla example, built with React. This demo <strong>echoes</strong>{" "}
          each finished turn back to you.
        </p>
      </header>

      <StatusPanel
        state={state}
        level={level}
        onStart={start}
        onStop={stop}
        onInterrupt={interruptResponse}
      />

      <ErrorBanner message={error} />

      <Transcript committed={transcript.committed} interim={transcript.interim} />

      <Diagnostics events={diagnostics} onClear={clearDiagnostics} />

      <footer className="hint">
        <p>
          Try speaking, then pausing — Flux detects the end of your turn and the
          demo speaks your words back. Start talking again <em>while it's
          speaking</em> (or hit <strong>Stop speaking</strong>) to cut it off
          instantly.
        </p>
      </footer>
    </main>
  );
}
