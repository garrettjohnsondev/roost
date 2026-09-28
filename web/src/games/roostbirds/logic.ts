/** Pure helpers for Roost Birds' wave 3 additions: ghosts (their score and
 *  their best shot), the collapse haptics count, and the slow-mo clock. No
 *  DOM, no physics world: easy to test. */
import { GROUND_Y, levelValue, SCORE, type Level } from './levels';
import { seeded } from '../types';

export const GRAVITY = 600;
export const SLING_XY = { x: 110, y: GROUND_Y - 64 };
export const MAX_SPEED_V = 820;

/** The run score a ghost of this strength posts (the host checks your
 *  finished fort against it). 0.2 is roughly a clear of an early fort with a
 *  bird to spare; 0.95 needs a late fort demolished with two birds left. */
export function ghostScore(strength: number): number {
  const s = Math.max(0, Math.min(1, strength));
  return Math.round((15000 + 50000 * Math.pow(s, 1.5)) / 100) * 100;
}

/** What that ghost scored on this particular fort, for the HUD. */
export function ghostFortScore(l: Level, strength: number): number {
  const s = Math.max(0, Math.min(1, strength));
  const { bugs, blocks } = levelValue(l);
  const spare = Math.max(0, Math.min(l.birds.length - 1, Math.floor(s * (l.birds.length - 0.6))));
  return Math.round((bugs + blocks * (0.15 + 0.65 * s) + spare * SCORE.bird) / 10) * 10;
}

/** Launch velocity that lands a bird on (tx, ty) from the sling, flying at
 *  about `angle` radians above flat; steepens until the shot is possible. */
export function aimAt(tx: number, ty: number, angle = 0.55): { vx: number; vy: number } | null {
  const dx = tx - SLING_XY.x, h = SLING_XY.y - ty; // h: how far above the sling
  if (dx <= 0) return null;
  for (let a = angle; a < 1.45; a += 0.05) {
    const c = Math.cos(a), denom = 2 * c * c * (dx * Math.tan(a) - h);
    if (denom <= 0) continue;
    const v = Math.sqrt((GRAVITY * dx * dx) / denom);
    if (v <= MAX_SPEED_V) return { vx: v * c, vy: -v * Math.sin(a) };
  }
  return null;
}

/** The ghost's best shot on a fort: aimed at the first bug, a little off for
 *  a weak ghost (seeded, so it's the same arc every time you play it). */
export function ghostShot(l: Level, strength: number, seed = 1): { vx: number; vy: number } {
  const bug = l.bugs.reduce((m, b) => (b.x < m.x ? b : m), l.bugs[0]);
  const r = seeded(seed * 7919 + l.name.length * 31 + Math.round(strength * 100));
  const miss = (1 - Math.max(0, Math.min(1, strength))) * 0.12;
  const shot = aimAt(bug.x, GROUND_Y - bug.y, 0.5 + (r() - 0.5) * 0.1) ?? { vx: 600, vy: -400 };
  const k = 1 + (r() - 0.5) * 2 * miss;
  return { vx: shot.vx * k, vy: shot.vy * k };
}

/** A flight arc from the sling until it meets the ground or leaves the map. */
export function arc(vx: number, vy: number, maxX: number, every = 0.04): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 1; i < 400; i++) {
    const t = i * every;
    const x = SLING_XY.x + vx * t, y = SLING_XY.y + vy * t + 0.5 * GRAVITY * t * t;
    pts.push({ x, y });
    if (y > GROUND_Y || x > maxX) break;
  }
  return pts;
}

/** How many haptic ticks a collapse earns: one per piece that broke or got
 *  knocked loose in the second after impact, capped at 12. */
export function collapseTicks(broken: number, moved: number): number {
  const n = Math.round(broken + moved * 0.6);
  return Math.max(0, Math.min(12, n));
}

/** Did this block move enough to count as knocked over? */
export function knocked(from: { x: number; y: number; a: number }, to: { x: number; y: number; a: number }): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) > 5 || Math.abs(to.a - from.a) > 0.25;
}

/** Slow motion after the last bug: 0.3x for a moment, easing back to 1. */
export const SLOWMO_SECS = 1.1;
export function timeScale(slowmoLeft: number): number {
  if (slowmoLeft <= 0) return 1;
  const k = slowmoLeft / SLOWMO_SECS; // 1 -> 0
  return k > 0.35 ? 0.28 : 0.28 + (1 - k / 0.35) * 0.72;
}
