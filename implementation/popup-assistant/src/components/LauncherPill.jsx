import { MicIcon } from "./icons.jsx";

// The collapsed entry point (the minimized state). A clearly labeled, real
// <button> — "Voice Chat" — so it's obvious what it does, keyboard-operable, and
// has a visible focus ring (Best practice #9). Clicking it opens the panel; the
// click also doubles as the user gesture that lets us unlock audio later.
export function LauncherPill({ onOpen }) {
  return (
    <button
      type="button"
      className="va-launcher"
      onClick={onOpen}
      aria-expanded={false}
      aria-label="Open Voice Chat"
    >
      <span className="va-launcher-icon" aria-hidden="true">
        <MicIcon />
      </span>
      <span className="va-launcher-label">Voice Chat</span>
    </button>
  );
}
