/** Stack: planks slide across and drop onto the tower. World is WIDTH units wide. */
export const WIDTH = 300;
export const PERFECT = 5; // within this many units counts as a perfect drop

export interface Block { x: number; w: number }
export interface Drop { block: Block | null; perfect: boolean; cut: Block | null }

export function drop(top: Block, x: number, w: number): Drop {
  if (Math.abs(x - top.x) <= PERFECT) return { block: { x: top.x, w: top.w }, perfect: true, cut: null };
  const left = Math.max(top.x, x), right = Math.min(top.x + top.w, x + w);
  if (right <= left) return { block: null, perfect: false, cut: { x, w } };
  const block = { x: left, w: right - left };
  const cut = x < top.x ? { x, w: top.x - x } : { x: right, w: x + w - right };
  return { block, perfect: false, cut };
}

/** Units per second for the plank at this height: starts gentle, tops out. */
export const speed = (height: number) => Math.min(150 + height * 6, 380);

/** Advance a bouncing plank. Travels from -w/2.. to WIDTH - w/2 so it overhangs both edges a bit. */
export function slide(x: number, dir: 1 | -1, w: number, dt: number, height: number): { x: number; dir: 1 | -1 } {
  const lo = -w * 0.5, hi = WIDTH - w * 0.5;
  let nx = x + dir * speed(height) * dt, nd = dir;
  if (nx > hi) { nx = hi - (nx - hi); nd = -1; }
  if (nx < lo) { nx = lo + (lo - nx); nd = 1; }
  return { x: Math.max(lo, Math.min(hi, nx)), dir: nd };
}

export const base = (): Block => ({ x: 75, w: 150 });
