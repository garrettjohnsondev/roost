/** Shared, pure bits for the sports pack: reading a flick, a little seeded
 *  randomness, and a perspective projection. No DOM in here -- it's tested. */

export interface Pt { x: number; y: number; t: number }

export interface Flick {
  /** Chord of the whole swipe, in px (screen coords: +y is down). */
  dx: number;
  dy: number;
  length: number;
  /** Speed of the last stretch of the swipe, px per ms. */
  speed: number;
  /** Direction off straight-up, radians; + is to the right. */
  angle: number;
  /** Sideways bend of the path as a fraction of its length; + bulged right
   *  of the chord (so the finger finished heading left). Clamped to ±0.5. */
  curve: number;
}

/** Only the last this-many ms count toward speed, so a slow wind-up and a
 *  quick release reads as a quick flick. */
export const FLICK_WINDOW_MS = 180;

export function readFlick(pts: Pt[], minLength = 24): Flick | null {
  if (pts.length < 2) return null;
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < minLength) return null;

  let k = pts.length - 1;
  while (k > 0 && b.t - pts[k - 1].t <= FLICK_WINDOW_MS) k--;
  if (k === pts.length - 1) k = Math.max(0, k - 1);
  const s = pts[k];
  const recent = Math.hypot(b.x - s.x, b.y - s.y);
  const speed = recent / Math.max(8, b.t - s.t);

  const ux = dx / length, uy = dy / length;
  let bend = 0;
  for (const p of pts) {
    const side = ux * (p.y - a.y) - uy * (p.x - a.x);
    if (Math.abs(side) > Math.abs(bend)) bend = side;
  }
  const curve = Math.max(-0.5, Math.min(0.5, bend / length));
  const angle = Math.atan2(dx, -dy);
  return { dx, dy, length, speed, angle, curve };
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Behind-the-player camera. World: x right, y up, z away from you (m). */
export interface Cam { z: number; y: number; focal: number; cx: number; horizon: number }
export function project(c: Cam, x: number, y: number, z: number) {
  const d = Math.max(0.05, z - c.z);
  const s = c.focal / d;
  return { x: c.cx + x * s, y: c.horizon - (y - c.y) * s, s };
}
