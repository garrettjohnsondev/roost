/** Stack: planks slide across and drop onto the tower. World is WIDTH units wide. */
export const WIDTH = 300;
export const PERFECT = 5; // within this many units counts as a perfect drop
export const MAX_W = 150;

export interface Block { x: number; w: number }
export interface Drop { block: Block | null; perfect: boolean; cut: Block | null }

/** Drop a plank at x onto top. `snap` widens the perfect window (the magnet). */
export function drop(top: Block, x: number, w: number, snap = PERFECT): Drop {
  if (Math.abs(x - top.x) <= snap) return { block: { x: top.x, w: top.w }, perfect: true, cut: null };
  const left = Math.max(top.x, x), right = Math.min(top.x + top.w, x + w);
  if (right <= left) return { block: null, perfect: false, cut: { x, w } };
  const block = { x: left, w: right - left };
  const cut = x < top.x ? { x, w: top.x - x } : { x: right, w: x + w - right };
  return { block, perfect: false, cut };
}

/** Units per second for the plank at this height: starts gentle, tops out. */
export const speed = (height: number) => Math.min(150 + height * 6, 380);

/** Advance a bouncing plank. Travels from -w/2.. to WIDTH - w/2 so it overhangs both edges a bit. */
export function slide(x: number, dir: 1 | -1, w: number, dt: number, height: number, mul = 1): { x: number; dir: 1 | -1 } {
  const lo = -w * 0.5, hi = WIDTH - w * 0.5;
  let nx = x + dir * speed(height) * mul * dt, nd = dir;
  if (nx > hi) { nx = hi - (nx - hi); nd = -1; }
  if (nx < lo) { nx = lo + (lo - nx); nd = 1; }
  return { x: Math.max(lo, Math.min(hi, nx)), dir: nd };
}

export const base = (): Block => ({ x: 75, w: MAX_W });

/** Streak growth: from the third perfect in a row, each perfect widens the
 *  plank a little (centered), up to the starting width. */
export function grow(b: Block, combo: number): Block {
  if (combo < 3 || b.w >= MAX_W) return b;
  const w = Math.min(MAX_W, b.w + 8);
  const x = Math.max(0, Math.min(WIDTH - w, b.x - (w - b.w) / 2));
  return { x, w };
}

/** Windy levels: in the upper part of every ten (from 10 up) the tower sways.
 *  Returns the sway offset in world units at time t (seconds). */
export const windy = (height: number) => height >= 10 && height % 10 >= 6;
export function sway(height: number, t: number): number {
  if (!windy(height)) return 0;
  const amp = Math.min(34, 12 + (height - 10) * 0.6);
  return Math.sin(t * (1.6 + Math.min(1.2, height / 60))) * amp;
}

/** Power-up planks. grow: +40 width. slow: the next 5 planks move at 60%.
 *  magnet: the next 3 drops snap as perfect from 18 units away. */
export type Power = 'grow' | 'slow' | 'magnet';
export const POWERS: Power[] = ['grow', 'slow', 'magnet'];
/** Which power (if any) the plank for this height carries: one every 7 levels
 *  from 5 up, picked by the height so it's the same for everyone. */
export function powerFor(height: number): Power | null {
  if (height < 5 || height % 7 !== 5) return null;
  return POWERS[Math.floor(height / 7) % POWERS.length];
}

export interface Buffs { slow: number; magnet: number }
export function applyPower(p: Power, b: Block, buffs: Buffs): { block: Block; buffs: Buffs } {
  if (p === 'grow') {
    const w = Math.min(MAX_W, b.w + 40);
    return { block: { x: Math.max(0, Math.min(WIDTH - w, b.x - (w - b.w) / 2)), w }, buffs };
  }
  if (p === 'slow') return { block: b, buffs: { ...buffs, slow: 5 } };
  return { block: b, buffs: { ...buffs, magnet: 3 } };
}

/** Sky by height: day, then sunset, night, and space. 0..1 per phase. */
export function skyPhase(height: number): { day: number; dusk: number; night: number; space: number } {
  const c = (v: number) => Math.max(0, Math.min(1, v));
  return {
    day: c(1 - height / 20),
    dusk: c(Math.min(height / 15, (40 - height) / 15)),
    night: c(Math.min((height - 25) / 15, (80 - height) / 20)),
    space: c((height - 60) / 20),
  };
}

/** What a ghost of this strength builds: Haiku ~15 planks, Astra ~60. */
export const ghostScore = (s: number) => Math.round(8 + 55 * s ** 1.3);
