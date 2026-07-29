import { VoiceAssistant } from "./components/VoiceAssistant.jsx";

// A tiny demo host so the widget has a page to sit on. The only real line here
// is <VoiceAssistant/> — everything else is placeholder page content that shows
// the popup pinned to a corner over a normal app.
//
// Try changing anchor to "bottom-right" | "top-left" | "top-right", or
// defaultLanguage to "es" | "fr" | "de".
export default function App() {
  return (
    <div className="demo">
      <header className="demo-header">
        <div className="demo-logo">🎙️ Acme Docs</div>
        <nav className="demo-nav">
          <a href="#">Guides</a>
          <a href="#">API</a>
          <a href="#">Pricing</a>
        </nav>
      </header>

      <main className="demo-main">
        <h1>Your product’s help center</h1>
        <p>
          This page is just scaffolding — a stand-in for whatever app you’d embed
          the assistant into. Look in the corner: the{" "}
          <strong>Voice Chat</strong> launcher is pinned there. Click it to
          expand the popup, tap the orb to start talking, or switch to the text
          view to type. Minimize it and it keeps listening.
        </p>
        <p className="demo-hint">
          Pass <code>anchor</code> to move it — <code>bottom-left</code>{" "}
          (default), <code>bottom-right</code>, <code>top-left</code>, or{" "}
          <code>top-right</code>.
        </p>
      </main>

      {/* The one line a developer actually adds to their app. */}
      <VoiceAssistant anchor="bottom-left" defaultLanguage="en" />
    </div>
  );
}
