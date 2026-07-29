import { MicIcon } from "./icons.jsx";

// The gradient status orb — the voice-first centerpiece (see the mocks).
//
// It is BOTH a control and a live status display:
//   • idle/error       → a phone icon; clicking starts the session
//   • speaking/thinking → clicking barges in (cuts the reply)
//   • listening        → a mic icon that reacts to your voice level
//
// Two live levels drive the visuals via inline CSS vars (both 0..1):
//   --mic  → the ring pulse while you talk (input level)
//   --out  → the glow while the agent talks (output level)
// Colors come from [data-state] on the panel root (see popup.css). The orb is
// aria-hidden decoration; the button wrapper carries the accessible label and
// the text status lives in StatusLine (Best practice #9).
export function VoiceOrb({ state, level, outputLevel, onClick, label, disabled }) {
  const micLevel = state === "listening" ? Math.min(1, level * 3) : 0;
  const outLevel = state === "speaking" ? Math.min(1, outputLevel * 4) : 0;

  const Icon = MicIcon;

  return (
    <button
      type="button"
      className="va-orb"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{ "--mic": micLevel.toFixed(3), "--out": outLevel.toFixed(3) }}
    >
      <span className="va-orb-gradient" aria-hidden="true" />
      <span className="va-orb-ring" aria-hidden="true" />
      <span className="va-orb-core" aria-hidden="true">
        <Icon className="va-orb-icon" />
      </span>
    </button>
  );
}
