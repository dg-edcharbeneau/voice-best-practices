// Reconciling a barge-in with the chat history.
//
// When the user talks over the agent, the assistant message in the chat is the
// *whole* reply the LLM produced — but the listener only heard part of it. Flux
// TTS tells us exactly where the cut landed (`SpeechInterrupted` carries
// `text_spoken` and `text_remaining`), and this module turns that into a split
// point inside the message text so the UI can show heard vs. never-heard.
//
// Why this matters beyond the visual: a voice agent whose history claims it said
// things the user never heard will confuse itself on the next turn ("as I
// mentioned…" — it didn't). See BEST_PRACTICES.md #4.
//
// Framework-agnostic: no React, no DOM.

/**
 * Find where playback was cut inside a reply.
 *
 * Anchors on the *unspoken tail*, not the spoken prefix. That's deliberate:
 * `text_spoken` may be cumulative for the turn or only the sentence that was in
 * flight (we Speak+Flush one sentence at a time), but `text_remaining` is always
 * a suffix of the text we had queued — so it's the reliable landmark.
 *
 * @param {string} content   the full reply as it appears in the chat
 * @param {string} remaining Deepgram's `text_remaining`
 * @returns {{spoken: string, cut: string} | null} null when no confident match
 */
export function splitAtCut(content, remaining) {
  const text = content ?? "";
  const tail = (remaining ?? "").trim();
  if (!text || !tail) return null;

  // Exact match is the common case.
  const at = text.lastIndexOf(tail);
  if (at >= 0) return { spoken: text.slice(0, at), cut: text.slice(at) };

  // Punctuation or whitespace drift between what we queued and what came back:
  // fall back to the first few words of the tail, which is enough to locate it.
  const probe = tail.split(/\s+/).slice(0, 6).join(" ");
  if (probe.length >= 8) {
    const p = text.lastIndexOf(probe);
    if (p >= 0) return { spoken: text.slice(0, p), cut: text.slice(p) };
  }

  // No confident split — the caller shows the cut time without striking text.
  return null;
}

/** Fraction of a reply the listener actually heard, 0..1, or null if unknown. */
export function spokenFraction(parts) {
  if (!parts) return null;
  const total = parts.spoken.length + parts.cut.length;
  if (!total) return null;
  return parts.spoken.length / total;
}
