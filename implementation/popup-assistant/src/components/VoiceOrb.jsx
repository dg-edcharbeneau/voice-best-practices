import { ThinkingOrb } from "../vendor/thinking-orbs";

// Whether a session is live — used to rotate the logo arrangement. Exported so
// the minimized pill shares the exact same rule.
export const isActive = (state) => state !== "idle" && state !== "error";

// The voice-first centerpiece. The dotted thinking-orb canvas IS the orb,
// arranged into the Deepgram logomark (the vendored `logo` state). We wrap it in
// a button and keep a level-reactive ring around it so the mic input (and the
// agent's output) still register visually (Best practice #5). The orb canvas
// auto-follows theme and reduced-motion on its own.
//
// It is also the control: click to start when idle, stop while listening, or
// barge in while the assistant is responding (the label passed in says which).
export function VoiceOrb({ state, level, outputLevel, onClick, label, disabled }) {
  const micLevel = state === "listening" ? Math.min(1, level * 3) : 0;
  const outLevel = state === "speaking" ? Math.min(1, outputLevel * 4) : 0;

  // A live session turns the logomark a quarter-turn clockwise; idle keeps it
  // upright.
  const active = isActive(state);

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
      <span className="va-orb-ring" aria-hidden="true" />
      <ThinkingOrb
        className="va-orb-canvas"
        state="logo"
        size={64}
        theme="auto"
        dotActive={active}
        energy={outLevel}
        eyes={state === "speaking" || state === "listening" || state === "thinking"}
        aria-hidden="true"
        // Backing store is 64·dpr (128px on retina); display at 128 for a 1:1,
        // crisp render at a size that fills the panel.
        style={{ width: 128, height: 128 }}
      />
    </button>
  );
}
