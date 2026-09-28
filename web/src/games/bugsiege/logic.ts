/** Bug Siege: the pure simulation, Kingdom Rush style. Bugs walk a readable
 *  road (a polyline in world units) toward the repo; four tower types sit on
 *  fixed build spots; a hero bird walks where you tap and brawls in melee.
 *  Everything is plain JSON so a run can be saved mid-map and tested without
 *  a canvas. render.ts draws it, index.tsx owns the screens and input. */

export const W = 30;
export const H = 14;
export const DT = 1 / 60;
export const START_LIVES = 20;
export const WAVE_GAP = 20;
export const SELL_BACK = 0.7;
export const PATH_HALF = 0.62;

// ---------------------------------------------------------------- towers

export type Kind = 'pecker' | 'mortar' | 'sniper' | 'frost';
export type SpecId = 'swarm' | 'talon' | 'cluster' | 'quake' | 'deadeye' | 'piercer' | 'blizzard' | 'shatter';

export interface Stats {
  range: number; dmg: number; rate: number;
  air: boolean; ground: boolean;
  splash?: number; slow?: number; slowFor?: number; pierce?: number;
  crit?: number; stun?: number; amp?: number; pulse?: boolean; multi?: number; airBonus?: number;
}
export interface SpecDef { id: SpecId; name: string; crew: string; blurb: string; cost: number; stats: Stats }
export interface TowerDef {
  kind: Kind; name: string; crew: string; role: string; color: string;
  target: 'first' | 'strong'; shot: 'bolt' | 'shell' | 'snipe' | 'frost';
  costs: [number, number, number]; levels: [Stats, Stats, Stats]; specs: [SpecDef, SpecDef];
}

export const TOWERS: Record<Kind, TowerDef> = {
  pecker: {
    kind: 'pecker', name: 'Pecker', crew: 'moss', role: 'Fast pecks, hits flyers', color: '#7bd66b', target: 'first', shot: 'bolt',
    costs: [70, 60, 90],
    levels: [
      { range: 2.6, dmg: 5, rate: 2.2, air: true, ground: true },
      { range: 2.8, dmg: 8, rate: 2.5, air: true, ground: true },
      { range: 3.0, dmg: 12, rate: 2.8, air: true, ground: true },
    ],
    specs: [
      { id: 'swarm', name: 'Swarm', crew: 'moss', blurb: 'Pecks two bugs at once', cost: 200, stats: { range: 3.1, dmg: 15, rate: 3.4, multi: 2, air: true, ground: true } },
      { id: 'talon', name: 'Talon', crew: 'wren', blurb: 'Heavy pecks, triple vs flyers', cost: 200, stats: { range: 3.3, dmg: 26, rate: 2.6, airBonus: 3, air: true, ground: true } },
    ],
  },
  mortar: {
    kind: 'mortar', name: 'Nest Mortar', crew: 'bram', role: 'Lobs eggs, splash on the ground', color: '#ff9a3c', target: 'first', shot: 'shell',
    costs: [110, 100, 140],
    levels: [
      { range: 2.9, dmg: 14, rate: 0.6, splash: 1.0, air: false, ground: true },
      { range: 3.1, dmg: 24, rate: 0.65, splash: 1.1, air: false, ground: true },
      { range: 3.3, dmg: 38, rate: 0.7, splash: 1.2, air: false, ground: true },
    ],
    specs: [
      { id: 'cluster', name: 'Cluster Egg', crew: 'bram', blurb: 'Huge blast radius', cost: 260, stats: { range: 3.5, dmg: 60, rate: 0.7, splash: 1.8, air: false, ground: true } },
      { id: 'quake', name: 'Quake Egg', crew: 'otto', blurb: 'Blasts stun the pack', cost: 260, stats: { range: 3.4, dmg: 50, rate: 0.75, splash: 1.35, stun: 0.8, air: false, ground: true } },
    ],
  },
  sniper: {
    kind: 'sniper', name: 'Sniper Perch', crew: 'nell', role: 'Long range, picks the toughest', color: '#c68cff', target: 'strong', shot: 'snipe',
    costs: [120, 110, 160],
    levels: [
      { range: 4.6, dmg: 30, rate: 0.45, pierce: 0.3, air: true, ground: true },
      { range: 5.1, dmg: 55, rate: 0.5, pierce: 0.3, air: true, ground: true },
      { range: 5.6, dmg: 90, rate: 0.55, pierce: 0.35, air: true, ground: true },
    ],
    specs: [
      { id: 'deadeye', name: 'Deadeye', crew: 'nell', blurb: '1 in 4 shots hits for triple', cost: 280, stats: { range: 6.4, dmg: 150, rate: 0.55, crit: 0.25, pierce: 0.4, air: true, ground: true } },
      { id: 'piercer', name: 'Armor-piercer', crew: 'ollie', blurb: 'Ignores all armor, fires faster', cost: 280, stats: { range: 5.8, dmg: 120, rate: 0.8, pierce: 1, air: true, ground: true } },
    ],
  },
  frost: {
    kind: 'frost', name: 'Frost Beacon', crew: 'tuck', role: 'Slows the line', color: '#8ef0ff', target: 'first', shot: 'frost',
    costs: [80, 70, 100],
    levels: [
      { range: 2.4, dmg: 3, rate: 1.0, slow: 0.35, slowFor: 1.5, air: true, ground: true },
      { range: 2.6, dmg: 5, rate: 1.1, slow: 0.45, slowFor: 1.6, air: true, ground: true },
      { range: 2.8, dmg: 8, rate: 1.2, slow: 0.55, slowFor: 1.8, air: true, ground: true },
    ],
    specs: [
      { id: 'blizzard', name: 'Blizzard', crew: 'tuck', blurb: 'Freezes everything in range', cost: 220, stats: { range: 3.0, dmg: 12, rate: 0.9, slow: 0.6, slowFor: 1.6, pulse: true, air: true, ground: true } },
      { id: 'shatter', name: 'Shatter', crew: 'juno', blurb: 'Chilled bugs take +50% damage', cost: 220, stats: { range: 3.1, dmg: 16, rate: 1.4, slow: 0.55, slowFor: 2.2, amp: 0.5, air: true, ground: true } },
    ],
  },
};
export const KINDS: Kind[] = ['pecker', 'mortar', 'sniper', 'frost'];

// ---------------------------------------------------------------- bugs

export type BugKind = 'mite' | 'moth' | 'beetle' | 'gnat' | 'healer' | 'stag' | 'leak' | 'blob';
export interface BugDef {
  name: string; role: string; hp: number; speed: number; armor: number; bounty: number; lives: number;
  size: number; bite: number; fly?: boolean; heal?: number; boss?: boolean; splits?: number;
}
export const BUGS: Record<BugKind, BugDef> = {
  mite: { name: 'Mite', role: 'Plain bug', hp: 22, speed: 1.0, armor: 0, bounty: 5, lives: 1, size: 0.28, bite: 4 },
  moth: { name: 'Moth', role: 'Fast', hp: 16, speed: 2.0, armor: 0, bounty: 5, lives: 1, size: 0.28, bite: 3 },
  beetle: { name: 'Beetle', role: 'Armored', hp: 60, speed: 0.7, armor: 0.5, bounty: 10, lives: 1, size: 0.34, bite: 7 },
  gnat: { name: 'Gnat', role: 'Flies over melee', hp: 20, speed: 1.35, armor: 0, bounty: 6, lives: 1, size: 0.24, bite: 0, fly: true },
  healer: { name: 'Patch Bug', role: 'Heals its friends', hp: 45, speed: 0.8, armor: 0.1, bounty: 12, lives: 1, size: 0.32, bite: 3, heal: 7 },
  stag: { name: 'Stag Beetle', role: 'Heavy armor', hp: 230, speed: 0.55, armor: 0.45, bounty: 25, lives: 2, size: 0.44, bite: 14 },
  leak: { name: 'Memory Leak', role: 'Boss. Splits when popped', hp: 1700, speed: 0.33, armor: 0.3, bounty: 150, lives: 10, size: 0.8, bite: 30, boss: true, splits: 4 },
  blob: { name: 'Leaklet', role: 'Bits of the Leak', hp: 90, speed: 0.9, armor: 0, bounty: 8, lives: 1, size: 0.3, bite: 6 },
};

// ---------------------------------------------------------------- maps

export type Pt = [number, number];
export type Theme = 'meadow' | 'autumn' | 'swamp' | 'desert' | 'snow' | 'night';
/** kind, count, gap seconds, start delay, path index */
export type Group = [BugKind, number, number, number?, number?];
export interface MapDef {
  id: string; name: string; theme: Theme; story: string;
  paths: Pt[][]; spots: Pt[]; hero: Pt; coins: number; hpMul: number; waves: Group[][];
}

export const MAPS: MapDef[] = [
  {
    id: 'meadow', name: 'Green Branch', theme: 'meadow', coins: 260, hpMul: 1,
    story: 'A few bugs have found the meadow. Show them the way out.',
    paths: [[[-1, 4], [8, 4], [8, 10], [18, 10], [18, 4], [25, 4], [25, 9], [31, 9]]],
    spots: [[6, 6], [10, 7], [10, 2.3], [13, 8], [15, 12], [16, 7], [20, 6], [22, 2.3], [23, 6.5], [27, 7], [5.5, 2.3], [13, 12]],
    hero: [13, 10],
    waves: [
      [['mite', 8, 1.3]],
      [['mite', 10, 1], ['moth', 4, 0.8, 7]],
      [['beetle', 4, 2.2], ['mite', 8, 1, 3]],
      [['gnat', 6, 1.1], ['mite', 10, 0.8, 4]],
      [['moth', 12, 0.5], ['beetle', 5, 1.6, 5]],
      [['healer', 2, 3], ['beetle', 6, 1.4, 2], ['mite', 14, 0.6, 6], ['gnat', 6, 0.9, 10]],
    ],
  },
  {
    id: 'autumn', name: 'Autumn Fork', theme: 'autumn', coins: 300, hpMul: 1.1,
    story: 'Two trails, one repo. They are coming from both sides.',
    paths: [
      [[-1, 3], [9, 3], [9, 7], [16, 7], [16, 11], [24, 11], [24, 6], [31, 6]],
      [[-1, 11], [5, 11], [5, 7], [16, 7], [16, 11], [24, 11], [24, 6], [31, 6]],
    ],
    spots: [[7, 5], [11, 5], [3, 9], [7, 9], [11, 9], [14, 5], [18, 9], [14, 12.5], [21, 9], [22, 13], [26, 8.5], [26, 3.8], [29, 3.8]],
    hero: [12, 7],
    waves: [
      [['mite', 8, 1.2, 0, 0], ['mite', 6, 1.4, 3, 1]],
      [['moth', 8, 0.7, 0, 0], ['mite', 8, 1, 2, 1]],
      [['beetle', 5, 1.8, 0, 1], ['gnat', 6, 1, 3, 0]],
      [['moth', 10, 0.5, 0, 0], ['moth', 10, 0.5, 2, 1], ['healer', 2, 3, 6, 0]],
      [['beetle', 8, 1.2, 0, 0], ['mite', 14, 0.6, 1, 1], ['gnat', 8, 0.8, 8, 1]],
      [['stag', 2, 5, 0, 0], ['healer', 3, 2.5, 3, 1], ['moth', 12, 0.4, 6, 1]],
      [['gnat', 14, 0.6, 0, 0], ['beetle', 8, 1.1, 2, 1]],
      [['stag', 3, 4, 0, 1], ['healer', 3, 2, 2, 0], ['mite', 20, 0.4, 4, 0], ['moth', 12, 0.5, 8, 1]],
    ],
  },
  {
    id: 'swamp', name: 'Legacy Swamp', theme: 'swamp', coins: 340, hpMul: 1.15,
    story: 'Something big has been leaking in the swamp for years.',
    paths: [[[4, -1], [4, 4], [12, 4], [12, 10], [4, 10], [4, 12.5], [20, 12.5], [20, 3], [26, 3], [26, 10], [31, 10]]],
    spots: [[6, 6], [9.5, 6], [7, 2], [14.5, 6], [14.5, 9], [9, 8], [6.5, 8], [9, 11.25], [17.5, 10], [22.5, 7], [17.5, 5], [23, 1.2], [28.5, 8], [23, 11], [2.5, 5.5]],
    hero: [8, 12.5],
    waves: [
      [['mite', 12, 0.9], ['moth', 6, 0.6, 5]],
      [['beetle', 6, 1.5], ['gnat', 6, 1, 4]],
      [['healer', 3, 2], ['mite', 16, 0.6, 2]],
      [['moth', 16, 0.4], ['beetle', 6, 1.2, 4]],
      [['stag', 3, 4], ['gnat', 10, 0.7, 3]],
      [['blob', 6, 1.5], ['healer', 3, 2, 3], ['moth', 12, 0.4, 8]],
      [['beetle', 12, 0.9], ['stag', 3, 3, 6], ['gnat', 12, 0.6, 4]],
      [['mite', 24, 0.4], ['healer', 4, 2, 3], ['stag', 3, 3, 8]],
      [['gnat', 16, 0.5], ['beetle', 10, 1, 3], ['moth', 16, 0.35, 8]],
      [['leak', 1, 1], ['mite', 16, 0.8, 4], ['healer', 3, 3, 10], ['beetle', 8, 1.5, 14]],
    ],
  },
  {
    id: 'desert', name: 'Deploy Dunes', theme: 'desert', coins: 380, hpMul: 1.2,
    story: 'The long hot road to prod. Beetles love the heat.',
    paths: [[[-1, 7], [5, 7], [5, 2], [13, 2], [13, 12], [20, 12], [20, 5], [27, 5], [27, 12], [31, 12]]],
    spots: [[3, 5], [7, 4.5], [7, 9], [10.5, 4], [10.5, 8], [15.5, 4], [15.5, 9], [11, 13], [17.5, 10], [22.5, 7.5], [18, 3], [22.5, 2.8], [25, 9.5], [29, 9.5], [2.5, 9.2]],
    hero: [13, 7],
    waves: [
      [['beetle', 6, 1.6], ['mite', 10, 0.8, 3]],
      [['moth', 14, 0.45], ['gnat', 6, 1, 5]],
      [['beetle', 8, 1.2], ['healer', 3, 2.5, 4]],
      [['stag', 3, 3.5], ['moth', 12, 0.5, 4]],
      [['gnat', 16, 0.55], ['beetle', 8, 1.1, 3]],
      [['stag', 4, 2.8], ['healer', 4, 2, 2], ['mite', 20, 0.4, 6]],
      [['moth', 24, 0.3], ['gnat', 12, 0.6, 4]],
      [['beetle', 14, 0.8], ['stag', 4, 2.5, 6]],
      [['healer', 5, 1.6], ['stag', 5, 2.4, 3], ['gnat', 14, 0.5, 8]],
      [['stag', 7, 2], ['beetle', 12, 0.8, 4], ['moth', 20, 0.3, 10], ['healer', 4, 2, 12]],
    ],
  },
  {
    id: 'snow', name: 'Code Freeze', theme: 'snow', coins: 520, hpMul: 1.25,
    story: 'Nothing ships during the freeze. The bugs did not get the memo.',
    paths: [
      [[6, -1], [6, 5], [14, 5], [14, 9], [22, 9], [22, 4], [31, 4]],
      [[-1, 12], [10, 12], [10, 9], [14, 9], [22, 9], [22, 4], [31, 4]],
    ],
    spots: [[4, 3], [8, 3], [8, 7], [11, 3], [12, 7], [16, 7], [16, 11], [3, 10], [7, 10], [12, 13.5], [19, 11], [19, 6.8], [24, 7], [24.5, 1.8], [28, 6], [20, 1.8]],
    hero: [18, 9],
    waves: [
      [['mite', 10, 0.8, 0, 0], ['moth', 8, 0.6, 2, 1]],
      [['beetle', 6, 1.4, 0, 1], ['gnat', 8, 0.8, 2, 0]],
      [['healer', 3, 2, 0, 0], ['moth', 14, 0.4, 2, 1]],
      [['stag', 2, 4, 0, 0], ['mite', 14, 0.6, 2, 1]],
      [['gnat', 8, 0.8, 0, 0], ['gnat', 8, 0.8, 2, 1], ['mite', 10, 0.6, 4, 0]],
      [['beetle', 10, 1, 0, 0], ['healer', 4, 2, 2, 1], ['stag', 3, 3, 6, 1]],
      [['moth', 20, 0.3, 0, 0], ['moth', 20, 0.3, 3, 1], ['beetle', 8, 1, 6, 0]],
      [['stag', 5, 2.4, 0, 1], ['healer', 4, 2, 2, 0], ['gnat', 14, 0.5, 5, 0]],
      [['blob', 10, 1, 0, 0], ['beetle', 12, 0.8, 2, 1], ['moth', 16, 0.3, 8, 0]],
      [['stag', 6, 2, 0, 0], ['stag', 4, 2.5, 3, 1], ['healer', 5, 1.5, 4, 0], ['gnat', 18, 0.4, 8, 1]],
    ],
  },
  {
    id: 'night', name: 'Server Night', theme: 'night', coins: 480, hpMul: 1.3,
    story: 'The racks hum. The Memory Leak is back, and it brought friends.',
    paths: [[[-1, 2], [7, 2], [7, 12], [14, 12], [14, 2], [21, 2], [21, 12], [27, 12], [27, 5], [31, 5]]],
    spots: [[5, 4], [9, 4], [9, 8], [5, 9], [9.2, 13.4], [11.5, 10], [11.5, 5], [16, 5], [16, 9.5], [16.5, 13.4], [18.5, 4.5], [18.5, 9], [23, 10], [23, 5], [25, 8], [29, 7.5], [11.5, 1]],
    hero: [10.5, 12],
    waves: [
      [['mite', 14, 0.6], ['gnat', 8, 0.8, 4]],
      [['beetle', 8, 1.2], ['moth', 14, 0.4, 4]],
      [['healer', 4, 1.8], ['stag', 3, 3, 3]],
      [['gnat', 20, 0.4], ['moth', 16, 0.35, 5]],
      [['stag', 5, 2.2], ['healer', 4, 2, 2], ['beetle', 10, 0.9, 6]],
      [['blob', 12, 0.9], ['gnat', 14, 0.5, 4]],
      [['moth', 30, 0.25], ['beetle', 12, 0.8, 5]],
      [['stag', 7, 1.8], ['healer', 5, 1.6, 3], ['gnat', 16, 0.45, 8]],
      [['beetle', 18, 0.6], ['stag', 5, 2, 6], ['moth', 20, 0.3, 10]],
      [['leak', 1, 1], ['stag', 5, 2.5, 6], ['healer', 5, 2, 8], ['gnat', 18, 0.5, 12]],
    ],
  },
];

// ---------------------------------------------------------------- geometry

export interface Geo { pts: Pt[]; cum: number[]; len: number }
const geoCache = new Map<string, Geo>();
export function geo(map: number, path: number): Geo {
  const key = `${map}:${path}`;
  let g = geoCache.get(key);
  if (!g) {
    const pts = MAPS[map].paths[path];
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    g = { pts, cum, len: cum[cum.length - 1] };
    geoCache.set(key, g);
  }
  return g;
}
/** Position (and heading) at distance d along a path. */
export function posAt(g: Geo, d: number): [number, number, number] {
  const { pts, cum } = g;
  if (d <= 0) return [pts[0][0], pts[0][1], Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0])];
  for (let i = 1; i < pts.length; i++) {
    if (d <= cum[i] || i === pts.length - 1) {
      const seg = cum[i] - cum[i - 1] || 1;
      const f = Math.min(1, (d - cum[i - 1]) / seg);
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      return [ax + (bx - ax) * f, ay + (by - ay) * f, Math.atan2(by - ay, bx - ax)];
    }
  }
  const p = pts[pts.length - 1];
  return [p[0], p[1], 0];
}
/** Distance from a point to the nearest road centerline. */
export function distToPath(map: number, x: number, y: number): number {
  let best = Infinity;
  for (const p of MAPS[map].paths) {
    for (let i = 1; i < p.length; i++) {
      const [ax, ay] = p[i - 1], [bx, by] = p[i];
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy || 1;
      const f = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      best = Math.min(best, Math.hypot(x - ax - dx * f, y - ay - dy * f));
    }
  }
  return best;
}
/** The nearest point on the road, where the hero goes when you tap near it. */
export function snapToPath(map: number, x: number, y: number): Pt {
  let best = Infinity, out: Pt = [x, y];
  for (const p of MAPS[map].paths) {
    for (let i = 1; i < p.length; i++) {
      const [ax, ay] = p[i - 1], [bx, by] = p[i];
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy || 1;
      const f = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      const px = ax + dx * f, py = ay + dy * f;
      const d = Math.hypot(x - px, y - py);
      if (d < best) { best = d; out = [px, py]; }
    }
  }
  return out;
}
/** Path length inside a circle: how much road a spot covers. */
export function coverage(map: number, x: number, y: number, r: number): number {
  let n = 0;
  for (let p = 0; p < MAPS[map].paths.length; p++) {
    const g = geo(map, p);
    for (let d = 0; d < g.len; d += 0.25) { const [px, py] = posAt(g, d); if (Math.hypot(px - x, py - y) <= r) n += 0.25; }
  }
  return n;
}

// ---------------------------------------------------------------- state

export interface Bug {
  id: number; kind: BugKind; hp: number; max: number; path: number; d: number; lane: number;
  x: number; y: number; slow: number; slowT: number; ampT: number; ampV: number; stunT: number; flash: number; blocked: boolean; heading: number;
}
export interface Tower { id: number; spot: number; kind: Kind; level: number; spec: SpecId | null; cd: number; spent: number; aim: number; built: number; kick: number }
export interface Shot {
  id: number; kind: 'bolt' | 'shell' | 'frost'; x: number; y: number; sx: number; sy: number; tx: number; ty: number;
  target: number; dmg: number; speed: number; t: number; dur: number; tower: number; air: boolean;
}
export interface Hero {
  x: number; y: number; tx: number; ty: number; hp: number; level: number; xp: number;
  cd: number; ability: number; dead: number; engaged: number; face: number; swing: number;
}
export interface Spawn { at: number; kind: BugKind; path: number }
export type Ev =
  | { t: 'build'; x: number; y: number; kind: Kind }
  | { t: 'upgrade'; x: number; y: number; level: number }
  | { t: 'sell'; x: number; y: number; coins: number }
  | { t: 'shoot'; x: number; y: number; kind: Kind }
  | { t: 'snipe'; x: number; y: number; x2: number; y2: number; crit: boolean }
  | { t: 'hit'; x: number; y: number; dmg: number; color: string }
  | { t: 'boom'; x: number; y: number; r: number; stun: boolean }
  | { t: 'pulse'; x: number; y: number; r: number }
  | { t: 'kill'; x: number; y: number; kind: BugKind; coins: number }
  | { t: 'leak'; x: number; y: number; lives: number }
  | { t: 'wave'; n: number; early: number }
  | { t: 'bossdown'; x: number; y: number }
  | { t: 'split'; x: number; y: number }
  | { t: 'levelup'; x: number; y: number; level: number }
  | { t: 'ability'; x: number; y: number; r: number }
  | { t: 'herohit'; x: number; y: number }
  | { t: 'herodown'; x: number; y: number }
  | { t: 'won' } | { t: 'lost' };

export interface State {
  v: 3; map: number; t: number; coins: number; lives: number; score: number;
  wave: number; nextIn: number; queue: Spawn[];
  bugs: Bug[]; towers: Tower[]; shots: Shot[]; hero: Hero;
  over: null | 'won' | 'lost'; early: number; earlyCoins: number; kills: number; leaked: number; bossDown: number;
  seed: number; nid: number; events: Ev[];
}

export const HERO_SPEED = 3;
export const HERO_REACH = 1.3;
export const HERO_RESPAWN = 10;
export const ABILITY_CD = 28;
export const ABILITY_R = 2.3;
export const HERO_XP = [0, 50, 130, 260, 450];
export const heroMax = (lv: number) => 90 + lv * 30;
export const heroDmg = (lv: number) => 7 + lv * 4;
export const abilityDmg = (lv: number) => 40 + lv * 25;

export function newState(map: number): State {
  const m = MAPS[map];
  return {
    v: 3, map, t: 0, coins: m.coins, lives: START_LIVES, score: 0,
    wave: 0, nextIn: -1, queue: [], bugs: [], towers: [], shots: [],
    hero: { x: m.hero[0], y: m.hero[1], tx: m.hero[0], ty: m.hero[1], hp: heroMax(1), level: 1, xp: 0, cd: 0, ability: 0, dead: 0, engaged: -1, face: 1, swing: 0 },
    over: null, early: 0, earlyCoins: 0, kills: 0, leaked: 0, bossDown: 0, seed: 12345 + map * 977, nid: 1, events: [],
  };
}

export function revive(raw: unknown): State | null {
  const s = raw as State | null;
  if (!s || typeof s !== 'object' || s.v !== 3 || !Array.isArray(s.bugs) || typeof s.map !== 'number' || !MAPS[s.map]) return null;
  return { ...s, events: [] };
}

function rand(s: State): number {
  s.seed = (s.seed * 1103515245 + 12345) >>> 0;
  return (s.seed >>> 8) / 16777216;
}

// ---------------------------------------------------------------- economy

export const totalWaves = (s: State | number) => MAPS[typeof s === 'number' ? s : s.map].waves.length;
export const spotPos = (map: number, spot: number): Pt => MAPS[map].spots[spot];
export const towerAt = (s: State, spot: number) => s.towers.find((t) => t.spot === spot) ?? null;

export function stats(t: Pick<Tower, 'kind' | 'level' | 'spec'>): Stats {
  const d = TOWERS[t.kind];
  if (t.level >= 4 && t.spec) return d.specs.find((x) => x.id === t.spec)!.stats;
  return d.levels[Math.max(0, Math.min(2, t.level - 1))];
}
export const buildCost = (k: Kind) => TOWERS[k].costs[0];
/** The next plain upgrade's cost, or null at level 3 (then it's a spec) or 4. */
export function upgradeCost(t: Tower): number | null { return t.level < 3 ? TOWERS[t.kind].costs[t.level] : null; }
export const sellValue = (t: Tower) => Math.floor(t.spent * SELL_BACK);

export function build(s: State, spot: number, kind: Kind): boolean {
  if (s.over || spot < 0 || spot >= MAPS[s.map].spots.length || towerAt(s, spot)) return false;
  const c = buildCost(kind);
  if (s.coins < c) return false;
  s.coins -= c;
  s.towers.push({ id: s.nid++, spot, kind, level: 1, spec: null, cd: 0.3, spent: c, aim: -Math.PI / 2, built: 0, kick: 0 });
  const [x, y] = spotPos(s.map, spot);
  s.events.push({ t: 'build', x, y, kind });
  return true;
}
export function upgrade(s: State, spot: number): boolean {
  const t = towerAt(s, spot);
  if (s.over || !t) return false;
  const c = upgradeCost(t);
  if (c === null || s.coins < c) return false;
  s.coins -= c; t.spent += c; t.level++; t.built = 0;
  const [x, y] = spotPos(s.map, spot);
  s.events.push({ t: 'upgrade', x, y, level: t.level });
  return true;
}
export function specialize(s: State, spot: number, which: 0 | 1): boolean {
  const t = towerAt(s, spot);
  if (s.over || !t || t.level !== 3) return false;
  const sp = TOWERS[t.kind].specs[which];
  if (s.coins < sp.cost) return false;
  s.coins -= sp.cost; t.spent += sp.cost; t.level = 4; t.spec = sp.id; t.built = 0;
  const [x, y] = spotPos(s.map, spot);
  s.events.push({ t: 'upgrade', x, y, level: 4 });
  return true;
}
export function sell(s: State, spot: number): boolean {
  const t = towerAt(s, spot);
  if (s.over || !t) return false;
  const v = sellValue(t);
  s.coins += v;
  s.towers = s.towers.filter((x) => x !== t);
  const [x, y] = spotPos(s.map, spot);
  s.events.push({ t: 'sell', x, y, coins: v });
  return true;
}

// ---------------------------------------------------------------- waves

export const canCall = (s: State) => !s.over && s.wave < totalWaves(s) && (s.wave === 0 || s.queue.length === 0);
/** Coins for calling the next wave now instead of waiting. */
export const earlyBonus = (s: State) => (s.wave === 0 || s.nextIn <= 0 ? 0 : Math.ceil(s.nextIn * (1.2 + s.map * 0.15)));
/** What the next wave brings, for the skull's tooltip and the briefing. */
export function preview(map: number, wave: number): Array<{ kind: BugKind; n: number }> {
  const w = MAPS[map].waves[wave];
  if (!w) return [];
  const out: Array<{ kind: BugKind; n: number }> = [];
  for (const [kind, n] of w) { const e = out.find((o) => o.kind === kind); if (e) e.n += n; else out.push({ kind, n }); }
  return out;
}
/** Every bug kind a map sends, for the level briefing. */
export function mapBugs(map: number): BugKind[] {
  const out: BugKind[] = [];
  for (const w of MAPS[map].waves) for (const [k] of w) if (!out.includes(k)) out.push(k);
  return out;
}
export function callWave(s: State): boolean {
  if (!canCall(s)) return false;
  const bonus = earlyBonus(s);
  if (bonus > 0) { s.coins += bonus; s.earlyCoins += bonus; s.score += bonus * 10; s.early++; }
  const w = MAPS[s.map].waves[s.wave];
  for (const [kind, n, gap, delay = 0, path = 0] of w) {
    for (let i = 0; i < n; i++) s.queue.push({ at: s.t + delay + i * gap, kind, path: Math.min(path, MAPS[s.map].paths.length - 1) });
  }
  s.queue.sort((a, b) => a.at - b.at);
  s.wave++;
  s.nextIn = -1;
  s.events.push({ t: 'wave', n: s.wave, early: bonus });
  return true;
}

function spawn(s: State, kind: BugKind, path: number, d = 0, lane?: number): Bug {
  const def = BUGS[kind];
  const hp = Math.round(def.hp * MAPS[s.map].hpMul * (1 + 0.03 * s.wave));
  const g = geo(s.map, path);
  const [x, y, h] = posAt(g, d);
  const b: Bug = {
    id: s.nid++, kind, hp, max: hp, path, d, lane: lane ?? (def.boss ? 0 : (rand(s) - 0.5) * 0.5),
    x, y, slow: 0, slowT: 0, ampT: 0, ampV: 0, stunT: 0, flash: 0, blocked: false, heading: h,
  };
  s.bugs.push(b);
  return b;
}
/** For tests: drop a bug onto the road. */
export const addBug = (s: State, kind: BugKind, d = 0, path = 0) => spawn(s, kind, path, d, 0);

// ---------------------------------------------------------------- damage

const remaining = (s: State, b: Bug) => geo(s.map, b.path).len - b.d;

export function hurt(s: State, b: Bug, dmg: number, pierce = 0, color = '#fff', byHero = false): number {
  if (b.hp <= 0) return 0;
  const def = BUGS[b.kind];
  let d = dmg * (1 - def.armor * (1 - Math.min(1, pierce)));
  if (b.ampT > 0) d *= 1 + b.ampV;
  d = Math.max(1, d);
  b.hp -= d; b.flash = 0.12;
  s.events.push({ t: 'hit', x: b.x, y: b.y, dmg: Math.round(d), color });
  if (b.hp <= 0) kill(s, b, byHero);
  return d;
}
function kill(s: State, b: Bug, byHero: boolean) {
  const def = BUGS[b.kind];
  s.coins += def.bounty; s.score += def.bounty * 10; s.kills++;
  s.events.push({ t: 'kill', x: b.x, y: b.y, kind: b.kind, coins: def.bounty });
  gainXp(s, byHero ? def.bounty * 2 : Math.ceil(def.bounty * 0.4));
  if (def.splits) {
    s.events.push({ t: 'split', x: b.x, y: b.y });
    for (let i = 0; i < def.splits; i++) spawn(s, 'blob', b.path, Math.max(0, b.d - 0.4 + i * 0.3), (i - (def.splits - 1) / 2) * 0.25);
  }
  if (def.boss) { s.bossDown++; s.events.push({ t: 'bossdown', x: b.x, y: b.y }); }
}
function gainXp(s: State, xp: number) {
  const h = s.hero;
  if (h.level >= HERO_XP.length) return;
  h.xp += xp;
  while (h.level < HERO_XP.length && h.xp >= HERO_XP[h.level]) {
    h.level++;
    h.hp = heroMax(h.level);
    s.events.push({ t: 'levelup', x: h.x, y: h.y, level: h.level });
  }
}

// ---------------------------------------------------------------- targeting

export function canHit(st: Stats, b: Bug): boolean { return BUGS[b.kind].fly ? st.air : st.ground; }
/** Bugs in range, best target first: 'first' is closest to the repo, 'strong' the most hp. */
export function targets(s: State, x: number, y: number, st: Stats, mode: 'first' | 'strong'): Bug[] {
  const list = s.bugs.filter((b) => b.hp > 0 && canHit(st, b) && Math.hypot(b.x - x, b.y - y) <= st.range);
  if (mode === 'strong') list.sort((a, b) => b.hp - a.hp || remaining(s, a) - remaining(s, b));
  else list.sort((a, b) => remaining(s, a) - remaining(s, b));
  return list;
}

function fire(s: State, t: Tower, st: Stats) {
  const def = TOWERS[t.kind];
  const [x, y] = spotPos(s.map, t.spot);
  if (st.pulse) {
    const hit = targets(s, x, y, st, 'first');
    if (!hit.length) return false;
    s.events.push({ t: 'pulse', x, y, r: st.range });
    for (const b of hit) { chill(b, st); hurt(s, b, st.dmg, 0, def.color); }
    return true;
  }
  const list = targets(s, x, y, st, def.target);
  if (!list.length) return false;
  const picks = list.slice(0, st.multi ?? 1);
  t.aim = Math.atan2(picks[0].y - y, picks[0].x - x); t.kick = 0.15;
  for (const b of picks) {
    if (def.shot === 'snipe') {
      const crit = !!st.crit && rand(s) < st.crit;
      s.events.push({ t: 'snipe', x, y: y - 0.5, x2: b.x, y2: b.y, crit });
      hurt(s, b, st.dmg * (crit ? 3 : 1), st.pierce ?? 0, crit ? '#ffe45c' : def.color);
    } else if (def.shot === 'shell') {
      // lob at where the bug will be when the egg lands
      const g = geo(s.map, b.path), dur = 0.8;
      const lead = b.blocked || b.stunT > 0 ? 0 : BUGS[b.kind].speed * (1 - b.slow) * dur;
      const [px, py] = posAt(g, Math.min(g.len, b.d + lead));
      s.shots.push({ id: s.nid++, kind: 'shell', x, y: y - 0.5, sx: x, sy: y - 0.5, tx: px, ty: py + b.lane * 0.5, target: -1, dmg: st.dmg, speed: 0, t: 0, dur, tower: t.id, air: false });
    } else {
      const dmg = BUGS[b.kind].fly && st.airBonus ? st.dmg * st.airBonus : st.dmg;
      s.shots.push({ id: s.nid++, kind: def.shot === 'frost' ? 'frost' : 'bolt', x, y: y - 0.5, sx: x, sy: y - 0.5, tx: b.x, ty: b.y, target: b.id, dmg, speed: def.shot === 'frost' ? 8 : 11, t: 0, dur: 0, tower: t.id, air: true });
    }
  }
  s.events.push({ t: 'shoot', x, y, kind: t.kind });
  return true;
}
function chill(b: Bug, st: Stats) {
  const res = BUGS[b.kind].boss ? 0.5 : 1;
  const v = (st.slow ?? 0) * res;
  if (v >= b.slow || b.slowT <= 0) { b.slow = v; }
  b.slowT = Math.max(b.slowT, st.slowFor ?? 1.5);
  if (st.amp) { b.ampT = Math.max(b.ampT, st.slowFor ?? 1.5); b.ampV = st.amp; }
}

// ---------------------------------------------------------------- hero

export function moveHero(s: State, x: number, y: number) {
  if (s.over) return;
  const h = s.hero;
  h.tx = Math.max(0.3, Math.min(W - 0.3, x)); h.ty = Math.max(0.3, Math.min(H - 0.3, y));
  h.engaged = -1;
}
export function heroSpecial(s: State): boolean {
  const h = s.hero;
  if (s.over || h.dead > 0 || h.ability > 0) return false;
  h.ability = ABILITY_CD;
  s.events.push({ t: 'ability', x: h.x, y: h.y, r: ABILITY_R });
  for (const b of [...s.bugs]) {
    if (b.hp > 0 && Math.hypot(b.x - h.x, b.y - h.y) <= ABILITY_R) {
      b.stunT = Math.max(b.stunT, BUGS[b.kind].boss ? 0.6 : 1.5);
      hurt(s, b, abilityDmg(h.level), 0.5, '#ffd84a', true);
    }
  }
  return true;
}

function stepHero(s: State) {
  const h = s.hero;
  if (h.ability > 0) h.ability = Math.max(0, h.ability - DT);
  if (h.swing > 0) h.swing = Math.max(0, h.swing - DT);
  if (h.dead > 0) {
    h.dead -= DT;
    if (h.dead <= 0) { h.dead = 0; h.hp = heroMax(h.level); const m = MAPS[s.map]; h.x = h.tx = m.hero[0]; h.y = h.ty = m.hero[1]; }
    return;
  }
  const dx = h.tx - h.x, dy = h.ty - h.y, dist = Math.hypot(dx, dy);
  const release = () => { const b = s.bugs.find((x) => x.id === h.engaged); if (b) b.blocked = false; h.engaged = -1; };
  if (dist > 0.05) {
    release();
    const step = Math.min(dist, HERO_SPEED * DT);
    h.x += (dx / dist) * step; h.y += (dy / dist) * step;
    if (Math.abs(dx) > 0.01) h.face = dx > 0 ? 1 : -1;
    h.hp = Math.min(heroMax(h.level), h.hp + 3 * DT);
    return;
  }
  let foe = s.bugs.find((b) => b.id === h.engaged && b.hp > 0);
  if (foe && Math.hypot(foe.x - h.x, foe.y - h.y) > HERO_REACH + 0.4) { foe.blocked = false; foe = undefined; }
  if (!foe) {
    h.engaged = -1;
    let best: Bug | undefined, bd = HERO_REACH;
    for (const b of s.bugs) {
      if (b.hp <= 0 || BUGS[b.kind].fly) continue;
      const d = Math.hypot(b.x - h.x, b.y - h.y);
      if (d <= bd) { bd = d; best = b; }
    }
    if (best) { foe = best; h.engaged = best.id; }
  }
  if (!foe) { h.hp = Math.min(heroMax(h.level), h.hp + 6 * DT); return; }
  foe.blocked = true;
  h.face = foe.x >= h.x ? 1 : -1;
  h.cd -= DT;
  if (h.cd <= 0) {
    h.cd = 1 / 1.3; h.swing = 0.2;
    hurt(s, foe, heroDmg(h.level), 0.2, '#ffffff', true);
    s.events.push({ t: 'herohit', x: foe.x, y: foe.y });
  }
  if (foe.hp > 0 && foe.stunT <= 0) h.hp -= BUGS[foe.kind].bite * DT;
  if (h.hp <= 0) {
    h.hp = 0; h.dead = HERO_RESPAWN; foe.blocked = false; h.engaged = -1;
    s.events.push({ t: 'herodown', x: h.x, y: h.y });
  }
}

// ---------------------------------------------------------------- step

export function step(s: State): void {
  if (s.over) return;
  s.t += DT;
  // spawns
  while (s.queue.length && s.queue[0].at <= s.t) { const q = s.queue.shift()!; spawn(s, q.kind, q.path); }
  // wave timer: once a wave has fully spawned, the next one comes on its own
  if (s.wave > 0 && s.wave < totalWaves(s) && s.queue.length === 0) {
    if (s.nextIn < 0) s.nextIn = WAVE_GAP;
    s.nextIn -= DT;
    if (s.nextIn <= 0) { s.nextIn = 0; callWave(s); }
  }
  // bugs move
  for (const b of s.bugs) {
    if (b.flash > 0) b.flash -= DT;
    if (b.slowT > 0) { b.slowT -= DT; if (b.slowT <= 0) b.slow = 0; }
    if (b.ampT > 0) b.ampT -= DT;
    if (b.stunT > 0) { b.stunT -= DT; continue; }
    const def = BUGS[b.kind];
    if (def.heal) for (const o of s.bugs) if (o !== b && o.hp > 0 && o.hp < o.max && Math.hypot(o.x - b.x, o.y - b.y) < 1.6) o.hp = Math.min(o.max, o.hp + def.heal * DT);
    if (b.blocked && s.hero.engaged === b.id) continue;
    b.blocked = false;
    b.d += def.speed * (1 - b.slow) * DT;
    const g = geo(s.map, b.path);
    const [x, y, h] = posAt(g, b.d);
    b.heading = h;
    b.x = x - Math.sin(h) * b.lane; b.y = y + Math.cos(h) * b.lane;
    if (b.d >= g.len) {
      b.hp = 0;
      s.lives = Math.max(0, s.lives - def.lives); s.leaked += def.lives;
      s.events.push({ t: 'leak', x: b.x, y: b.y, lives: def.lives });
    }
  }
  s.bugs = s.bugs.filter((b) => b.hp > 0);
  stepHero(s);
  // towers
  for (const t of s.towers) {
    if (t.built < 1) t.built = Math.min(1, t.built + DT * 2.5);
    if (t.kick > 0) t.kick -= DT;
    t.cd -= DT;
    if (t.cd > 0 || t.built < 1) continue;
    const st = stats(t);
    if (fire(s, t, st)) t.cd = 1 / st.rate;
    else t.cd = 0.05;
  }
  // shots
  for (const sh of s.shots) {
    const tw = s.towers.find((t) => t.id === sh.tower);
    const st = tw ? stats(tw) : null;
    if (sh.kind === 'shell') {
      sh.t += DT;
      const f = Math.min(1, sh.t / sh.dur);
      sh.x = sh.sx + (sh.tx - sh.sx) * f; sh.y = sh.sy + (sh.ty - sh.sy) * f;
      if (f >= 1) {
        const r = st?.splash ?? 1;
        s.events.push({ t: 'boom', x: sh.tx, y: sh.ty, r, stun: !!st?.stun });
        for (const b of [...s.bugs]) {
          if (b.hp <= 0 || BUGS[b.kind].fly) continue;
          const d = Math.hypot(b.x - sh.tx, b.y - sh.ty);
          if (d <= r) {
            if (st?.stun) b.stunT = Math.max(b.stunT, BUGS[b.kind].boss ? st.stun / 3 : st.stun);
            hurt(s, b, sh.dmg * (d < r * 0.4 ? 1 : 0.7), 0, '#ff9a3c');
          }
        }
        sh.t = -1;
      }
      continue;
    }
    const b = s.bugs.find((x) => x.id === sh.target);
    if (b) { sh.tx = b.x; sh.ty = b.y; }
    const dx = sh.tx - sh.x, dy = sh.ty - sh.y, d = Math.hypot(dx, dy);
    const mv = sh.speed * DT;
    if (d <= mv + 0.1) {
      if (b && b.hp > 0) {
        if (sh.kind === 'frost' && st) chill(b, st);
        hurt(s, b, sh.dmg, st?.pierce ?? 0, sh.kind === 'frost' ? '#8ef0ff' : '#b7ff9a');
      }
      sh.t = -1;
    } else { sh.x += (dx / d) * mv; sh.y += (dy / d) * mv; }
  }
  s.shots = s.shots.filter((x) => x.t >= 0);
  // end
  if (s.lives <= 0) { s.over = 'lost'; s.events.push({ t: 'lost' }); return; }
  if (s.wave >= totalWaves(s) && s.queue.length === 0 && s.bugs.length === 0) {
    s.over = 'won';
    s.score += s.lives * 100 + stars(s) * 1000;
    s.events.push({ t: 'won' });
  }
}

/** 3 stars for 18+ lives left, 2 for 10+, 1 for holding at all. */
export function stars(s: Pick<State, 'over' | 'lives'>): number {
  if (s.over !== 'won') return 0;
  return s.lives >= 18 ? 3 : s.lives >= 10 ? 2 : 1;
}

// ---------------------------------------------------------------- ghosts

/** A map's best realistic score: every bounty, full lives, 3 stars, some early calls. */
export function maxScore(map: number): number {
  let b = 0;
  for (const w of MAPS[map].waves) for (const [k, n] of w) b += BUGS[k].bounty * n * (k === 'leak' ? 1 : 1) + (k === 'leak' ? BUGS.blob.bounty * 4 * n : 0);
  return b * 10 + START_LIVES * 100 + 3000 + MAPS[map].waves.length * 150;
}
/** Early maps get a weak crew ghost, the last one Nell. */
export const MAP_GHOSTS = ['moss', 'bly', 'fig', 'rue', 'bram', 'nell'];
export const GHOST_STRENGTH: Record<string, number> = { moss: 0.2, tuck: 0.25, bly: 0.35, otto: 0.4, fig: 0.45, wren: 0.55, rue: 0.6, juno: 0.75, bram: 0.8, ollie: 0.88, nell: 0.95 };
/** What a ghost of this strength posts on a map. */
export function ghostTarget(map: number, strength: number): number {
  return Math.round((maxScore(map) * (0.42 + 0.52 * strength)) / 10) * 10;
}
/** The host's (unused in custom mode) run score for a strength: map 1's. */
export const ghostScore = (strength: number) => ghostTarget(0, strength);
