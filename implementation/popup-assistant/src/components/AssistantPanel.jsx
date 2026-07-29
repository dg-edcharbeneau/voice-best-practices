import { VoiceOrb } from "./VoiceOrb.jsx";
import { StatusLine } from "./StatusLine.jsx";
import { LanguageSelect } from "./LanguageSelect.jsx";
import { ChatView } from "./ChatView.jsx";
import { Composer } from "./Composer.jsx";
import { ChatIcon, MicIcon, MicOffIcon, MinimizeIcon } from "./icons.jsx";

// The expanded panel (mocks #1 and #3). Voice-first: a big status orb in the
// middle, language picker + view toggle in the header, and the text composer
// pinned at the bottom as the always-available fallback. A header toggle swaps
// the middle between the VOICE view (orb) and the TEXT view (transcript) — both
// drive the same conversation.
export function AssistantPanel({
  state,
  level,
  outputLevel,
  error,
  messages,
  isGenerating,
  transcript,
  language,
  onLanguageChange,
  view, // "voice" | "text"
  onToggleView,
  onStart,
  onEnd,
  onBargeIn,
  onSendTyped,
  onMinimize,
}) {
  const running = state !== "idle" && state !== "error";
  const responding = state === "speaking" || state === "thinking";
  const reconnecting = state === "connecting";

  // The orb is start button, barge-in button, stop button, and status display
  // in one: start when idle, barge in while the assistant is responding, and
  // stop listening (end the session) while listening.
  const onOrbClick = () => {
    if (state === "idle" || state === "error") onStart();
    else if (responding) onBargeIn();
    else onEnd(); // listening / connecting → stop the input
  };
  const orbLabel =
    state === "idle" || state === "error"
      ? "Start voice chat"
      : responding
        ? "Stop the assistant (barge-in)"
        : "Stop listening";

  return (
    <section className="va-panel" data-state={state} aria-label="Voice Chat">
      <header className="va-panel-header">
        <button
          type="button"
          className="va-icon-btn"
          onClick={onToggleView}
          aria-pressed={view === "text"}
          aria-label={view === "voice" ? "Switch to text chat" : "Switch to voice"}
          title={view === "voice" ? "Switch to text chat" : "Switch to voice"}
        >
          <ChatIcon />
        </button>

        <LanguageSelect
          value={language}
          onChange={onLanguageChange}
          disabled={reconnecting}
        />

        <button
          type="button"
          className="va-icon-btn"
          onClick={onMinimize}
          aria-label="Minimize"
          title="Minimize"
        >
          <MinimizeIcon />
        </button>
      </header>

      {error && (
        <p className="va-error" role="alert">
          {error}
        </p>
      )}

      <div className="va-panel-body">
        {view === "voice" ? (
          <div className="va-voice-view">
            <VoiceOrb
              state={state}
              level={level}
              outputLevel={outputLevel}
              onClick={onOrbClick}
              label={orbLabel}
              disabled={reconnecting}
            />
            {running ? (
              <StatusLine state={state} />
            ) : (
              <p className="va-tagline">
                Talk or type — a voice assistant powered by Deepgram.
                <br />
                Tap the orb and just start speaking.
              </p>
            )}
          </div>
        ) : (
          <ChatView
            messages={messages}
            isGenerating={isGenerating}
            interim={transcript.interim}
          />
        )}
      </div>

      <div className="va-panel-footer">
        <Composer
          onSend={onSendTyped}
          disabled={isGenerating && !responding}
          placeholder={running ? "Listening… or type here" : "Or send a message…"}
        />

        {/* The round call control mirrors the mocks: start when idle, end when
            live. Barge-in lives on the orb, so this stays a simple start/stop. */}
        <button
          type="button"
          className={`va-call-btn${running ? " is-live" : ""}`}
          onClick={running ? onEnd : onStart}
          aria-label={running ? "End voice chat" : "Start voice chat"}
          title={running ? "End voice chat" : "Start voice chat"}
          disabled={reconnecting}
        >
          {running ? <MicOffIcon /> : <MicIcon />}
        </button>
      </div>
    </section>
  );
}
