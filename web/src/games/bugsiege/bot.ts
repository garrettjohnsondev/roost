import { MAPS, geo, posAt } from './logic';

/** Test helper: build spots ranked by how much road they cover, the way a player picks. */
export function order(m: number): number[] {
  const samples: [number, number][] = [];
  MAPS[m].paths.forEach((_, p) => { const g = geo(m, p); for (let d = 0; d < g.len; d += 0.25) samples.push(posAt(g, d)); });
  const cover = MAPS[m].spots.map(([c, r]) => samples.filter(([x, y]) => Math.hypot(x - c - 0.5, y - r - 0.5) <= 2.4).length);
  return cover.map((_, i) => i).sort((a, b) => cover[b] - cover[a]);
}
