/** A small 2D rigid-body engine for Roost Birds: circles and oriented boxes,
 *  gravity, sequential-impulse contacts with friction, restitution and warm
 *  starting, per-body sleeping, and impact damage that breaks blocks.
 *  World units are "pixels" with y pointing down. Robust over clever. */

export type Mat = 'wood' | 'stone' | 'glass' | 'bug' | 'bird' | 'ground' | 'egg';

export interface Body {
  id: number;
  kind: 'circle' | 'box';
  r: number; // circle radius
  hw: number; // box half extents
  hh: number;
  x: number; y: number; a: number;
  vx: number; vy: number; w: number;
  m: number; invM: number; invI: number;
  friction: number; rest: number;
  mat: Mat;
  hp: number; // Infinity = unbreakable
  dmg: number;
  dead: boolean;
  asleep: boolean;
  idle: number;
  /** Free slot for the game (bird name, bug variant...). */
  tag?: string;
}

export interface MatSpec { density: number; friction: number; rest: number; hp: number }
export const MATS: Record<Mat, MatSpec> = {
  wood: { density: 0.6, friction: 0.6, rest: 0.1, hp: 400 },
  stone: { density: 2.2, friction: 0.8, rest: 0.05, hp: 2500 },
  glass: { density: 0.5, friction: 0.5, rest: 0.15, hp: 120 },
  bug: { density: 0.5, friction: 0.6, rest: 0.2, hp: 60 },
  bird: { density: 1.2, friction: 0.5, rest: 0.3, hp: Infinity },
  egg: { density: 2, friction: 0.5, rest: 0.1, hp: Infinity },
  ground: { density: 0, friction: 0.9, rest: 0.1, hp: Infinity },
};

interface Contact {
  px: number; py: number; depth: number;
  ra: [number, number]; rb: [number, number];
  kn: number; kt: number; bias: number;
  pn: number; pt: number;
}
interface Manifold { a: Body; b: Body; nx: number; ny: number; pts: Contact[]; key: string }

export interface Impact { a: Body; b: Body; speed: number; x: number; y: number }

export const SLOP = 0.4;
const BETA = 0.25;
const SLEEP_V = 6;
const SLEEP_W = 0.15;
const SLEEP_T = 0.4;
const DMG_SPEED = 60; // approach speeds below this do no harm

let nextId = 1;

export function makeCircle(x: number, y: number, r: number, mat: Mat, density = MATS[mat].density): Body {
  const m = density * Math.PI * r * r / 100;
  const I = 0.5 * m * r * r;
  return base('circle', x, y, r, r, r, mat, m, I);
}

export function makeBox(x: number, y: number, w: number, h: number, mat: Mat, a = 0, isStatic = false): Body {
  const hw = w / 2, hh = h / 2;
  const m = isStatic ? 0 : MATS[mat].density * w * h / 100;
  const I = m * (w * w + h * h) / 12;
  const b = base('box', x, y, Math.hypot(hw, hh), hw, hh, mat, m, I);
  b.a = a;
  return b;
}

function base(kind: Body['kind'], x: number, y: number, r: number, hw: number, hh: number, mat: Mat, m: number, I: number): Body {
  const s = MATS[mat];
  return {
    id: nextId++, kind, r, hw, hh, x, y, a: 0, vx: 0, vy: 0, w: 0,
    m, invM: m > 0 ? 1 / m : 0, invI: I > 0 ? 1 / I : 0,
    friction: s.friction, rest: s.rest, mat, hp: s.hp, dmg: 0, dead: false, asleep: false, idle: 0,
  };
}

// ---------- collision ----------

function verts(b: Body): [number, number][] {
  const c = Math.cos(b.a), s = Math.sin(b.a);
  const L: [number, number][] = [[-b.hw, -b.hh], [b.hw, -b.hh], [b.hw, b.hh], [-b.hw, b.hh]];
  return L.map(([x, y]) => [b.x + x * c - y * s, b.y + x * s + y * c]);
}
function normals(b: Body): [number, number][] {
  const c = Math.cos(b.a), s = Math.sin(b.a);
  // edge i runs v[i] -> v[i+1]: top (-y), right (+x), bottom (+y), left (-x)
  return [[s, -c], [c, s], [-s, c], [-c, -s]];
}

function circleCircle(a: Body, b: Body): Manifold | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d2 = dx * dx + dy * dy, rr = a.r + b.r;
  if (d2 >= rr * rr) return null;
  const d = Math.sqrt(d2) || 1e-6;
  const nx = d2 > 0 ? dx / d : 0, ny = d2 > 0 ? dy / d : 1;
  return mf(a, b, nx, ny, [[a.x + nx * a.r, a.y + ny * a.r, rr - d]]);
}

/** Circle b against box a; normal from a to b. */
function boxCircle(a: Body, b: Body): Manifold | null {
  const c = Math.cos(a.a), s = Math.sin(a.a);
  const dx = b.x - a.x, dy = b.y - a.y;
  const lx = dx * c + dy * s, ly = -dx * s + dy * c; // circle center in box space
  const cx = Math.max(-a.hw, Math.min(a.hw, lx));
  const cy = Math.max(-a.hh, Math.min(a.hh, ly));
  let nlx: number, nly: number, depth: number, plx: number, ply: number;
  if (cx === lx && cy === ly) {
    // center inside the box: push out along the shallowest face
    const ox = a.hw - Math.abs(lx), oy = a.hh - Math.abs(ly);
    if (ox < oy) { nlx = Math.sign(lx) || 1; nly = 0; depth = ox + b.r; plx = nlx * a.hw; ply = ly; }
    else { nlx = 0; nly = Math.sign(ly) || 1; depth = oy + b.r; plx = lx; ply = nly * a.hh; }
  } else {
    const ex = lx - cx, ey = ly - cy;
    const d2 = ex * ex + ey * ey;
    if (d2 >= b.r * b.r) return null;
    const d = Math.sqrt(d2);
    nlx = ex / d; nly = ey / d; depth = b.r - d; plx = cx; ply = cy;
  }
  const nx = nlx * c - nly * s, ny = nlx * s + nly * c;
  const px = a.x + plx * c - ply * s, py = a.y + plx * s + ply * c;
  return mf(a, b, nx, ny, [[px, py, depth]]);
}

function maxSep(A: Body, vA: [number, number][], nA: [number, number][], vB: [number, number][]): [number, number] {
  let best = -Infinity, idx = 0;
  for (let i = 0; i < 4; i++) {
    const [nx, ny] = nA[i];
    let min = Infinity;
    for (const [x, y] of vB) min = Math.min(min, (x - vA[i][0]) * nx + (y - vA[i][1]) * ny);
    if (min > best) { best = min; idx = i; }
  }
  void A;
  return [best, idx];
}

function boxBox(a: Body, b: Body): Manifold | null {
  const va = verts(a), vb = verts(b), na = normals(a), nb = normals(b);
  const [sa, ia] = maxSep(a, va, na, vb);
  if (sa > 0) return null;
  const [sb, ib] = maxSep(b, vb, nb, va);
  if (sb > 0) return null;
  let flip = false, rv = va, rn = na, iv = vb, inn = nb, ri = ia;
  if (sb > sa + 0.1) { flip = true; rv = vb; rn = nb; iv = va; inn = na; ri = ib; }
  const [nx, ny] = rn[ri];
  // incident edge: most anti-parallel normal
  let ii = 0, mind = Infinity;
  for (let i = 0; i < 4; i++) {
    const d = inn[i][0] * nx + inn[i][1] * ny;
    if (d < mind) { mind = d; ii = i; }
  }
  let p1 = iv[ii], p2 = iv[(ii + 1) % 4];
  const r1 = rv[ri], r2 = rv[(ri + 1) % 4];
  const tl = Math.hypot(r2[0] - r1[0], r2[1] - r1[1]);
  const tx = (r2[0] - r1[0]) / tl, ty = (r2[1] - r1[1]) / tl;
  const lo = r1[0] * tx + r1[1] * ty, hi = r2[0] * tx + r2[1] * ty;
  const clip = (q1: [number, number], q2: [number, number], dir: number, lim: number): [[number, number], [number, number]] | null => {
    // keep dir*(p.t) <= dir*lim
    const d1 = dir * (q1[0] * tx + q1[1] * ty) - dir * lim;
    const d2 = dir * (q2[0] * tx + q2[1] * ty) - dir * lim;
    if (d1 > 0 && d2 > 0) return null;
    if (d1 <= 0 && d2 <= 0) return [q1, q2];
    const t = d1 / (d1 - d2);
    const m: [number, number] = [q1[0] + (q2[0] - q1[0]) * t, q1[1] + (q2[1] - q1[1]) * t];
    return d1 > 0 ? [m, q2] : [q1, m];
  };
  const c1 = clip(p1, p2, -1, lo);
  if (!c1) return null;
  const c2 = clip(c1[0], c1[1], 1, hi);
  if (!c2) return null;
  [p1, p2] = c2;
  const pts: [number, number, number][] = [];
  for (const p of [p1, p2]) {
    const sep = (p[0] - r1[0]) * nx + (p[1] - r1[1]) * ny;
    if (sep <= 0) pts.push([p[0], p[1], -sep]);
  }
  if (!pts.length) return null;
  return flip ? mf(a, b, -nx, -ny, pts) : mf(a, b, nx, ny, pts);
}

function mf(a: Body, b: Body, nx: number, ny: number, pts: [number, number, number][]): Manifold {
  return {
    a, b, nx, ny, key: `${a.id}:${b.id}`,
    pts: pts.map(([px, py, depth]) => ({ px, py, depth, ra: [0, 0], rb: [0, 0], kn: 0, kt: 0, bias: 0, pn: 0, pt: 0 })),
  };
}

export function collide(a: Body, b: Body): Manifold | null {
  if (a.kind === 'circle' && b.kind === 'circle') return circleCircle(a, b);
  if (a.kind === 'box' && b.kind === 'circle') return boxCircle(a, b);
  if (a.kind === 'circle' && b.kind === 'box') {
    const m = boxCircle(b, a);
    if (!m) return null;
    return { ...m, a, b, nx: -m.nx, ny: -m.ny, key: `${a.id}:${b.id}` };
  }
  return boxBox(a, b);
}

// ---------- world ----------

export class World {
  bodies: Body[] = [];
  gravity = 600;
  iterations = 12;
  useBlock = true;
  posIters = 4;
  private cache = new Map<string, Contact[]>();
  impacts: Impact[] = [];
  time = 0;
  private steps = 0;

  add(b: Body): Body { this.bodies.push(b); return b; }
  wakeAll() { for (const b of this.bodies) { b.asleep = false; b.idle = 0; } }
  wake(b: Body) { b.asleep = false; b.idle = 0; }

  step(dt: number) {
    this.time += dt;
    this.impacts = [];
    const bodies = this.bodies.filter((b) => !b.dead);
    const damp = Math.pow(0.98, dt);
    for (const b of bodies) {
      if (b.invM === 0 || b.asleep) continue;
      b.vy += this.gravity * dt;
      b.vx *= damp; b.vy *= damp; b.w *= Math.pow(0.9, dt);
    }

    // broadphase: sweep on x
    const sorted = bodies.slice().sort((p, q) => (p.x - p.r) - (q.x - q.r));
    const manifolds: Manifold[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const A = sorted[i];
      for (let j = i + 1; j < sorted.length; j++) {
        const B = sorted[j];
        if (B.x - B.r > A.x + A.r) break;
        if (Math.abs(A.y - B.y) > A.r + B.r) continue;
        const aStill = A.invM === 0 || A.asleep, bStill = B.invM === 0 || B.asleep;
        if (aStill && bStill) continue;
        const [a, b] = A.id < B.id ? [A, B] : [B, A];
        const m = collide(a, b);
        if (!m) continue;
        // a moving body touching a sleeper wakes it only if it's really moving
        for (const [s, o] of [[a, b], [b, a]] as const) {
          if (s.asleep && o.invM > 0 && !o.asleep) {
            const sp = Math.hypot(o.vx, o.vy) + Math.abs(o.w) * o.r;
            if (sp > 12 || m.pts.some((p) => p.depth > 2)) this.wake(s);
          }
        }
        manifolds.push(m);
      }
    }

    // pre-step
    const invDt = 1 / dt;
    const effM = (b: Body) => (b.asleep ? 0 : b.invM);
    const effI = (b: Body) => (b.asleep ? 0 : b.invI);
    const newCache = new Map<string, Contact[]>();
    for (const m of manifolds) {
      const { a, b, nx, ny } = m;
      const old = this.cache.get(m.key);
      const e = Math.max(a.rest, b.rest);
      const iA = effM(a), iB = effM(b), IA = effI(a), IB = effI(b);
      let worst = 0, wx = 0, wy = 0;
      for (const c of m.pts) {
        c.ra = [c.px - a.x, c.py - a.y];
        c.rb = [c.px - b.x, c.py - b.y];
        const rna = c.ra[0] * ny - c.ra[1] * nx, rnb = c.rb[0] * ny - c.rb[1] * nx;
        c.kn = 1 / (iA + iB + IA * rna * rna + IB * rnb * rnb || 1);
        const tx = -ny, ty = nx;
        const rta = c.ra[0] * ty - c.ra[1] * tx, rtb = c.rb[0] * ty - c.rb[1] * tx;
        c.kt = 1 / (iA + iB + IA * rta * rta + IB * rtb * rtb || 1);
        const rvx = b.vx - b.w * c.rb[1] - a.vx + a.w * c.ra[1];
        const rvy = b.vy + b.w * c.rb[0] - a.vy - a.w * c.ra[0];
        const vn = rvx * nx + rvy * ny;
        c.bias = 0;
        if (vn < -60) c.bias = Math.max(c.bias, -e * vn);
        if (-vn > worst) { worst = -vn; wx = c.px; wy = c.py; }
        if (old) {
          const o = old.find((q) => Math.abs(q.px - c.px) + Math.abs(q.py - c.py) < 3);
          if (o) { c.pn = o.pn; c.pt = o.pt; }
        }
      }
      newCache.set(m.key, m.pts);
      if (worst > DMG_SPEED) this.impacts.push({ a, b, speed: worst, x: wx, y: wy });
    }
    this.cache = newCache;
    // warm start only after every approach speed was measured, or the
    // carried-over impulses would read as fake impacts
    for (const m of manifolds) {
      for (const c of m.pts) {
        if (c.pn || c.pt) this.apply(m.a, m.b, c, m.nx * c.pn - m.ny * c.pt, m.ny * c.pn + m.nx * c.pt);
      }
    }
    if (++this.steps % 6 === 0) this.checkSupport(bodies);

    for (let it = 0; it < this.iterations; it++) {
      for (const m of manifolds) this.solveManifold(m);
    }

    for (const b of bodies) {
      if (b.invM === 0 || b.asleep) continue;
      b.x += b.vx * dt; b.y += b.vy * dt; b.a += b.w * dt;
    }
    this.solvePositions(manifolds);
    for (const b of bodies) {
      if (b.invM === 0 || b.asleep) continue;
      const slow = Math.hypot(b.vx, b.vy) < SLEEP_V && Math.abs(b.w) < SLEEP_W;
      b.idle = slow ? b.idle + dt : 0;
      if (b.idle > SLEEP_T && b.mat !== 'bird') { b.asleep = true; b.vx = b.vy = b.w = 0; }
    }
  }

  private relVn(m: Manifold, c: Contact) {
    const { a, b } = m;
    const rvx = b.vx - b.w * c.rb[1] - a.vx + a.w * c.ra[1];
    const rvy = b.vy + b.w * c.rb[0] - a.vy - a.w * c.ra[0];
    return [rvx * m.nx + rvy * m.ny, rvx * -m.ny + rvy * m.nx];
  }

  private solveManifold(m: Manifold) {
    const { a, b, nx, ny } = m;
    const mu = Math.sqrt(a.friction * b.friction);
    const tx = -ny, ty = nx;
    // friction first (Box2D order), bounded by the current normal impulse
    for (const c of m.pts) {
      const vt = this.relVn(m, c)[1];
      const maxF = mu * c.pn;
      const pt0 = c.pt;
      c.pt = Math.max(-maxF, Math.min(maxF, pt0 - c.kt * vt));
      const d = c.pt - pt0;
      this.apply(a, b, c, tx * d, ty * d);
    }
    if (this.useBlock && m.pts.length === 2 && this.solveBlock(m)) return;
    for (const c of m.pts) {
      const vn = this.relVn(m, c)[0];
      const pn0 = c.pn;
      c.pn = Math.max(pn0 + c.kn * (-vn + c.bias), 0);
      const d = c.pn - pn0;
      this.apply(a, b, c, nx * d, ny * d);
    }
  }

  /** Both points of a face contact solved together (Box2D's block solver):
   *  sequential solving of two points rocks thin posts until they walk. */
  private solveBlock(m: Manifold): boolean {
    const { a, b, nx, ny } = m;
    const [c1, c2] = m.pts;
    const iA = a.asleep ? 0 : a.invM, iB = b.asleep ? 0 : b.invM;
    const IA = a.asleep ? 0 : a.invI, IB = b.asleep ? 0 : b.invI;
    const r1a = c1.ra[0] * ny - c1.ra[1] * nx, r1b = c1.rb[0] * ny - c1.rb[1] * nx;
    const r2a = c2.ra[0] * ny - c2.ra[1] * nx, r2b = c2.rb[0] * ny - c2.rb[1] * nx;
    const k11 = iA + iB + IA * r1a * r1a + IB * r1b * r1b;
    const k22 = iA + iB + IA * r2a * r2a + IB * r2b * r2b;
    const k12 = iA + iB + IA * r1a * r2a + IB * r1b * r2b;
    const det = k11 * k22 - k12 * k12;
    if (!(k11 * k11 < 1000 * det)) return false;
    const ax = c1.pn, ay = c2.pn;
    const b1 = this.relVn(m, c1)[0] - c1.bias - (k11 * ax + k12 * ay);
    const b2 = this.relVn(m, c2)[0] - c2.bias - (k12 * ax + k22 * ay);
    let x1: number, x2: number;
    const tryX = (): boolean => {
      // case 1: both active
      x1 = -(k22 * b1 - k12 * b2) / det; x2 = -(k11 * b2 - k12 * b1) / det;
      if (x1 >= 0 && x2 >= 0) return true;
      // case 2: only point 1
      x1 = -b1 / k11; x2 = 0;
      if (x1 >= 0 && k12 * x1 + b2 >= 0) return true;
      // case 3: only point 2
      x1 = 0; x2 = -b2 / k22;
      if (x2 >= 0 && k12 * x2 + b1 >= 0) return true;
      // case 4: separating
      x1 = 0; x2 = 0;
      return b1 >= 0 && b2 >= 0;
    };
    if (!tryX()) return true; // no valid case: leave impulses as they are
    const d1 = x1! - ax, d2 = x2! - ay;
    this.apply(a, b, c1, nx * d1, ny * d1);
    this.apply(a, b, c2, nx * d2, ny * d2);
    c1.pn = x1!; c2.pn = x2!;
    return true;
  }

  /** Pushes overlapping bodies apart directly (re-colliding each pass), so the
   *  velocity solver never has to inject energy to fix penetration. */
  private solvePositions(manifolds: Manifold[]) {
    for (let it = 0; it < this.posIters; it++) {
      for (const old of manifolds) {
        const { a, b } = old;
        const m = collide(a, b);
        if (!m) continue;
        const iA = a.asleep ? 0 : a.invM, iB = b.asleep ? 0 : b.invM;
        const IA = a.asleep ? 0 : a.invI, IB = b.asleep ? 0 : b.invI;
        const n = m.pts.length;
        for (const c of m.pts) {
          const C = Math.min(BETA * Math.max(0, c.depth - SLOP), 4) / n;
          if (C <= 0) continue;
          const rax = c.px - a.x, ray = c.py - a.y, rbx = c.px - b.x, rby = c.py - b.y;
          const rna = rax * m.ny - ray * m.nx, rnb = rbx * m.ny - rby * m.nx;
          const k = iA + iB + IA * rna * rna + IB * rnb * rnb;
          if (k <= 0) continue;
          const P = C / k * n;
          const px = m.nx * P, py = m.ny * P;
          a.x -= px * iA; a.y -= py * iA; a.a -= IA * (rax * py - ray * px);
          b.x += px * iB; b.y += py * iB; b.a += IB * (rbx * py - rby * px);
        }
      }
    }
  }

  /** A sleeper touching nothing (its support broke or slid away) wakes up and falls. */
  private checkSupport(bodies: Body[]) {
    for (const s of bodies) {
      if (!s.asleep) continue;
      let held = false;
      for (const o of bodies) {
        if (o === s || Math.abs(o.x - s.x) > o.r + s.r + 1 || Math.abs(o.y - s.y) > o.r + s.r + 1) continue;
        // test slightly lower so a resting contact always registers
        s.y += 1;
        const m = collide(s, o);
        s.y -= 1;
        if (m && (o.y > s.y || o.invM === 0)) { held = true; break; }
      }
      if (!held) this.wake(s);
    }
  }

  private apply(a: Body, b: Body, c: Contact, px: number, py: number) {
    if (!a.asleep && a.invM > 0) {
      a.vx -= px * a.invM; a.vy -= py * a.invM;
      a.w -= (c.ra[0] * py - c.ra[1] * px) * a.invI;
    }
    if (!b.asleep && b.invM > 0) {
      b.vx += px * b.invM; b.vy += py * b.invM;
      b.w += (c.rb[0] * py - c.rb[1] * px) * b.invI;
    }
  }

  /** Radial blast: shoves and damages everything within `radius`. */
  explode(x: number, y: number, radius: number, impulse: number, damage: number) {
    for (const b of this.bodies) {
      if (b.dead || b.invM === 0) continue;
      const dx = b.x - x, dy = b.y - y;
      const d = Math.hypot(dx, dy);
      if (d > radius + b.r) continue;
      const f = Math.max(0, 1 - Math.max(0, d - b.r) / radius);
      this.wake(b);
      const nx = d > 0 ? dx / d : 0, ny = d > 0 ? dy / d : -1;
      b.vx += nx * impulse * f * b.invM;
      b.vy += (ny - 0.3) * impulse * f * b.invM;
      if (b.invI > 0) b.w += (Math.random() - 0.5) * 6 * f;
      if (b.hp !== Infinity) b.dmg += damage * f;
    }
  }
}

/** Impact damage: approach speed past the threshold times the pair's effective mass. */
export function impactDamage(im: Impact): number {
  const ma = im.a.invM === 0 ? Infinity : im.a.m, mb = im.b.invM === 0 ? Infinity : im.b.m;
  const eff = ma === Infinity ? mb : mb === Infinity ? ma : (ma * mb) / (ma + mb);
  return (im.speed - DMG_SPEED) * Math.min(eff, 6);
}
