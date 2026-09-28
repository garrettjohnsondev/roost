/** Crew Kart: the pure simulation. A track is a closed centre line resampled
 *  to evenly spaced points; a kart's progress is counted in those samples, so
 *  laps, positions and the AI all read the same number. Everything here is
 *  plain JSON so a race can ride along in the save mid-lap. */

export const LAPS = 3;
export const V = 250; // top speed, world px / s
export const DT = 1 / 60;
export const LAP_LEN = 5200; // every track is scaled to this, so times compare
export const N = 520; // samples per lap (10px apart)
export const HW = 72; // half the road width
export const KART_R = 9;
export const COUNTDOWN = 3;
/** Share of full grip at a standstill; generous so turns feel planted. */
export const GRIP_MIN = 0.6;
export const STEER_DEAD = 0.06;

export type ItemKind = 'feather' | 'shell' | 'oil' | 'shield';
export const ITEMS: ItemKind[] = ['feather', 'shell', 'oil', 'shield'];

export interface Pt { x: number; y: number }
export interface TrackDef { id: string; name: string; pts: Array<[number, number]>; crew: [string, string, string] }

/** Control points, hand drawn; shapes are scaled to LAP_LEN. */
export const TRACKS: TrackDef[] = [
  {
    id: 'garden', name: 'Seed Garden', crew: ['moss', 'fig', 'ollie'],
    pts: [[0, 0], [600, -40], [950, 80], [1040, 360], [820, 520], [580, 440], [420, 600], [520, 860], [220, 940], [-60, 760], [-120, 360]],
  },
  {
    id: 'server', name: 'Server Room', crew: ['tuck', 'wren', 'nell'],
    pts: [[0, 0], [880, 0], [960, 120], [880, 300], [520, 320], [460, 440], [540, 560], [900, 580], [960, 740], [860, 880], [0, 880], [-80, 440]],
  },
  {
    id: 'beach', name: 'Pebble Beach', crew: ['bly', 'juno', 'ollie'],
    pts: Array.from({ length: 14 }, (_, i) => {
      const t = (i / 14) * Math.PI * 2;
      return [760 * Math.cos(t) + 90 * Math.cos(2 * t), 420 * Math.sin(t) + 110 * Math.sin(3 * t)] as [number, number];
    }),
  },
  {
    id: 'city', name: 'Night City', crew: ['otto', 'bram', 'nell'],
    pts: [[0, 0], [1000, 0], [1160, 150], [1000, 320], [720, 320], [680, 470], [800, 560], [1120, 580], [1160, 820], [960, 900], [0, 900], [-120, 700], [60, 460], [-120, 220]],
  },
];

export interface Track {
  id: string;
  name: string;
  s: Pt[]; // centre line, N points, s[0] is the start line
  t: Pt[]; // unit tangents
  line: Pt[]; // the racing line (cuts the corners)
  w: number; // world bounds
  h: number;
}

function catmull(pts: Pt[], per: number): Pt[] {
  const out: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let k = 0; k < per; k++) {
      const u = k / per, u2 = u * u, u3 = u2 * u;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  return out;
}

const cache = new Map<string, Track>();
export function buildTrack(id: string): Track {
  const hit = cache.get(id);
  if (hit) return hit;
  const def = TRACKS.find((d) => d.id === id) ?? TRACKS[0];
  let dense = catmull(def.pts.map(([x, y]) => ({ x, y })), 60);
  const lenOf = (a: Pt[]) => a.reduce((s, p, i) => s + Math.hypot(a[(i + 1) % a.length].x - p.x, a[(i + 1) % a.length].y - p.y), 0);
  const k = LAP_LEN / lenOf(dense);
  dense = dense.map((p) => ({ x: p.x * k, y: p.y * k }));
  const minX = Math.min(...dense.map((p) => p.x)), minY = Math.min(...dense.map((p) => p.y));
  const M = 200;
  dense = dense.map((p) => ({ x: p.x - minX + M, y: p.y - minY + M }));
  // Resample evenly.
  const step = LAP_LEN / N;
  const s: Pt[] = [];
  let acc = 0, want = 0;
  for (let i = 0; i < dense.length && s.length < N; i++) {
    const a = dense[i], b = dense[(i + 1) % dense.length];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    while (want <= acc + d && s.length < N) {
      const u = d ? (want - acc) / d : 0;
      s.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
      want += step;
    }
    acc += d;
  }
  while (s.length < N) s.push(s[s.length - 1]);
  const t = s.map((_, i) => {
    const a = s[(i - 1 + N) % N], b = s[(i + 1) % N];
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
  });
  // Racing line: shift toward the inside of each bend, then smooth.
  const ang = t.map((v) => Math.atan2(v.y, v.x));
  let off = s.map((_, i) => {
    const d = wrapAng(ang[(i + 8) % N] - ang[(i - 8 + N) % N]);
    return Math.max(-0.6, Math.min(0.6, d * 0.9)) * HW;
  });
  for (let pass = 0; pass < 3; pass++) {
    off = off.map((_, i) => {
      let sum = 0;
      for (let j = -14; j <= 14; j++) sum += off[(i + j + N) % N];
      return sum / 29;
    });
  }
  const line = s.map((p, i) => ({ x: p.x - t[i].y * off[i], y: p.y + t[i].x * off[i] }));
  const w = Math.max(...s.map((p) => p.x)) + M, h = Math.max(...s.map((p) => p.y)) + M;
  const tr: Track = { id: def.id, name: def.name, s, t, line, w, h };
  cache.set(id, tr);
  return tr;
}

export const wrapAng = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const wrapIdx = (d: number) => (d > N / 2 ? d - N : d < -N / 2 ? d + N : d);

/** Nearest centre-line sample, searching near a hint (cheap, and it can't
 *  jump across to a parallel straight). */
export function nearest(tr: Track, x: number, y: number, hint: number, span = 30): number {
  let best = hint, bd = Infinity;
  for (let j = -span; j <= span; j++) {
    const i = (((hint + j) % N) + N) % N;
    const d = (tr.s[i].x - x) ** 2 + (tr.s[i].y - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
/** Signed distance from the centre line (positive = right of travel). */
export function lateral(tr: Track, x: number, y: number, i: number): number {
  const p = tr.s[i], t = tr.t[i];
  return (x - p.x) * -t.y + (y - p.y) * t.x;
}

export interface Kart {
  id: number;
  name: string;
  ai: boolean;
  skill: number;
  x: number; y: number;
  ang: number; // facing
  mv: number; // travel direction (lags while drifting)
  spd: number;
  idx: number;
  prog: number; // samples since the start line (negative on the grid)
  lapsDone: number;
  lapStart: number;
  item: ItemKind | null;
  itemT: number; // AI: how long it has held the item
  boost: number;
  shield: number;
  spin: number;
  drift: number; // -1 / 0 / 1
  charge: number;
  lastSteer: number;
  finish: number | null;
  walls: number;
  hits: number;
  bumpCd: number;
  wob: number;
}
export interface Box { i: number; lat: number; down: number }
export interface Shell { x: number; y: number; ang: number; owner: number; target: number; life: number; idx: number }
export interface Oil { x: number; y: number; owner: number; age: number }
export interface Race {
  track: string;
  t: number;
  karts: Kart[];
  boxes: Box[];
  shells: Shell[];
  oils: Oil[];
  seed: number;
  laps: number[]; // player lap times
  events: string[];
  done: boolean;
}
export interface Input { steer: number; drift: boolean; use: boolean }

export function rnd(r: Race): number {
  r.seed = (r.seed + 0x6d2b79f5) >>> 0;
  let t = r.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** AI top speed as a share of V: Moss (0.2) crawls, Nell (0.95) flies. */
export const aiPace = (skill: number) => 0.7 + 0.26 * skill;

export function rivalsFor(trackId: string, driver: string): Array<{ name: string; skill: number }> {
  const SK: Record<string, number> = { moss: 0.2, tuck: 0.25, bly: 0.35, otto: 0.4, fig: 0.45, wren: 0.55, rue: 0.6, juno: 0.75, bram: 0.8, ollie: 0.88, nell: 0.95, pip: 0.5 };
  const def = TRACKS.find((d) => d.id === trackId) ?? TRACKS[0];
  const spare = ['rue', 'juno', 'bly', 'otto'];
  return def.crew.map((n) => {
    const name = n === driver ? spare.find((s) => s !== driver && !def.crew.includes(s))! : n;
    return { name, skill: SK[name] ?? 0.5 };
  });
}

export function newRace(trackId: string, driver: string, seed = 1): Race {
  const tr = buildTrack(trackId);
  const rivals = rivalsFor(trackId, driver);
  // Grid: the fastest rival on pole, you start at the back.
  const order = [...rivals].sort((a, b) => b.skill - a.skill);
  const entrants = [...order.map((r) => ({ ...r, ai: true })), { name: driver, skill: 1, ai: false }];
  const karts: Kart[] = entrants.map((e, slot) => {
    const i = N - 3 - slot * 5;
    const lat = (slot % 2 ? 1 : -1) * HW * 0.4;
    const p = tr.s[i], t = tr.t[i];
    const ang = Math.atan2(t.y, t.x);
    return {
      id: e.ai ? slot + 1 : 0, name: e.name, ai: e.ai, skill: e.skill,
      x: p.x - t.y * lat, y: p.y + t.x * lat, ang, mv: ang, spd: 0,
      idx: i, prog: i - N, lapsDone: 0, lapStart: 0,
      item: null, itemT: 0, boost: 0, shield: 0, spin: 0, drift: 0, charge: 0, lastSteer: 0,
      finish: null, walls: 0, hits: 0, bumpCd: 0, wob: slot * 1.7,
    };
  });
  karts.sort((a, b) => a.id - b.id); // player is karts[0]
  const boxes: Box[] = [];
  for (const f of [0.22, 0.55, 0.82]) for (const lat of [-0.5, 0, 0.5]) boxes.push({ i: Math.floor(N * f), lat: lat * HW, down: 0 });
  return { track: trackId, t: -COUNTDOWN, karts, boxes, shells: [], oils: [], seed: seed >>> 0, laps: [], events: [], done: false };
}

export function standings(r: Race): Kart[] {
  return [...r.karts].sort((a, b) => {
    if (a.finish !== null || b.finish !== null) return (a.finish ?? Infinity) - (b.finish ?? Infinity);
    return b.prog - a.prog;
  });
}
export const place = (r: Race, id = 0) => standings(r).findIndex((k) => k.id === id) + 1;

function rollItem(r: Race, pos: number): ItemKind {
  // Leaders get defence, the back of the pack gets speed.
  const W: Record<number, number[]> = { 1: [1, 3, 4, 3], 2: [2, 4, 3, 2], 3: [3, 4, 2, 2], 4: [5, 4, 1, 2] };
  const w = W[pos] ?? W[2];
  let x = rnd(r) * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < 4; i++) { x -= w[i]; if (x < 0) return ITEMS[i]; }
  return 'feather';
}

function aiInput(r: Race, tr: Track, k: Kart): Input {
  const look = Math.floor(6 + (k.spd / V) * 8);
  const i = (k.idx + look) % N;
  const wob = Math.sin(r.t * 0.8 + k.wob) * HW * 0.4 * (1 - k.skill);
  const p = tr.line[i], t = tr.t[i];
  const tx = p.x - t.y * wob, ty = p.y + t.x * wob;
  const d = wrapAng(Math.atan2(ty - k.y, tx - k.x) - k.ang);
  let use = false;
  if (k.item) {
    k.itemT += DT;
    const wait = 0.6 + (1 - k.skill) * 2;
    if (k.itemT > wait) {
      if (k.item === 'shield' || k.item === 'feather') use = true;
      else if (k.item === 'shell') use = r.karts.some((o) => o.id !== k.id && o.prog > k.prog && o.prog - k.prog < 80) || k.itemT > 6;
      else use = r.karts.some((o) => o.id !== k.id && o.prog < k.prog && k.prog - o.prog < 50) || k.itemT > 6;
    }
  }
  return { steer: Math.max(-1, Math.min(1, d * 3)), drift: false, use };
}

function useItem(r: Race, tr: Track, k: Kart) {
  const it = k.item;
  if (!it) return;
  k.item = null; k.itemT = 0;
  r.events.push(`use:${k.id}:${it}`);
  if (it === 'feather') { k.boost = Math.max(k.boost, 1.3); r.events.push(`boost:${k.id}:feather`); }
  else if (it === 'shield') k.shield = 6;
  else if (it === 'oil') r.oils.push({ x: k.x - Math.cos(k.ang) * 22, y: k.y - Math.sin(k.ang) * 22, owner: k.id, age: 0 });
  else {
    const ahead = r.karts.filter((o) => o.id !== k.id && o.finish === null && o.prog > k.prog).sort((a, b) => a.prog - b.prog)[0];
    r.shells.push({ x: k.x + Math.cos(k.ang) * 16, y: k.y + Math.sin(k.ang) * 16, ang: k.ang, owner: k.id, target: ahead ? ahead.id : -1, life: 3.5, idx: k.idx });
  }
  void tr;
}

function spinOut(r: Race, k: Kart, why: string) {
  if (k.shield > 0) { k.shield = 0; r.events.push(`block:${k.id}`); return false; }
  k.spin = 1; k.spd *= 0.3; k.drift = 0; k.charge = 0; k.boost = 0;
  r.events.push(`hit:${k.id}:${why}`);
  return true;
}

/** Keep a point on the road; returns true if it touched the wall. */
export function clampToRoad(tr: Track, k: { x: number; y: number; idx: number }): boolean {
  const lat = lateral(tr, k.x, k.y, k.idx);
  const lim = HW - KART_R;
  if (Math.abs(lat) <= lim) return false;
  const p = tr.s[k.idx], t = tr.t[k.idx];
  const along = (k.x - p.x) * t.x + (k.y - p.y) * t.y;
  const L = Math.sign(lat) * lim;
  k.x = p.x + t.x * along - t.y * L;
  k.y = p.y + t.y * along + t.x * L;
  return true;
}

function stepKart(r: Race, tr: Track, k: Kart, c: Input) {
  k.bumpCd = Math.max(0, k.bumpCd - DT);
  k.boost = Math.max(0, k.boost - DT);
  k.shield = Math.max(0, k.shield - DT);
  if (k.spin > 0) {
    k.spin -= DT;
    k.ang += 11 * DT;
    k.spd *= 1 - 2 * DT;
  } else {
    if (c.use && k.item) useItem(r, tr, k);
    let top = V * (k.ai ? aiPace(k.skill) : 1);
    if (k.finish !== null) top = V * 0.6;
    if (k.boost > 0) top *= 1.45;
    if (k.ai && k.finish === null) {
      // Ease off into sharp bends, less the better the driver.
      const a = Math.atan2(tr.t[(k.idx + 14) % N].y, tr.t[(k.idx + 14) % N].x);
      const bend = Math.abs(wrapAng(a - k.ang));
      top *= 1 - Math.min(0.25, bend * 0.3 * (1.2 - k.skill));
    }
    if (Math.abs(c.steer) > 0.15) k.lastSteer = Math.sign(c.steer);
    // Drift: hold both sides; charge; let go for a boost.
    if (c.drift && !k.drift && k.spd > V * 0.45) { k.drift = k.lastSteer || 1; k.charge = 0; r.events.push(`drift:${k.id}`); }
    if (!c.drift && k.drift) {
      if (k.charge >= 1.5) { k.boost = Math.max(k.boost, 1.1); r.events.push(`boost:${k.id}:big`); }
      else if (k.charge >= 0.6) { k.boost = Math.max(k.boost, 0.55); r.events.push(`boost:${k.id}:small`); }
      k.drift = 0; k.charge = 0;
    }
    if (k.drift) { top *= 0.96; k.charge += DT; }
    k.spd += (top - k.spd) * (k.spd < top ? 1.3 : 3) * DT;
    const grip = Math.min(1, GRIP_MIN + (1 - GRIP_MIN) * (k.spd / V));
    const turn = k.drift ? k.drift * (2.3 + 0.9 * c.steer * k.drift) : 2.7 * c.steer;
    k.ang += turn * grip * DT;
  }
  k.ang = wrapAng(k.ang);
  k.mv = wrapAng(k.mv + wrapAng(k.ang - k.mv) * Math.min(1, (k.drift ? 3 : 11) * DT));
  k.x += Math.cos(k.mv) * k.spd * DT;
  k.y += Math.sin(k.mv) * k.spd * DT;
  const ni = nearest(tr, k.x, k.y, k.idx);
  k.prog += wrapIdx(ni - k.idx);
  k.idx = ni;
  if (clampToRoad(tr, k)) {
    const t = tr.t[k.idx];
    const along = Math.atan2(t.y, t.x);
    const into = Math.abs(Math.sin(wrapAng(k.mv - along)));
    k.spd *= 1 - Math.min(0.45, 0.1 + into * 0.7) * (k.bumpCd > 0 ? 0.15 : 1);
    // Glance off: turn toward the road.
    const back = wrapAng(along - k.ang);
    if (Math.abs(back) < Math.PI / 2) k.ang += back * 0.25;
    k.mv = wrapAng(k.mv + wrapAng(along - k.mv) * 0.5);
    if (k.bumpCd <= 0) { k.walls++; r.events.push(`bump:${k.id}`); k.bumpCd = 0.35; }
  }
  // Laps: the first crossing starts lap 1, each later one completes a lap.
  const crossed = k.prog >= 0 ? Math.floor(k.prog / N) + 1 : 0;
  if (crossed > k.lapsDone && k.finish === null) {
    if (k.lapsDone >= 1) {
      if (k.id === 0) r.laps.push(+(r.t - k.lapStart).toFixed(2));
      r.events.push(`lap:${k.id}:${k.lapsDone}`);
    }
    k.lapsDone = crossed;
    k.lapStart = r.t;
  }
  if (k.finish === null && k.prog >= LAPS * N) {
    k.finish = r.t;
    r.events.push(`finish:${k.id}`);
  }
}

/** One fixed step. Mutates and returns the race; read `events` after. */
export function step(r: Race, input: Input): Race {
  const tr = buildTrack(r.track);
  r.t += DT;
  if (r.t < 0 || r.done) return r;
  for (const k of r.karts) {
    const c = k.ai || k.finish !== null ? aiInput(r, tr, k) : input;
    if (!k.ai && k.finish !== null) c.use = false;
    stepKart(r, tr, k, c);
  }
  // Karts bump each other.
  for (let a = 0; a < r.karts.length; a++) for (let b = a + 1; b < r.karts.length; b++) {
    const A = r.karts[a], B = r.karts[b];
    const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy);
    if (d > 0 && d < KART_R * 2) {
      const push = (KART_R * 2 - d) / 2, nx = dx / d, ny = dy / d;
      A.x -= nx * push; A.y -= ny * push; B.x += nx * push; B.y += ny * push;
      const slow = A.prog < B.prog ? A : B;
      slow.spd *= 0.97;
      if ((A.id === 0 || B.id === 0) && r.karts[0].bumpCd <= 0) { r.events.push('bump:0'); r.karts[0].bumpCd = 0.35; }
    }
  }
  // Item boxes.
  for (const bx of r.boxes) {
    if (bx.down > 0) { bx.down -= DT; continue; }
    const p = tr.s[bx.i], t = tr.t[bx.i];
    const x = p.x - t.y * bx.lat, y = p.y + t.x * bx.lat;
    for (const k of r.karts) {
      if (Math.hypot(k.x - x, k.y - y) < KART_R + 10) {
        bx.down = 3;
        r.events.push(`box:${k.id}`);
        if (!k.item && k.finish === null) { k.item = rollItem(r, place(r, k.id)); k.itemT = 0; r.events.push(`item:${k.id}:${k.item}`); }
        break;
      }
    }
  }
  // Seed shells.
  r.shells = r.shells.filter((s) => {
    s.life -= DT;
    const tgt = r.karts.find((k) => k.id === s.target);
    if (tgt) s.ang = wrapAng(s.ang + Math.max(-4 * DT, Math.min(4 * DT, wrapAng(Math.atan2(tgt.y - s.y, tgt.x - s.x) - s.ang))));
    else {
      const t = tr.t[(s.idx + 5) % N];
      s.ang = wrapAng(s.ang + Math.max(-3 * DT, Math.min(3 * DT, wrapAng(Math.atan2(t.y, t.x) - s.ang))));
    }
    s.x += Math.cos(s.ang) * V * 1.7 * DT;
    s.y += Math.sin(s.ang) * V * 1.7 * DT;
    s.idx = nearest(tr, s.x, s.y, s.idx);
    if (Math.abs(lateral(tr, s.x, s.y, s.idx)) > HW) { r.events.push('pop'); return false; }
    for (const k of r.karts) {
      if (k.id === s.owner && s.life > 3.2) continue;
      if (Math.hypot(k.x - s.x, k.y - s.y) < KART_R + 7) {
        if (spinOut(r, k, 'shell') && k.id !== s.owner) {
          const o = r.karts.find((q) => q.id === s.owner);
          if (o) o.hits++;
        }
        return false;
      }
    }
    return s.life > 0;
  });
  // Oil slicks.
  r.oils = r.oils.filter((o) => {
    o.age += DT;
    for (const k of r.karts) {
      if (k.id === o.owner && o.age < 1) continue;
      if (k.spin <= 0 && Math.hypot(k.x - o.x, k.y - o.y) < KART_R + 12) { spinOut(r, k, 'oil'); return false; }
    }
    return o.age < 30;
  });
  if (r.karts[0].finish !== null && r.karts.every((k) => k.finish !== null || r.t > (r.karts[0].finish ?? 0) + 4)) r.done = true;
  return r;
}

/** A ghost at a lap-time pace; `prog` along the racing line at time t. */
export function ghostProg(t: number, target: number): number {
  if (t <= 0) return -2;
  return Math.min(LAPS * N, (t / target) * LAPS * N);
}
export function linePoint(tr: Track, prog: number): { x: number; y: number; ang: number } {
  const p = ((prog % N) + N) % N, i = Math.floor(p), f = p - i;
  const a = tr.line[i], b = tr.line[(i + 1) % N];
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, ang: Math.atan2(b.y - a.y, b.x - a.x) };
}

/** The finishing time (s) a ghost of this strength posts: three laps at a
 *  pace from 74% of top speed (Moss) to just over it (Nell), which you only
 *  beat with drift boosts, feathers and clean lines. */
export function ghostTime(strength: number): number {
  const pace = 0.66 + 0.36 * Math.max(0, Math.min(1, strength));
  return Math.round(((LAPS * LAP_LEN) / (V * pace)) * 10) / 10;
}

/** Drag steering: the thumb's horizontal offset from where it touched down,
 *  as a share of `span` px, with a small dead zone and a soft centre so tiny
 *  wobbles don't twitch the kart. */
export function steerFromDrag(dx: number, span: number): number {
  const v = Math.max(-1, Math.min(1, dx / Math.max(1, span)));
  const a = Math.abs(v);
  if (a < STEER_DEAD) return 0;
  return Math.sign(v) * Math.pow((a - STEER_DEAD) / (1 - STEER_DEAD), 1.25);
}
/** Tilt steering: degrees of roll, full lock at `lock` degrees. */
export function steerFromTilt(deg: number, lock = 24): number {
  return steerFromDrag(deg, lock);
}

/** Cup points by finishing place. */
export const CUP_POINTS = [10, 6, 3, 1];
