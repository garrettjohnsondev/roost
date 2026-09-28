import { clamp, type Flick } from '../_sports/flick';

/** Flick shooting. The ball leaves the hand at z = 0; the rim hangs at
 *  z = HOOP_Z, RIM_Y up, centred on a hoop x that may be moving. */

export const G = 9.8;
export const HOOP_Z = 4.5;
export const RIM_Y = 3.05;
export const RIM_R = 0.3;
export const BALL_R = 0.12;
export const BOARD_Z = HOOP_Z + RIM_R + 0.15;
export const BOARD_HALF = 0.9;
export const BOARD_LOW = 2.9;
export const BOARD_HIGH = 3.7;
export const ROUND_SECONDS = 60;
const ELEVATION = (58 * Math.PI) / 180;

export interface Ball { x: number; y: number; z: number; vx: number; vy: number; vz: number; touched: boolean; scored: boolean; done: boolean; hits?: number }

export function launch(f: Pick<Flick, 'speed' | 'angle'>): Ball {
  const v = clamp(7.3 + f.speed * 0.75, 6.3, 10.8);
  const vz = v * Math.cos(ELEVATION);
  return { x: 0, y: 1, z: 0, vx: vz * Math.tan(clamp(f.angle * 0.35, -0.4, 0.4)), vy: v * Math.sin(ELEVATION), vz, touched: false, scored: false, done: false };
}

/** The hoop drifts side to side once you're scoring well. */
export function hoopMotion(score: number): { amp: number; speed: number } {
  if (score >= 30) return { amp: 0.9, speed: 1.6 };
  if (score >= 12) return { amp: 0.6, speed: 1.0 };
  return { amp: 0, speed: 0 };
}
export const hoopX = (score: number, t: number) => {
  const m = hoopMotion(score);
  return m.amp * Math.sin(t * m.speed);
};

export function step(b: Ball, dt: number, hx: number): Ball {
  if (b.done) return b;
  let n: Ball = { ...b, vy: b.vy - G * dt };
  n.x += n.vx * dt; n.y += n.vy * dt; n.z += n.vz * dt;

  // Backboard (front face)
  if (b.z <= BOARD_Z - BALL_R && n.z > BOARD_Z - BALL_R && n.y > BOARD_LOW && n.y < BOARD_HIGH && Math.abs(n.x - hx) < BOARD_HALF) {
    n.z = BOARD_Z - BALL_R;
    n.vz = -Math.abs(n.vz) * 0.8;
    n.vx *= 0.8;
    n.touched = true;
    n.hits = (n.hits ?? 0) + 1;
  }

  // Rim: nearest point on the ring
  const dx = n.x - hx, dz = n.z - HOOP_Z;
  const d = Math.hypot(dx, dz) || 1e-6;
  const rx = hx + (dx / d) * RIM_R, rz = HOOP_Z + (dz / d) * RIM_R;
  const ox = n.x - rx, oy = n.y - RIM_Y, oz = n.z - rz;
  const dist = Math.hypot(ox, oy, oz);
  if (dist < BALL_R) {
    const nx = ox / dist, ny = oy / dist, nz = oz / dist;
    const vn = n.vx * nx + n.vy * ny + n.vz * nz;
    if (vn < 0) {
      n.vx -= 1.6 * vn * nx; n.vy -= 1.6 * vn * ny; n.vz -= 1.6 * vn * nz;
      n.hits = (n.hits ?? 0) + 1;
    }
    const push = BALL_R - dist;
    n.x += nx * push; n.y += ny * push; n.z += nz * push;
    n.touched = true;
  }

  // Through the hoop, going down
  if (!n.scored && b.y >= RIM_Y && n.y < RIM_Y && n.vy < 0) {
    const t = (b.y - RIM_Y) / (b.y - n.y);
    const cx = b.x + (n.x - b.x) * t - hx, cz = b.z + (n.z - b.z) * t - HOOP_Z;
    if (Math.hypot(cx, cz) < RIM_R - BALL_R * 0.35) n = { ...n, scored: true };
  }

  if (n.y < BALL_R || n.z > 8 || n.z < -3 || (n.scored && n.y < RIM_Y - 1)) n.done = true;
  return n;
}

export function simulate(b: Ball, hx = 0): { made: boolean; swish: boolean } {
  let cur = b;
  for (let i = 0; i < 1200 && !cur.done; i++) cur = step(cur, 1 / 240, hx);
  return { made: cur.scored, swish: cur.scored && !cur.touched };
}

/** Wave 3: three makes in a row sets the ball on fire (double points until
 *  a miss), every fifth ball is a gold money ball (+2), and the last ten
 *  seconds are clutch time (double again). */
export const FIRE_AT = 3;
export const CLUTCH_SECONDS = 10;
export const isMoney = (shotIndex: number) => (shotIndex + 1) % 5 === 0;
export const onFire = (makeRun: number) => makeRun >= FIRE_AT;
export const isClutchTime = (left: number) => left > 0 && left <= CLUTCH_SECONDS;
export const multiplier = (fire: boolean, clutch: boolean) => 1 + (fire ? 1 : 0) + (clutch ? 1 : 0);

export function pointsFor(swish: boolean, o: { fire?: boolean; money?: boolean; clutch?: boolean } = {}): number {
  return ((swish ? 3 : 2) + (o.money ? 2 : 0)) * multiplier(!!o.fire, !!o.clutch);
}

/** A ghost's sixty seconds: Moss (0.2) posts about 19, Nell (0.95) about 74. */
export const ghostScore = (strength: number) => Math.round(4 + 74 * strength);
