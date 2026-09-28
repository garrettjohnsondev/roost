import { seeded } from '../types';

/** Shared, pure rules for the sports pack (wave 3): how a ghost's score ticks
 *  up through a round, streak multipliers, and the clutch last attempt. */

/** A ghost's running score after each of `steps` beats of the round (index 0
 *  is before anything happens, the last entry is exactly `target`). Seeded,
 *  lumpy and never going down, so it reads like someone actually playing. */
export function ghostPace(target: number, steps: number, seed = 7): number[] {
  const n = Math.max(1, Math.round(steps));
  const t = Math.max(0, Math.round(target));
  const r = seeded(seed * 7919 + t * 31 + n);
  const w = Array.from({ length: n }, () => { const x = r(); return x < 0.3 ? 0 : x * x + 0.15; });
  let total = w.reduce((a, b) => a + b, 0);
  if (total === 0) { w[n - 1] = 1; total = 1; }
  const out = [0];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += w[i];
    out.push(i === n - 1 ? t : Math.round((t * acc) / total));
  }
  return out;
}

/** The ghost's score part-way through: `progress` 0..1 of the round. */
export function ghostAt(target: number, steps: number, progress: number, seed = 7): number {
  const p = ghostPace(target, steps, seed);
  const i = Math.max(0, Math.min(steps, Math.floor(progress * steps + 1e-9)));
  return p[i];
}

/** Streak multiplier: x1, then x2 from a 3-in-a-row, x3 from 5. */
export const streakMult = (streak: number) => (streak >= 5 ? 3 : streak >= 3 ? 2 : 1);

/** Is attempt `i` (0-based) of `n` the clutch one, worth double? */
export const isClutch = (i: number, n: number) => i === n - 1;

/** How many haptic ticks a make earns: the base, plus one for each step of a
 *  streak (capped, so a hot hand still doesn't buzz forever). */
export const makeTicks = (base: number, streak: number) => Math.min(6, base + Math.max(0, Math.min(3, streak - 1)));
