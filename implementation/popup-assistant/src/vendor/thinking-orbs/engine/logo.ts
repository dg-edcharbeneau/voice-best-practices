// Logo: the dots are ARRANGED to form the Deepgram logomark — a dotted
// halftone of the logo silhouette (not a shape morph, and not per-dot glyphs).
// The point cloud is precomputed by sampling the logomark silhouette (see
// logo-points.ts), normalized to a centred glyph in ~[-1, 1].
//
// Behaviour:
//   • a gentle per-dot shimmer keeps it alive while idle;
//   • `o.dotRot` (radians, clockwise — supplied by ThinkingOrb and eased when
//     the orb is "active") rotates the whole arrangement in place. +π/2 turns
//     the mark a quarter-turn clockwise.
// Flat (z = 0): depth here is carried by the shimmer + ink, not a sphere.

import type { Dot, ModeDraw } from './types';
import { hashD, paint } from './core';
import { LOGO_POINTS } from './logo-points';

// Mouth animation. Rotated a quarter-turn, the mark reads as a mouth, so while
// speaking we part the "lips": split the arrangement across a horizontal mouth
// line and push the two halves apart by `energy`, strongest at the centre and
// tapering to the corners (a hinge), so it opens and closes like a talking
// mouth. Tunables:
const MOUTH_OPEN = 0.34; // max lip travel, as a fraction of the mark radius
const MOUTH_LINE = 0.0; // mouth line, in screen-radius units from centre (−up)
const MOUTH_REACH = 1.0; // horizontal reach of the opening (1 = full width)

export const drawLogo: ModeDraw = (ctx, size, t, dark, o) => {
  const cx = size / 2;
  const cy = size / 2;

  // `energy` (0..1, the live eased TTS output level) drives the mouth. Zero
  // when not speaking → the mouth is closed and the logo is whole.
  const energy = Math.min(1, Math.max(0, o.energy ?? 0));

  const R = (size / 2) * 0.576; // 20% smaller than the previous 0.72 fit
  const rDot = (o.rDot ?? 0.03) * size;

  // While the face is on (speaking/listening/thinking → eyes shown), drop the
  // whole composition ~20% of the orb's half-height below centre so the eyes get
  // headroom above, and squash it vertically so the mark reads as a flatter
  // face. Idle stays centred and un-squashed.
  const cyf = cy + (o.eyes ? 0.2 * (size / 2) : 0);
  const vScale = o.eyes ? 0.8 : 1; // vertical compression when interactive

  const mouthY = cyf + MOUTH_LINE * R; // screen y of the mouth line

  // Rotate the arrangement (screen-clockwise for +angle in canvas y-down).
  const rot = o.dotRot ?? 0;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);

  const dots: Dot[] = [];
  for (let i = 0; i < LOGO_POINTS.length; i++) {
    const nx = LOGO_POINTS[i][0];
    const ny = LOGO_POINTS[i][1];
    const rx = nx * cosR - ny * sinR;
    const ry = nx * sinR + ny * cosR;

    let sx = cx + rx * R;
    let sy = cyf + ry * R * vScale;

    // Part the lips: displace each dot away from the mouth line, most at the
    // centre column and tapering to the sides (elliptical opening).
    if (energy > 0) {
      const dxN = (sx - cx) / (R * MOUTH_REACH); // 0 centre → ±1 sides
      const falloff = Math.max(0, 1 - dxN * dxN);
      const open = energy * MOUTH_OPEN * R * falloff;
      sy += (sy >= mouthY ? 1 : -1) * open;
    }

    // A slow size shimmer, phase-offset per dot, so the mark breathes even when
    // idle; `energy` grows/brightens the dots a touch as the mouth opens.
    const phase = hashD(i, 3.1) * Math.PI * 2;
    const pulse = 0.82 + 0.18 * Math.sin(t * 2 + phase);

    dots.push({
      x: sx,
      y: sy,
      z: 0,
      r: rDot * pulse * (1 + 0.15 * energy),
      white: 0.12 + 0.08 * hashD(i, 7.7) - 0.08 * energy
    });
  }

  // Eyes (`:D`): two bold dots above the mouth, in screen space (so the face is
  // upright regardless of the arrangement's rotation) and on top (high z).
  // Shown only while speaking.
  if (o.eyes) {
    // The rotated mark reaches ~0.95·R above centre; place the eyes well clear
    // of it with a comfortable gap above the face.
    const eyeY = mouthY - 1.45 * R * vScale;
    const eyeDx = 0.32 * R;
    const eyeR = rDot * 2.0;
    for (const dir of [-1, 1]) {
      dots.push({ x: cx + dir * eyeDx, y: eyeY, z: 1e6, r: eyeR, white: 0.04 });
    }
  }

  paint(ctx, dots, dark, o.rMin);
};
