import { VOICE_GROUPS, isKnownVoice } from "../lib/voices.js";

// Voice picker for Deepgram Flux TTS, grouped by accent.
//
// A native <select> with <optgroup>s: this example has no component library, and
// the platform control already gives us grouping, keyboard navigation and mobile
// pickers for free.
//
// Disabled while a session is live: Flux TTS can change `speed` mid-stream with a
// Configure message, but not the voice — a different voice needs a new socket.
// Changing it while stopped means the next start() picks it up; changing it
// mid-session is handled by the caller reconnecting (see useConversation).
export function VoiceSelect({ voice, onVoiceChange, disabled }) {
  return (
    <label className="voice-select">
      <span className="voice-select__label">Voice</span>
      <select
        className="voice-select__control"
        value={voice}
        disabled={disabled}
        onChange={(e) => onVoiceChange?.(e.target.value)}
        title={
          disabled
            ? "End the session to change voice"
            : "Text-to-speech voice (Flux TTS)"
        }
      >
        {VOICE_GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </optgroup>
        ))}

        {/* A voice configured in config.js that isn't in the catalogue — a newer
            Flux voice, or an Aura-2 voice for a non-English demo. Listed rather
            than silently dropped, which would leave the select showing the wrong
            voice. */}
        {voice && !isKnownVoice(voice) && (
          <optgroup label="Configured">
            <option value={voice}>{voice}</option>
          </optgroup>
        )}
      </select>
    </label>
  );
}
