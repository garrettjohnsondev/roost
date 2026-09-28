import { clamp, type Flick } from '../_sports/flick';

/** Penalty kicks. The spot is at z = 0, the goal line at z = 11 m. A shot is
 *  where it crosses the line, how long it takes, and how much it bends. */

export const SPOT = 11;
export const HALF_W = 3.66;
export const BAR_H = 2.44;
export const POST = 0.11;
export const SHOTS = 10;

export interface Shot { x: number; y: number; time: number; bend: number; curve: number }

export function shoot(f: Pick<Flick, 'speed' | 'angle' | 'curve'>): Shot {
  const curve = clamp(f.curve, -0.5, 0.5);
  const x = Math.tan(clamp(f.angle, -1, 1)) * SPOT * 0.9 - curve * 4;
  const y = clamp((f.speed - 0.55) * 1.6, 0.11, 5);
  const time = SPOT / clamp(12 + f.speed * 8, 12, 32);
  return { x, y, time, bend: curve * 8, curve };
}

/** Where the ball is at fraction u of its flight. It sets off along the
 *  swipe's first direction and bends back onto the line. */
export function shotAt(s: Shot, u: number) {
  const k = clamp(u, 0, 1);
  return { x: (s.x + s.bend) * k - s.bend * k * k, y: 0.11 + (s.y - 0.11) * k + 0.5 * k * (1 - k), z: SPOT * k };
}

export interface Dive { x: number; y: number; read: boolean }

/** The keeper gets smarter shot by shot: more often he reads the shot, and
 *  when he guesses he leans toward the side you keep picking. Slow shots
 *  are easier to read. r1..r3 are 0..1 randoms. */
export function keeperDive(s: Shot, n: number, history: number[], r1: number, r2: number, r3: number): Dive {
  const smart = clamp(0.12 + n * 0.055 + (s.time - 0.45) * 0.9, 0.05, 0.85);
  if (r1 < smart) {
    return { x: clamp(s.x + (r2 - 0.5) * 1.3, -2.6, 2.6), y: clamp(s.y + (r3 - 0.5) * 0.5, 0.4, 1.9), read: true };
  }
  const lefts = history.filter((h) => h < -0.9).length, rights = history.filter((h) => h > 0.9).length;
  const lean = history.length ? (rights - lefts) / history.length : 0; // -1..1
  const pRight = clamp(0.5 + lean * Math.min(1, n / 6) * 0.45, 0.1, 0.9);
  const middle = r2 < 0.12;
  const side = r3 < pRight ? 1 : -1;
  return { x: middle ? 0 : side * (1.5 + r2 * 1.1), y: 0.5 + r2 * 1.2, read: false };
}

export type Result = 'goal' | 'saved' | 'post' | 'wide' | 'over' | 'blocked';

export function resolve(s: Shot, d: Dive, wall: Wall | null = null): Result {
  if (wall && hitsWall(s, wall)) return 'blocked';
  const ax = Math.abs(s.x);
  if ((Math.abs(ax - HALF_W) < POST && s.y < BAR_H + POST) || (Math.abs(s.y - BAR_H) < POST && ax < HALF_W + POST)) return 'post';
  if (ax >= HALF_W) return 'wide';
  if (s.y >= BAR_H) return 'over';
  // Standing still he covers his middle; diving, a patch around his hands.
  const dx = (s.x - d.x) / 1.05, dy = (s.y - d.y) / 0.85;
  if (dx * dx + dy * dy < 1) return 'saved';
  if (Math.abs(s.x) < 0.45 && s.y < 1.9 && Math.abs(d.x) < 0.5) return 'saved';
  return 'goal';
}

export const isTopCorner = (s: Shot) => Math.abs(s.x) > HALF_W - 0.9 && s.y > BAR_H - 0.7;

/** Free kicks (wave 3): from the fourth shot on, every other shot has a wall
 *  of four crew 9.15 m out. It covers a 2 m stretch; go round it, bend it, or
 *  get it up over their heads. */
export const WALL_Z = 9.15;
export const WALL_H = 1.85;
export interface Wall { x0: number; x1: number }
export function wallFor(n: number, r: number): Wall | null {
  if (n < 3 || n % 2 === 0) return null;
  const c = (r * 2 - 1) * 1.6;
  return { x0: c - 1, x1: c + 1 };
}
export function hitsWall(s: Shot, w: Wall): boolean {
  const p = shotAt(s, WALL_Z / SPOT);
  return p.x > w.x0 - 0.12 && p.x < w.x1 + 0.12 && p.y < WALL_H;
}

/** A glowing target in one corner of the goal: put it there for a bonus. */
export interface Target { x: number; y: number }
export const TARGET_R = 0.75;
export function targetFor(r1: number, r2: number): Target {
  return { x: (r1 < 0.5 ? -1 : 1) * (HALF_W - 0.7), y: r2 < 0.5 ? 0.55 : BAR_H - 0.55 };
}
export const onTarget = (s: Shot, t: Target) => Math.hypot(s.x - t.x, s.y - t.y) < TARGET_R;

/** Points for a goal: one, a second for the target, the lot doubled on the
 *  clutch last shot. */
export const pointsFor = (goal: boolean, target: boolean, clutch: boolean) => (goal ? (1 + (target ? 1 : 0)) * (clutch ? 2 : 1) : 0);

/** A ghost's round, in points: Moss (0.2) scores four, Nell (0.95) thirteen. */
export const ghostScore = (strength: number) => Math.round(2 + 11.5 * strength);
