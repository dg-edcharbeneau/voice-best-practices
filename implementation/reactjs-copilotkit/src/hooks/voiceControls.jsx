// A tiny context that hands the voice controls (state + start/stop/barge-in) to
// components rendered deep inside <CopilotChat> — notably the custom input, which
// CopilotKit owns and renders, so props can't reach it directly.
//
// Why context and not a closure: the custom Input must be a STABLE component
// (module scope). If we recreated it each render to close over fresh values,
// CopilotChat would remount it and the user would lose focus / half-typed text.
// A stable component reading context stays current without remounting.

import { createContext, useContext } from "react";

export const VoiceControlsContext = createContext(null);

export function useVoiceControls() {
  const ctx = useContext(VoiceControlsContext);
  if (!ctx) {
    throw new Error("useVoiceControls must be used within a VoiceControlsContext provider");
  }
  return ctx;
}
