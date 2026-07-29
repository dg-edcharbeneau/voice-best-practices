import { useEffect, useRef, useState } from "react";
import { LANGUAGES } from "../lib/config.js";
import { ChevronDownIcon } from "./icons.jsx";

// The language picker (top of the panel in the mocks). Language is chosen
// MANUALLY on purpose: even when a spoken language could be auto-detected,
// multilingual users often prefer a different one (e.g. an Eastern-European
// speaker who prefers English). Changing it restarts the voice session on the
// matching STT model + Aura-2 voice (see useConversation.restartWith).
//
// Built as a button + listbox of real buttons so it's keyboard-operable and
// screen-reader friendly without pulling in a component library.
export function LanguageSelect({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = LANGUAGES.find((l) => l.code === value) || LANGUAGES[0];

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

  const choose = (code) => {
    setOpen(false);
    if (code !== value) onChange?.(code);
  };

  return (
    <div className="va-lang" ref={rootRef}>
      <button
        type="button"
        className="va-lang-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Language: ${current.label}. Change language`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="va-lang-flag" aria-hidden="true">
          {current.flag}
        </span>
        <span className="va-lang-label">{current.label}</span>
        <ChevronDownIcon className="va-lang-chevron" />
      </button>

      {open && (
        <ul className="va-lang-menu" role="listbox" aria-label="Select language">
          {LANGUAGES.map((l) => (
            <li key={l.code} role="option" aria-selected={l.code === value}>
              <button
                type="button"
                className={`va-lang-option${l.code === value ? " is-selected" : ""}`}
                onClick={() => choose(l.code)}
              >
                <span className="va-lang-flag" aria-hidden="true">
                  {l.flag}
                </span>
                <span>{l.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
