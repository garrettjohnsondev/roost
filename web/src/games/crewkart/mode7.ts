/** Crew Kart projection: the SNES Mode 7 trick. The track is a flat plane;
 *  a camera sits `h` world px above it, looking along angle `a`, with focal
 *  length `f` (screen px per unit of x/z) and the horizon on row `hor`.
 *  Pure math so it can be tested and shared by the ground and the sprites. */

export interface Cam7 {
  x: number; y: number; // ground position of the camera
  a: number; // heading
  h: number; // height above the plane
  f: number; // focal length in internal pixels
  hor: number; // horizon row
  W: number; H: number; // internal resolution
}

/** How far down the plane a screen row looks (world px), or Infinity at and
 *  above the horizon. */
export function rowDistance(c: Cam7, row: number): number {
  const dy = row + 0.5 - c.hor;
  return dy <= 0 ? Infinity : (c.h * c.f) / dy;
}

/** The world point under screen pixel (col,row) plus the per-column step, the
 *  numbers the scanline renderer walks. */
export function rowStart(c: Cam7, row: number): { x: number; y: number; dx: number; dy: number; dist: number } {
  const dist = rowDistance(c, row);
  const fx = Math.cos(c.a), fy = Math.sin(c.a);
  const rx = -fy, ry = fx; // right of travel (y points down in the world)
  const k = dist / c.f;
  const off = (0.5 - c.W / 2) * k;
  return { x: c.x + fx * dist + rx * off, y: c.y + fy * dist + ry * off, dx: rx * k, dy: ry * k, dist };
}

/** Screen position of a world point `lift` px above the ground; `s` is the
 *  scale (screen px per world px), `z` its depth. z <= 0 means behind. */
export function project(c: Cam7, x: number, y: number, lift = 0): { sx: number; sy: number; s: number; z: number } {
  const dx = x - c.x, dy = y - c.y;
  const fx = Math.cos(c.a), fy = Math.sin(c.a);
  const z = dx * fx + dy * fy;
  const xr = -dx * fy + dy * fx;
  if (z <= 0.01) return { sx: 0, sy: 0, s: 0, z };
  const s = c.f / z;
  return { sx: c.W / 2 + xr * s, sy: c.hor + (c.h - lift) * s, s, z };
}

/** A camera chasing a kart: `back` px behind it, framed so the kart sits
 *  near the bottom of the screen. */
export function chaseCam(W: number, H: number, x: number, y: number, a: number): Cam7 {
  const f = W * 0.5; // 90 degree field of view
  const hor = Math.round(H * 0.36);
  const back = 70;
  // Put the kart's contact point at 88% of the height.
  const h = ((H * 0.88 - hor) * back) / f;
  return { x: x - Math.cos(a) * back, y: y - Math.sin(a) * back, a, h, f, hor, W, H };
}
