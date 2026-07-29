import { ThinkingOrb } from "../vendor/thinking-orbs";

// Maps a session state to the orb animation that best represents it. Each of
// these is a shipped ThinkingOrb state (see vendor/thinking-orbs/types.ts).
export const ORB_STATE = {
  idle: "working", // calm particles on tilted orbits — the ambient/resting orb
  connecting: "searching", // scan meridian sweeps a dotted globe while we connect
  listening: "listening", // waveform rolls through latitude rings
  thinking: "solving", // bands scramble in quarter turns, then click back
  speaking: "composing", // undulating multi-band sash while the agent talks
  error: "working", // fall back to the resting orb
};

// The voice-first centerpiece. The dotted thinking-orb canvas IS the orb, and
// its animation follows the session state (see ORB_STATE above). We wrap it in
// a button and keep a level-reactive ring around it so the mic input (and the
// agent's output) still register visually (Best practice #5). The orb canvas
// auto-follows theme and reduced-motion on its own.
//
// It is also the control: click to start when idle, stop while listening, or
// barge in while the assistant is responding (the label passed in says which).
export function VoiceOrb({ state, level, outputLevel, onClick, label, disabled }) {
  const micLevel = state === "listening" ? Math.min(1, level * 3) : 0;
  const outLevel = state === "speaking" ? Math.min(1, outputLevel * 4) : 0;

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
        state={ORB_STATE[state] ?? "working"}
        size={64}
        theme="auto"
        // While speaking, feed the live output level into the orb so the
        // "composing" sash swells and undulates in time with the voice.
        energy={outLevel}
        aria-hidden="true"
        // Backing store is 64·dpr (128px on retina); display at 128 for a 1:1,
        // crisp render at a size that fills the panel.
        style={{ width: 128, height: 128 }}
      />
    </button>
  );
}
