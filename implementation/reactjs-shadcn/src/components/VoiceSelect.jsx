import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.jsx";
import { VOICE_GROUPS, isKnownVoice } from "@/lib/voices.js";

// Voice picker for Deepgram Flux TTS, grouped by accent.
//
// Disabled while a session is live: Flux TTS can change `speed` mid-stream with
// a Configure message, but not the voice — a different voice needs a new socket.
// Changing it while stopped means the next start() picks it up; changing it
// mid-session is handled by the caller tearing the session down and reconnecting
// (see useConversation.setVoiceAndRestart).
export function VoiceSelect({ voice, onVoiceChange, disabled }) {
  return (
    <Select value={voice} onValueChange={onVoiceChange} disabled={disabled}>
      <SelectTrigger
        className="h-8 w-[190px] text-xs"
        aria-label="Text-to-speech voice"
        title={
          disabled
            ? "End the session to change voice"
            : "Text-to-speech voice (Flux TTS)"
        }
      >
        <SelectValue placeholder="Voice" />
      </SelectTrigger>
      <SelectContent>
        {VOICE_GROUPS.map((group) => (
          <SelectGroup key={group.label}>
            <SelectLabel>{group.label}</SelectLabel>
            {group.voices.map((v) => (
              <SelectItem key={v.id} value={v.id} className="text-xs">
                {v.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}

        {/* A voice configured in config.js that isn't in the catalogue — a newer
            Flux voice, or an Aura-2 voice for a non-English demo. Listed rather
            than silently dropped, which would make the trigger render empty. */}
        {voice && !isKnownVoice(voice) && (
          <SelectGroup>
            <SelectLabel>Configured</SelectLabel>
            <SelectItem value={voice} className="text-xs">
              {voice}
            </SelectItem>
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
