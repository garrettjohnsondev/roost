import { clamp, type Flick } from '../_sports/flick';
import { streakMult } from '../_sports/pace';

/** Field goal physics, in metres and seconds. x is across the field (+ right),
 *  y is up, z is toward the posts. The ball is kicked from z = 0. */

export const G = 9.8;
export const BAR = 3.05;
export const HALF = 2.82; // half the width between the uprights
export const POST_R = 0.12;
export const ATTEMPTS = 10;
export const START_YARDS = 20;
export const STEP_YARDS = 5;
export const MAX_YARDS = 60;
const ELEVATION = (38 * Math.PI) / 180;

export const metres = (yards: number) => yards * 0.9144;

export interface Ball { x: number; y: number; z: number; vx: number; vy: number; vz: number; hook: number }
export type Outcome = 'good' | 'doink' | 'short' | 'wide-left' | 'wide-right';

/** Weather for a kick (wave 3): rain makes the ball heavy (less power), a
 *  gusty day swings the wind while the ball is in the air. */
export type Weather = 'clear' | 'rain' | 'gusty';
export function weatherFor(attempt: number, r: number): Weather {
  if (attempt < 2) return 'clear';
  return r < 0.22 ? 'rain' : r < 0.44 ? 'gusty' : 'clear';
}
export const RAIN_POWER = 0.9;

/** A flick becomes a kick: speed is power, the angle aims, and a bent
 *  swipe hooks the ball the way the finger finished. */
export function kick(f: Pick<Flick, 'speed' | 'angle' | 'curve'>, weather: Weather = 'clear'): Ball {
  const v = clamp(9 + f.speed * 8.5, 9, 29) * (weather === 'rain' ? RAIN_POWER : 1);
  const aim = clamp(f.angle * 0.55, -0.6, 0.6);
  const vz = v * Math.cos(ELEVATION);
  return { x: 0, y: 0.15, z: 0, vx: vz * Math.tan(aim), vy: v * Math.sin(ELEVATION), vz, hook: -f.curve * 12 };
}

/** Sideways push from the wind, m/s² (+ blows right). Gets stronger the
 *  further back you are. `r` is a 0..1 random. */
export function windFor(yards: number, r: number): number {
  const max = Math.min(3.2, 0.5 + Math.max(0, yards - START_YARDS) * 0.075);
  return Math.round((r * 2 - 1) * max * 10) / 10;
}
/** The wind, as the arrow says it. */
export const windMph = (w: number) => Math.round(Math.abs(w) * 6);

/** The wind right now: steady, or on a gusty day swelling to half again and
 *  dropping away, `t` seconds into the flight. */
export const windNow = (wind: number, weather: Weather, t: number) => (weather === 'gusty' ? wind * (1 + 0.6 * Math.sin(t * 3.2)) : wind);

export function step(b: Ball, wind: number, dt: number): Ball {
  const vx = b.vx + (b.hook + wind) * dt;
  const vy = b.vy - G * dt;
  return { ...b, vx, vy, x: b.x + vx * dt, y: b.y + vy * dt, z: b.z + b.vz * dt };
}

/** Did the ball's move from a to b decide the kick? */
export function judge(a: Ball, b: Ball, dist: number): Outcome | null {
  if (a.z < dist && b.z >= dist) {
    const t = (dist - a.z) / (b.z - a.z);
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    if (Math.abs(Math.abs(x) - HALF) < POST_R && y > BAR - POST_R) return 'doink';
    if (Math.abs(y - BAR) < POST_R && Math.abs(x) < HALF) return 'doink';
    if (y < BAR) return 'short';
    if (x <= -HALF) return 'wide-left';
    if (x >= HALF) return 'wide-right';
    return 'good';
  }
  if (b.y <= 0 && b.z < dist) return 'short';
  return null;
}

/** Runs a kick to the end (for tests, and for "what would've happened"). */
export function simulate(ball: Ball, wind: number, dist: number, weather: Weather = 'clear'): Outcome {
  let b = ball;
  for (let i = 0; i < 1200; i++) {
    const n = step(b, windNow(wind, weather, i / 120), 1 / 120);
    const o = judge(b, n, dist);
    if (o) return o;
    b = n;
  }
  return 'short';
}

/** How far through the posts it went: 0 on the upright, 1 dead centre. */
export const centred = (x: number) => clamp(1 - Math.abs(x) / HALF, 0, 1);

/** Points for a make: longer kicks are worth more, a streak multiplies it, a
 *  kick down the middle earns a bonus point, and the clutch last kick doubles
 *  the lot. */
export function pointsFor(yards: number, streak = 1, clutch = false, middle = false): number {
  const base = Math.max(1, Math.round(yards / 10)) + (middle ? 1 : 0);
  return base * streakMult(streak) * (clutch ? 2 : 1);
}
export const nextYards = (yards: number, made: boolean) => (made ? Math.min(MAX_YARDS, yards + STEP_YARDS) : yards);

/** A ghost's round, in points: Moss (0.2) is a casual kicker, Nell (0.95)
 *  runs the table with multipliers. */
export const ghostScore = (strength: number) => Math.round(4 + 40 * strength + 40 * strength * strength);
