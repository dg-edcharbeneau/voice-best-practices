# Vendored: thinking-orbs

The dotted "thinking orb" canvas component used for the assistant's status orb,
vendored so the widget stays self-contained with no external dependency.

- Source: https://github.com/dg-edcharbeneau/thinking-orbs
- License: MIT (see `LICENSE` in this folder)

## Local modifications

Added a new **`logo` state**: the dots are *arranged* to form the Deepgram
logomark (a dotted halftone of the mark), and the whole arrangement rotates a
quarter-turn clockwise when the orb is "active". Dots themselves stay circles —
upstream's `paint()` is unchanged.

- `engine/logo-points.ts` — a precomputed dot cloud sampling the logomark
  silhouette, normalized to a centred glyph in ~[-1, 1] (canvas y-down). The
  silhouette comes from Deepgram's official pinned-tab SVG. To regenerate: parse
  that path → flatten to a polygon → jittered grid-sample the interior.
- `engine/logo.ts` — the `logo` mode: places the cloud, applies a per-dot
  shimmer, and rotates the arrangement by `o.dotRot`.
- `engine/registry.ts`, `presets.ts`, `engine/profiles.ts`, `types.ts` — wire
  the `logo` mode/state (`ModeKey`, `STATE_TO_MODE`, `PRESETS`, `BASE_PROFILES`,
  `OrbState`) through the same machinery as the built-in states.
- `ThinkingOrb.tsx` + `types.ts` — new prop `dotActive` (default `false`):
  eases the `logo` arrangement to a quarter-turn clockwise. Read live via a ref,
  with the rotation persisted across effect re-runs so it never snaps.

All six original states are untouched; the additions are purely additive.

Public surface used here: `ThinkingOrb` from `./index.ts`. Six states
(`working`, `searching`, `solving`, `listening`, `composing`, `shaping`), two
tuned sizes (`64`, `20`), `theme="auto"` (follows OS / ancestor `data-theme`),
`speed`, and `paused`. See `types.ts`.

The popup maps its voice states onto the orb states in
[`../../components/VoiceOrb.jsx`](../../components/VoiceOrb.jsx) (`ORB_STATE`).
To update, re-copy `src/` from the upstream repo into this folder.
