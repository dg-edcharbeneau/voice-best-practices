// The ThinkingOrb component. One shared clock (performance.now) keeps
// every mounted orb in phase; each instance runs its own rAF loop but
// pauses automatically while offscreen (IntersectionObserver) or when
// the tab is hidden (visibilitychange). Reduced-motion users get a
// static representative frame that still follows the live theme.

import { useEffect, useRef } from 'react';
import { MODE_DRAWS } from './engine/registry';
import { resolvePreset } from './presets';
import { useReducedMotion, useResolvedDark } from './theme';
import type { ThinkingOrbProps } from './types';

const LABELS: Record<string, string> = {
  working: 'Working…',
  searching: 'Searching…',
  solving: 'Solving…',
  listening: 'Listening…',
  composing: 'Composing…',
  shaping: 'Shaping…'
};

export function ThinkingOrb({
  state = 'working',
  size = 64,
  theme = 'auto',
  speed = 1,
  paused = false,
  dotActive = false,
  energy = 0,
  eyes = false,
  style,
  'aria-label': ariaLabel,
  ...rest
}: ThinkingOrbProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const dark = useResolvedDark(theme, ref);
  const reduced = useReducedMotion();

  // `dotActive` / `energy` are read live inside the render loop (via refs) so
  // updating them never restarts the animation. `rotRef` persists across effect
  // re-runs (a state change swaps the animation mode) so the arrangement's
  // quarter-turn eases smoothly rather than snapping when the orb goes
  // active/idle; `energyRef` likewise smooths the voice-reactive pulse.
  const dotActiveRef = useRef(dotActive);
  dotActiveRef.current = dotActive;
  const energyTargetRef = useRef(energy);
  energyTargetRef.current = energy;
  const eyesRef = useRef(eyes);
  eyesRef.current = eyes;
  const rotRef = useRef<number | null>(null);
  const energyRef = useRef(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { mode, speed: baseSpeed, opts } = resolvePreset(state, size);
    const draw = MODE_DRAWS[mode];
    const effSpeed = baseSpeed * speed;

    // The active arrangement rotates a quarter-turn clockwise (π/2).
    const targetRot = () => (dotActiveRef.current ? Math.PI / 2 : 0);
    if (rotRef.current === null) rotRef.current = targetRot();

    const frame = (tSec: number) => {
      // Ease the arrangement rotation toward its target each frame.
      const target = targetRot();
      let rot = rotRef.current ?? target;
      rot += (target - rot) * 0.18;
      if (Math.abs(target - rot) < 0.002) rot = target;
      rotRef.current = rot;

      // Ease the voice-reactive pulse toward the live level (snappier).
      const e = energyRef.current + (energyTargetRef.current - energyRef.current) * 0.3;
      energyRef.current = e;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      draw(ctx, size, tSec, dark, {
        ...opts,
        dotRot: rot,
        energy: e,
        eyes: eyesRef.current ? 1 : 0
      });
    };

    // reduced motion → one static, deterministic frame
    if (reduced) {
      frame(0.6);
      return;
    }

    let raf = 0;
    let running = false;
    const loop = () => {
      frame((performance.now() / 1000) * effSpeed);
      if (running) raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running || paused) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    // draw at least one frame even when paused/offscreen
    frame((performance.now() / 1000) * effSpeed);

    // pause offscreen + on hidden tabs — free when not visible
    let visible = true;
    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (visible && document.visibilityState !== 'hidden') start();
            else stop();
          })
        : null;
    io?.observe(canvas);
    const onVis = () => {
      if (document.visibilityState === 'hidden') stop();
      else if (visible) start();
    };
    document.addEventListener('visibilitychange', onVis);
    if (!io) start();

    return () => {
      stop();
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [state, size, dark, speed, paused, reduced]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={ariaLabel ?? LABELS[state]}
      style={{ width: size, height: size, display: 'block', ...style }}
      {...rest}
    />
  );
}
