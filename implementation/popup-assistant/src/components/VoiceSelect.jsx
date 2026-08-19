import { useEffect, useRef, useState } from "react";
import { VOICE_GROUPS, isKnownVoice } from "../lib/voices.js";
import { ChevronDownIcon } from "./icons.jsx";

// The voice picker, grouped by accent.
//
// Only rendered for English: the Flux TTS catalogue is English-only, so for
// Spanish / French / German the voice is decided by the language (an Aura-2 one,
// see config.js VOICE_CONFIG) and there is nothing to choose between.
//
// Changing voice restarts the session — Flux TTS can change `speed` mid-stream
// with a Configure message, but not the voice (see useConversation.setVoice).
//
// Built as a button + listbox of real buttons, mirroring LanguageSelect, so it's
// keyboard-operable and screen-reader friendly without a component library.
export function VoiceSelect({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const known = VOICE_GROUPS.flatMap((g) => g.voices);
  const current = known.find((v) => v.id === value);
  // A voice set in config.js that isn't in the catalogue still gets a row, so
  // the trigger never renders blank.
  const groups =
    value && !isKnownVoice(value)
      ? [...VOICE_GROUPS, { label: "Configured", voices: [{ id: value, label: value }] }]
      : VOICE_GROUPS;

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (id) => {
    setOpen(false);
    if (id !== value) onChange?.(id);
  };

  // "Haley — clear, professional" → "Haley" for the compact trigger.
  const shortLabel = current ? current.label.split(" — ")[0] : value;

  return (
    <div className="va-voice" ref={rootRef}>
      <button
        type="button"
        className="va-voice-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Voice: ${shortLabel}. Change voice`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="va-voice-label">{shortLabel}</span>
        <ChevronDownIcon className="va-lang-chevron" />
      </button>

      {open && (
        <ul className="va-voice-menu" role="listbox" aria-label="Select voice">
          {groups.map((group) => (
            <li key={group.label} role="presentation">
              <p className="va-voice-group" role="presentation">
                {group.label}
              </p>
              <ul role="group" aria-label={group.label}>
                {group.voices.map((v) => (
                  <li key={v.id} role="option" aria-selected={v.id === value}>
                    <button
                      type="button"
                      className={`va-voice-option${v.id === value ? " is-selected" : ""}`}
                      onClick={() => choose(v.id)}
                    >
                      {v.label}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
