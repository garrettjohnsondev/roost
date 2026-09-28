/** Bug Siege: the pure simulation. Bugs walk a polyline path (in tile units)
 *  toward the repo; crew towers on build spots shoot them. Everything here is
 *  plain data so a run can be saved mid-map and tested without a canvas. */

export const COLS = 16;
export const ROWS = 9;
export const DT = 1 / 60;
export const START_LIVES = 20;
export const WAVE_GAP = 14;
export const SELL_BACK = 0.7;

export type TowerKind = 'moss' | 'wren' | 'ollie' | 'nell' | 'bram' | 'tuck' | 'bly' | 'juno';
export type BugKind = 'moth' | 'beetle' | 'glitch' | 'stag' | 'blob' | 'drip' | 'leak';

export interface TowerLevel {
  cost: number; range: number; dmg: number; rate: number;
  splash?: number; slow?: number; chain?: number; burn?: number; pierce?: boolean;
}
export interface TowerDef { kind: TowerKind; name: string; role: string; color: string; target: 'first' | 'strong'; shot: 'bolt' | 'snipe' | 'chain'; speed: number; levels: TowerLevel[] }

export const TOWERS: Record<TowerKind, TowerDef> = {
  moss: { kind: 'moss', name: 'Moss', role: 'Cheap, fast pecks', color: '#7bd66b', target: 'first', shot: 'bolt', speed: 12, levels: [
    { cost: 50, range: 2.0, dmg: 4, rate: 3 }, { cost: 40, range: 2.2, dmg: 6, rate: 3.6 }, { cost: 70, range: 2.4, dmg: 9, rate: 4.4 }] },
  wren: { kind: 'wren', name: 'Wren', role: 'Balanced all-rounder', color: '#e0a15a', target: 'first', shot: 'bolt', speed: 10, levels: [
    { cost: 80, range: 2.5, dmg: 11, rate: 1.4 }, { cost: 70, range: 2.7, dmg: 18, rate: 1.6 }, { cost: 120, range: 3.0, dmg: 28, rate: 1.8 }] },
  ollie: { kind: 'ollie', name: 'Ollie', role: 'Heavy, long range, cracks armor', color: '#6aa6ff', target: 'first', shot: 'bolt', speed: 7, levels: [
    { cost: 130, range: 3.6, dmg: 34, rate: 0.55, pierce: true }, { cost: 110, range: 4.0, dmg: 56, rate: 0.6, pierce: true }, { cost: 180, range: 4.5, dmg: 92, rate: 0.7, pierce: true }] },
  nell: { kind: 'nell', name: 'Nell', role: 'Sniper, picks the toughest', color: '#c68cff', target: 'strong', shot: 'snipe', speed: 0, levels: [
    { cost: 160, range: 5.0, dmg: 75, rate: 0.33, pierce: true }, { cost: 140, range: 5.8, dmg: 125, rate: 0.38, pierce: true }, { cost: 220, range: 6.5, dmg: 215, rate: 0.45, pierce: true }] },
  bram: { kind: 'bram', name: 'Bram', role: 'Splash, clears swarms', color: '#ff9a3c', target: 'first', shot: 'bolt', speed: 6, levels: [
    { cost: 120, range: 2.2, dmg: 12, rate: 0.8, splash: 0.9 }, { cost: 100, range: 2.4, dmg: 20, rate: 0.9, splash: 1.0 }, { cost: 160, range: 2.6, dmg: 32, rate: 1.0, splash: 1.2 }] },
  tuck: { kind: 'tuck', name: 'Tuck', role: 'Frost, slows the line', color: '#8ef0ff', target: 'first', shot: 'bolt', speed: 9, levels: [
    { cost: 70, range: 2.2, dmg: 2, rate: 1.2, slow: 0.4 }, { cost: 60, range: 2.5, dmg: 3, rate: 1.4, slow: 0.5 }, { cost: 90, range: 2.8, dmg: 5, rate: 1.6, slow: 0.6 }] },
  bly: { kind: 'bly', name: 'Bly', role: 'Chain lightning', color: '#ffe45c', target: 'first', shot: 'chain', speed: 0, levels: [
    { cost: 140, range: 2.6, dmg: 14, rate: 0.9, chain: 3 }, { cost: 120, range: 2.8, dmg: 22, rate: 1.0, chain: 4 }, { cost: 180, range: 3.1, dmg: 34, rate: 1.2, chain: 6 }] },
  juno: { kind: 'juno', name: 'Juno', role: 'Sets bugs on fire', color: '#ff5a4a', target: 'first', shot: 'bolt', speed: 9, levels: [
    { cost: 100, range: 2.2, dmg: 3, rate: 1.0, burn: 8 }, { cost: 90, range: 2.4, dmg: 4, rate: 1.2, burn: 14 }, { cost: 140, range: 2.6, dmg: 6, rate: 1.4, burn: 24 }] },
};
export const TOWER_ORDER: TowerKind[] = ['moss', 'wren', 'tuck', 'juno', 'bram', 'ollie', 'bly', 'nell'];

export interface BugDef { name: string; hp: number; speed: number; armor: number; bounty: number; lives: number; size: number; boss?: boolean; splits?: BugKind; slowResist?: number }
export const BUGS: Record<BugKind, BugDef> = {
  moth: { name: 'Moth', hp: 16, speed: 1.8, armor: 0, bounty: 4, lives: 1, size: 0.3 },
  beetle: { name: 'Beetle', hp: 32, speed: 1.0, armor: 2, bounty: 5, lives: 1, size: 0.32 },
  glitch: { name: 'Glitch', hp: 8, speed: 2.3, armor: 0, bounty: 2, lives: 1, size: 0.2 },
  stag: { name: 'Stag beetle', hp: 110, speed: 0.7, armor: 4, bounty: 15, lives: 2, size: 0.42 },
  blob: { name: 'Leaklet', hp: 160, speed: 0.8, armor: 1, bounty: 12, lives: 2, size: 0.4, splits: 'drip' },
  drip: { name: 'Drip', hp: 40, speed: 1.3, armor: 0, bounty: 4, lives: 1, size: 0.24 },
  leak: { name: 'Memory Leak', hp: 750, speed: 0.45, armor: 3, bounty: 100, lives: 6, size: 0.62, boss: true, splits: 'blob', slowResist: 0.5 },
};

export type Pt = [number, number];
export interface MapDef { id: string; name: string; blurb: string; paths: Pt[][]; spots: Pt[]; waves: number; coins: number; mul: number; tint: string }

/** Waypoints are tile coordinates; -1 / 16 are just off the board. */
export const MAPS: MapDef[] = [
  { id: 'main', name: 'Main branch', blurb: 'One road in. Learn the crew.', waves: 12, coins: 200, mul: 1, tint: '#3d6b35',
    paths: [[[-1, 2], [4, 2], [4, 6], [9, 6], [9, 2], [13, 2], [13, 6], [15, 6]]],
    spots: [[2, 3], [3, 1], [5, 4], [3, 5], [6, 5], [7, 7], [8, 4], [10, 4], [11, 1], [12, 3], [11, 7], [14, 4], [14, 7], [7, 3], [6, 1]] },
  { id: 'merge', name: 'Merge conflict', blurb: 'Two branches, one repo.', waves: 12, coins: 240, mul: 1.2, tint: '#4a5d2f',
    paths: [
      [[3, -1], [3, 4], [8, 4], [8, 2], [12, 2], [12, 5], [15, 5]],
      [[-1, 7], [6, 7], [6, 4], [8, 4], [8, 2], [12, 2], [12, 5], [15, 5]]],
    spots: [[2, 2], [4, 2], [4, 6], [2, 5], [5, 5], [7, 6], [7, 3], [9, 3], [10, 1], [10, 3], [11, 4], [13, 3], [13, 6], [11, 6], [14, 4], [5, 1]] },
  { id: 'spaghetti', name: 'Spaghetti code', blurb: 'It winds forever. So do they.', waves: 15, coins: 280, mul: 1.65, tint: '#3a4d4a',
    paths: [[[-1, 1], [13, 1], [13, 3], [2, 3], [2, 5], [13, 5], [13, 7], [6, 7]]],
    spots: [[3, 2], [6, 2], [9, 2], [12, 2], [4, 4], [7, 4], [10, 4], [14, 4], [4, 6], [8, 6], [11, 6], [14, 6], [1, 4], [1, 2], [14, 2]] },
];

/** kind, count, gap seconds, start delay */
type Group = [BugKind, number, number, number?];
export const WAVES: Group[][] = [
  [['moth', 6, 1]],
  [['beetle', 8, 1.1]],
  [['moth', 10, 0.7], ['beetle', 4, 1.2, 4]],
  [['glitch', 18, 0.25]],
  [['beetle', 8, 0.9], ['stag', 2, 3, 5]],
  [['moth', 8, 0.6], ['blob', 2, 4, 3]],
  [['moth', 12, 0.5], ['glitch', 20, 0.2, 4]],
  [['beetle', 10, 0.7], ['stag', 4, 2.2, 3]],
  [['glitch', 30, 0.18], ['moth', 8, 0.5, 2]],
  [['stag', 6, 1.8], ['moth', 14, 0.4, 2]],
  [['blob', 3, 3], ['beetle', 10, 0.6, 1], ['glitch', 20, 0.2, 6]],
  [['leak', 1, 1, 4], ['moth', 12, 0.5], ['beetle', 8, 0.8, 6]],
  [['stag', 8, 1.3], ['glitch', 30, 0.15, 3]],
  [['blob', 5, 2.2], ['moth', 20, 0.35, 2]],
  [['leak', 2, 9], ['stag', 6, 1.6, 4], ['glitch', 30, 0.15, 10]],
];

export const hpMul = (m: number, w: number) => MAPS[m].mul * (1 + 0.13 * w);
export const killPoints = (m: number, kind: BugKind) => Math.round(BUGS[kind].bounty * 5 * MAPS[m].mul);
export const winBonus = (m: number, lives: number) => Math.round((1000 + lives * 100) * MAPS[m].mul);

// ---- geometry ----
export interface PathGeo { pts: Pt[]; seg: number[]; len: number }
const geoCache = new Map<string, PathGeo>();
export function geo(m: number, p: number): PathGeo {
  const key = `${m}:${p}`;
  let g = geoCache.get(key);
  if (!g) {
    const pts = MAPS[m].paths[p].map(([c, r]) => [c + 0.5, r + 0.5] as Pt);
    const seg = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]));
    g = { pts, seg, len: seg.reduce((a, b) => a + b, 0) };
    geoCache.set(key, g);
  }
  return g;
}
export function posAt(g: PathGeo, d: number): Pt {
  if (d <= 0) return [...g.pts[0]] as Pt;
  for (let i = 0; i < g.seg.length; i++) {
    if (d <= g.seg[i]) {
      const t = d / g.seg[i], a = g.pts[i], b = g.pts[i + 1];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    d -= g.seg[i];
  }
  return [...g.pts[g.pts.length - 1]] as Pt;
}
/** Every board tile a path covers, as "c,r". */
export function pathTiles(m: number): Set<string> {
  const out = new Set<string>();
  for (const path of MAPS[m].paths) {
    for (let i = 1; i < path.length; i++) {
      let [c, r] = path[i - 1];
      const [c2, r2] = path[i];
      const dc = Math.sign(c2 - c), dr = Math.sign(r2 - r);
      for (;;) {
        if (c >= 0 && c < COLS && r >= 0 && r < ROWS) out.add(`${c},${r}`);
        if (c === c2 && r === r2) break;
        c += dc; r += dr;
      }
    }
  }
  return out;
}
export const repoAt = (m: number): Pt => { const p = MAPS[m].paths[0]; return p[p.length - 1]; };

// ---- state ----
export interface Bug { id: number; kind: BugKind; path: number; d: number; hp: number; max: number; x: number; y: number; slowT: number; slowF: number; burnT: number; burnDps: number; flash: number; dead?: boolean }
export interface Tower { spot: number; kind: TowerKind; level: number; cd: number; spent: number; aim: number; kick: number; kills: number }
export interface Shot { spot: number; x: number; y: number; tx: number; ty: number; target: number; kind: TowerKind; level: number }
export interface Spawn { at: number; kind: BugKind; path: number }
export interface State {
  map: number; t: number; wave: number; lives: number; coins: number; score: number;
  nextIn: number; spawns: Spawn[]; bugs: Bug[]; towers: Tower[]; shots: Shot[];
  seq: number; kills: number; leaks: number; bossKills: number; early: number;
  over: '' | 'won' | 'lost';
}
export type Ev =
  | { k: 'shoot'; x: number; y: number; kind: TowerKind }
  | { k: 'hit'; x: number; y: number; kind: TowerKind }
  | { k: 'kill'; x: number; y: number; bug: BugKind; pts: number; coins: number }
  | { k: 'leak'; x: number; y: number; lives: number }
  | { k: 'boss'; x: number; y: number }
  | { k: 'chain'; pts: number[] }
  | { k: 'snipe'; x: number; y: number; tx: number; ty: number }
  | { k: 'splash'; x: number; y: number; r: number }
  | { k: 'wave'; n: number; early: number }
  | { k: 'won' } | { k: 'lost' };

export function newState(m: number): State {
  return { map: m, t: 0, wave: 0, lives: START_LIVES, coins: MAPS[m].coins, score: 0, nextIn: 0, spawns: [], bugs: [], towers: [], shots: [], seq: 1, kills: 0, leaks: 0, bossKills: 0, early: 0, over: '' };
}
export const totalWaves = (s: State) => MAPS[s.map].waves;
export const spotPos = (m: number, i: number): Pt => { const [c, r] = MAPS[m].spots[i]; return [c + 0.5, r + 0.5]; };
export const towerAt = (s: State, spot: number) => s.towers.find((t) => t.spot === spot);

export function stars(s: State): number {
  if (s.over !== 'won') return 0;
  return s.lives >= START_LIVES - 2 ? 3 : s.lives >= 10 ? 2 : 1;
}

// ---- building ----
export function canBuild(s: State, spot: number, kind: TowerKind): boolean {
  return !s.over && spot >= 0 && spot < MAPS[s.map].spots.length && !towerAt(s, spot) && s.coins >= TOWERS[kind].levels[0].cost;
}
export function build(s: State, spot: number, kind: TowerKind): boolean {
  if (!canBuild(s, spot, kind)) return false;
  const cost = TOWERS[kind].levels[0].cost;
  s.coins -= cost;
  s.towers.push({ spot, kind, level: 0, cd: 0, spent: cost, aim: 0, kick: 0, kills: 0 });
  return true;
}
export const upgradeCost = (t: Tower) => (t.level < 2 ? TOWERS[t.kind].levels[t.level + 1].cost : 0);
export function upgrade(s: State, spot: number): boolean {
  const t = towerAt(s, spot);
  if (!t || t.level >= 2 || s.over) return false;
  const c = upgradeCost(t);
  if (s.coins < c) return false;
  s.coins -= c; t.spent += c; t.level++;
  return true;
}
export const sellValue = (t: Tower) => Math.floor(t.spent * SELL_BACK);
export function sell(s: State, spot: number): number {
  const t = towerAt(s, spot);
  if (!t || s.over) return 0;
  const v = sellValue(t);
  s.coins += v;
  s.towers = s.towers.filter((x) => x !== t);
  return v;
}

// ---- waves ----
export const canCall = (s: State) => !s.over && s.wave < totalWaves(s) && s.spawns.length === 0;
/** Seconds early you'd be calling (0 for the first wave). */
export const earlyBy = (s: State) => (s.wave === 0 ? 0 : Math.max(0, s.nextIn));
export const earlyCoins = (secs: number) => Math.round(secs * 1.5);
export const earlyPoints = (secs: number) => Math.round(secs * 10);

export function callWave(s: State, ev: Ev[] = []): boolean {
  if (!canCall(s)) return false;
  const early = earlyBy(s);
  if (early > 0.5) {
    s.coins += earlyCoins(early);
    s.score += earlyPoints(early);
    s.early++;
  }
  const groups = WAVES[s.wave];
  const paths = MAPS[s.map].paths.length;
  let n = 0;
  for (const [kind, count, gap, delay = 0] of groups) {
    for (let i = 0; i < count; i++) s.spawns.push({ at: s.t + delay + i * gap, kind, path: n++ % paths });
  }
  s.spawns.sort((a, b) => a.at - b.at);
  if (s.wave > 0) s.coins += 30 + 4 * s.wave;
  s.wave++;
  s.nextIn = WAVE_GAP;
  ev.push({ k: 'wave', n: s.wave, early: Math.round(early) });
  return true;
}

function addBug(s: State, kind: BugKind, path: number, d: number, wave: number): Bug {
  const hp = Math.round(BUGS[kind].hp * hpMul(s.map, wave));
  const [x, y] = posAt(geo(s.map, path), d);
  const b: Bug = { id: s.seq++, kind, path, d, hp, max: hp, x, y, slowT: 0, slowF: 0, burnT: 0, burnDps: 0, flash: 0 };
  s.bugs.push(b);
  return b;
}

// ---- combat ----
export function damage(kind: BugKind, dmg: number, pierce = false): number {
  return pierce ? dmg : Math.max(1, dmg - BUGS[kind].armor);
}

function hurt(s: State, b: Bug, dmg: number, ev: Ev[], by?: Tower): void {
  if (b.dead) return;
  b.hp -= dmg;
  b.flash = 0.08;
  if (b.hp > 0) return;
  b.dead = true;
  const def = BUGS[b.kind];
  const pts = killPoints(s.map, b.kind);
  s.coins += def.bounty; s.score += pts; s.kills++;
  if (by) by.kills++;
  ev.push({ k: 'kill', x: b.x, y: b.y, bug: b.kind, pts, coins: def.bounty });
  if (def.boss) { s.bossKills++; ev.push({ k: 'boss', x: b.x, y: b.y }); }
  if (def.splits) {
    const w = Math.max(0, s.wave - 1);
    for (let i = 0; i < 2; i++) addBug(s, def.splits, b.path, Math.max(0, b.d - 0.35 + i * 0.4), w);
  }
}

function pickTarget(s: State, t: Tower, range: number): Bug | null {
  const [tx, ty] = spotPos(s.map, t.spot);
  let best: Bug | null = null, score = -Infinity;
  const strong = TOWERS[t.kind].target === 'strong';
  for (const b of s.bugs) {
    if (b.dead || b.d <= 0) continue;
    if (Math.hypot(b.x - tx, b.y - ty) > range) continue;
    const v = strong ? b.hp * 1000 + b.d : b.d;
    if (v > score) { score = v; best = b; }
  }
  return best;
}

function impact(s: State, sh: Shot, ev: Ev[]): void {
  const L = TOWERS[sh.kind].levels[sh.level];
  const owner = towerAt(s, sh.spot);
  if (L.splash) {
    ev.push({ k: 'splash', x: sh.tx, y: sh.ty, r: L.splash });
    for (const b of s.bugs) if (!b.dead && Math.hypot(b.x - sh.tx, b.y - sh.ty) <= L.splash) hurt(s, b, damage(b.kind, L.dmg, L.pierce), ev, owner);
    return;
  }
  const b = s.bugs.find((x) => x.id === sh.target && !x.dead);
  if (!b) return;
  ev.push({ k: 'hit', x: b.x, y: b.y, kind: sh.kind });
  if (L.slow) {
    const f = L.slow * (1 - (BUGS[b.kind].slowResist ?? 0));
    if (f >= b.slowF || b.slowT <= 0) b.slowF = f;
    b.slowT = 1.6;
  }
  if (L.burn) { b.burnDps = Math.max(b.burnT > 0 ? b.burnDps : 0, L.burn); b.burnT = 2.5; }
  hurt(s, b, damage(b.kind, L.dmg, L.pierce), ev, owner);
}

function fire(s: State, t: Tower, b: Bug, ev: Ev[]): void {
  const def = TOWERS[t.kind], L = def.levels[t.level];
  const [x, y] = spotPos(s.map, t.spot);
  t.aim = Math.atan2(b.y - y, b.x - x);
  t.kick = 0.15;
  if (def.shot === 'snipe') {
    ev.push({ k: 'snipe', x, y, tx: b.x, ty: b.y });
    hurt(s, b, damage(b.kind, L.dmg, L.pierce), ev, t);
    return;
  }
  if (def.shot === 'chain') {
    const hit: Bug[] = [b];
    let cur = b;
    while (hit.length < (L.chain ?? 1)) {
      let nb: Bug | null = null, nd = 1.7;
      for (const o of s.bugs) {
        if (o.dead || hit.includes(o)) continue;
        const d = Math.hypot(o.x - cur.x, o.y - cur.y);
        if (d < nd) { nd = d; nb = o; }
      }
      if (!nb) break;
      hit.push(nb); cur = nb;
    }
    const pts: number[] = [x, y];
    hit.forEach((h, i) => { pts.push(h.x, h.y); hurt(s, h, damage(h.kind, Math.round(L.dmg * Math.pow(0.85, i)), L.pierce), ev, t); });
    ev.push({ k: 'chain', pts });
    return;
  }
  s.shots.push({ spot: t.spot, x, y, tx: b.x, ty: b.y, target: b.id, kind: t.kind, level: t.level });
  ev.push({ k: 'shoot', x, y, kind: t.kind });
}

/** One fixed step. Mutates `s`, returns what happened (for sound, fx, haptics). */
export function step(s: State, dt = DT): Ev[] {
  const ev: Ev[] = [];
  if (s.over) return ev;
  s.t += dt;
  const total = totalWaves(s);

  // spawns
  while (s.spawns.length && s.spawns[0].at <= s.t) {
    const sp = s.spawns.shift()!;
    addBug(s, sp.kind, sp.path, 0, s.wave - 1);
  }
  // countdown to the next wave once this one is fully out
  if (s.wave > 0 && s.wave < total && s.spawns.length === 0) {
    s.nextIn -= dt;
    if (s.nextIn <= 0) { s.nextIn = 0; callWave(s, ev); }
  }

  // bugs move, burn
  for (const b of s.bugs) {
    if (b.dead) continue;
    b.flash = Math.max(0, b.flash - dt);
    if (b.burnT > 0) { b.burnT -= dt; hurt(s, b, b.burnDps * dt, ev); if (b.dead) continue; }
    let v = BUGS[b.kind].speed;
    if (b.slowT > 0) { b.slowT -= dt; v *= 1 - b.slowF; }
    b.d += v * dt;
    const g = geo(s.map, b.path);
    [b.x, b.y] = posAt(g, b.d);
    if (b.d >= g.len) {
      b.dead = true;
      const lost = BUGS[b.kind].lives;
      s.lives = Math.max(0, s.lives - lost);
      s.leaks += lost;
      ev.push({ k: 'leak', x: b.x, y: b.y, lives: lost });
    }
  }

  // towers
  for (const t of s.towers) {
    t.kick = Math.max(0, t.kick - dt);
    t.cd -= dt;
    if (t.cd > 0) continue;
    const L = TOWERS[t.kind].levels[t.level];
    const b = pickTarget(s, t, L.range);
    if (!b) { t.cd = 0; continue; }
    fire(s, t, b, ev);
    t.cd += 1 / L.rate;
  }

  // shots home in
  const keep: Shot[] = [];
  for (const sh of s.shots) {
    const b = s.bugs.find((x) => x.id === sh.target && !x.dead);
    if (b) { sh.tx = b.x; sh.ty = b.y; }
    const sp = TOWERS[sh.kind].speed * dt;
    const dx = sh.tx - sh.x, dy = sh.ty - sh.y, d = Math.hypot(dx, dy);
    if (d <= sp) { sh.x = sh.tx; sh.y = sh.ty; impact(s, sh, ev); }
    else { sh.x += (dx / d) * sp; sh.y += (dy / d) * sp; keep.push(sh); }
  }
  s.shots = keep;
  s.bugs = s.bugs.filter((b) => !b.dead);

  if (s.lives <= 0) { s.over = 'lost'; ev.push({ k: 'lost' }); }
  else if (s.wave >= total && s.spawns.length === 0 && s.bugs.length === 0) {
    s.over = 'won';
    s.score += winBonus(s.map, s.lives);
    ev.push({ k: 'won' });
  }
  return ev;
}

/** The most a run on a map can score without calling early. */
export function maxPoints(m: number): number {
  let pts = 0;
  const count = (k: BugKind): number => killPoints(m, k) + (BUGS[k].splits ? 2 * count(BUGS[k].splits!) : 0);
  for (let w = 0; w < MAPS[m].waves; w++) for (const [k, n] of WAVES[w]) pts += n * count(k);
  return pts + winBonus(m, START_LIVES);
}

/** Ghost of strength 0.2 gets through about two-fifths of Main branch; 0.95
 *  needs a spotless Main branch with early calls, or a good run on a harder map. */
export const ghostScore = (strength: number) => Math.round(maxPoints(0) * (0.12 + 1.05 * Math.max(0, Math.min(1, strength))));

/** Snap a saved run back into shape (tolerates older / partial saves). */
export function revive(raw: unknown): State | null {
  const r = raw as State | null;
  if (!r || typeof r !== 'object' || typeof r.map !== 'number' || !MAPS[r.map] || !Array.isArray(r.towers) || r.over) return null;
  const s = { ...newState(r.map), ...r };
  s.bugs = (r.bugs ?? []).filter((b) => b && BUGS[b.kind]);
  s.towers = r.towers.filter((t) => t && TOWERS[t.kind] && t.level >= 0 && t.level <= 2);
  s.shots = (r.shots ?? []).filter((x) => x && TOWERS[x.kind]);
  s.spawns = (r.spawns ?? []).filter((x) => x && BUGS[x.kind]);
  return s;
}
