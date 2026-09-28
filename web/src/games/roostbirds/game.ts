/** The game rules on top of the physics, with no DOM: slingshot, birds and
 *  their abilities, damage, scoring and the shot-by-shot flow. The canvas
 *  component drives it; tests can too. */
import { impactDamage, makeCircle, type Body, type World } from './physics';
import { GROUND_Y, LEVELS, SCORE, spawnLevel, starsFor, type BirdName, type Level } from './levels';

export const DT = 1 / 120;
export const SLING = { x: 110, y: GROUND_Y - 64 };
export const MAX_PULL = 64;
export const MAX_SPEED = 820;

export interface BirdSpec { r: number; density: number; says: string; hit: Partial<Record<string, number>> }
export const BIRDS: Record<BirdName, BirdSpec> = {
  rue: { r: 11, density: 1.2, says: 'Rue: steady and true', hit: {} },
  pip: { r: 8, density: 1.3, says: 'Tap: Pip splits in three', hit: { glass: 2.5 } },
  ollie: { r: 14, density: 2.2, says: 'Tap: Ollie slams down', hit: { stone: 2.2, wood: 1.3 } },
  wren: { r: 10, density: 1.2, says: 'Tap: Wren zooms', hit: { wood: 2.2 } },
  moss: { r: 12, density: 1.2, says: 'Tap: Moss drops an egg bomb', hit: {} },
};

export type Phase = 'intro' | 'aim' | 'flying' | 'won' | 'lost';
export interface Popup { x: number; y: number; text: string; t: number; big?: boolean }
export interface Particle { x: number; y: number; vx: number; vy: number; t: number; life: number; color: string; size: number }
export interface Boom { x: number; y: number; t: number; r: number }

const BUG_NAMES = ['off-by-one', 'null ref', 'race', 'typo', 'mem leak', 'NaN', 'flaky test', 'segfault', 'inf loop', 'stale cache', 'CSS drift', 'timezone'];

const PIECE_COLORS: Record<string, string[]> = {
  wood: ['#a0642c', '#7a4a1f', '#c98a4a'],
  stone: ['#8d8f98', '#6b6d75', '#b4b6be'],
  glass: ['#bfe6f5', '#8fd0ea', '#ffffff'],
  bug: ['#5c8f2a', '#2e4d14', '#d64545'],
  egg: ['#fff4d6', '#ffcc55', '#ff7a2f'],
};

export class Sim {
  level: Level;
  world: World;
  blocks: Body[];
  bugs: Body[];
  queue: BirdName[];
  current: BirdName | null;
  flyers: Body[] = [];
  eggs: { body: Body; t: number }[] = [];
  phase: Phase = 'intro';
  score = 0;
  shotT = 0;
  endT = 0;
  abilityUsed = false;
  popups: Popup[] = [];
  particles: Particle[] = [];
  booms: Boom[] = [];
  broken = 0;
  shots = 0;
  shake = 0;
  time = 0;
  /** Things the view might want to react to this frame (sound-free juice). */
  events: string[] = [];

  constructor(public index: number) {
    this.level = LEVELS[index];
    const s = spawnLevel(this.level);
    this.world = s.world;
    this.blocks = s.blocks;
    this.bugs = s.bugs;
    this.queue = [...this.level.birds];
    this.current = this.queue.shift() ?? null;
  }

  get bugsLeft() { return this.bugs.filter((b) => !b.dead).length; }
  get stars() { return starsFor(this.level, this.score); }

  /** Launch velocity for a pull from the sling to (px, py). */
  static pull(px: number, py: number): { dx: number; dy: number; vx: number; vy: number; power: number } {
    let dx = px - SLING.x, dy = py - SLING.y;
    const d = Math.hypot(dx, dy);
    if (d > MAX_PULL) { dx *= MAX_PULL / d; dy *= MAX_PULL / d; }
    const power = Math.min(d, MAX_PULL) / MAX_PULL;
    return { dx, dy, vx: (-dx / MAX_PULL) * MAX_SPEED, vy: (-dy / MAX_PULL) * MAX_SPEED, power };
  }

  launch(vx: number, vy: number) {
    if (this.phase !== 'aim' || !this.current) return;
    const spec = BIRDS[this.current];
    const b = makeCircle(SLING.x, SLING.y, spec.r, 'bird', spec.density);
    b.tag = this.current;
    b.vx = vx; b.vy = vy; b.w = vx / 60;
    this.world.add(b);
    this.flyers = [b];
    this.phase = 'flying';
    this.shotT = 0;
    this.abilityUsed = false;
    this.shots++;
    this.events.push('launch');
  }

  /** Mid-flight tap. Returns true if something happened. */
  ability(): boolean {
    if (this.phase !== 'flying' || this.abilityUsed || !this.current) return false;
    const b = this.flyers[0];
    if (!b || b.dead || this.shotT < 0.08) return false;
    const name = this.current;
    if (name === 'rue') return false;
    // abilities only while still airborne and moving
    if (Math.hypot(b.vx, b.vy) < 80) return false;
    this.abilityUsed = true;
    if (name === 'pip') {
      const sp = Math.hypot(b.vx, b.vy), ang = Math.atan2(b.vy, b.vx);
      for (const da of [-0.22, 0.22]) {
        const c = makeCircle(b.x, b.y, b.r, 'bird', BIRDS.pip.density);
        c.tag = 'pip';
        c.vx = Math.cos(ang + da) * sp; c.vy = Math.sin(ang + da) * sp;
        this.world.add(c);
        this.flyers.push(c);
      }
      this.puff(b.x, b.y, '#ffd35a', 10);
    } else if (name === 'ollie') {
      b.vx *= 0.5;
      b.vy = Math.max(b.vy, 0) + 900;
      this.puff(b.x, b.y, '#ffffff', 8);
    } else if (name === 'wren') {
      const sp = Math.hypot(b.vx, b.vy);
      const k = Math.max(1.9, 1100 / sp);
      b.vx *= k; b.vy *= k;
      this.puff(b.x, b.y, '#a78bfa', 10);
    } else if (name === 'moss') {
      const egg = makeCircle(b.x, b.y + b.r + 7, 7, 'egg');
      egg.vx = b.vx * 0.3; egg.vy = Math.max(b.vy, 0) + 250;
      this.world.add(egg);
      this.eggs.push({ body: egg, t: 0 });
      b.vy = -380; b.vx *= 1.1;
      this.puff(b.x, b.y, '#fff4d6', 6);
    }
    this.events.push('ability');
    return true;
  }

  skipIntro() { if (this.phase === 'intro') this.phase = 'aim'; }

  step() {
    const dt = DT;
    this.time += dt;
    if (this.phase === 'intro') { if (this.time > 2.2) this.phase = 'aim'; }
    this.world.step(dt);
    // birds scuff to a stop on the ground instead of bowling through forts
    for (const f of this.flyers) {
      if (!f.dead && f.y >= GROUND_Y - f.r - 1.5) { f.vx *= 0.97; f.w *= 0.97; }
    }
    this.applyDamage();
    this.tickEggs(dt);
    this.cull();
    this.tickFx(dt);
    if (this.phase === 'flying') this.tickShot(dt);
    else if (this.phase === 'aim' && this.bugsLeft === 0) this.finish();
  }

  private applyDamage() {
    for (const im of this.world.impacts) {
      const dmg = impactDamage(im);
      if (dmg <= 0) continue;
      for (const [self, other] of [[im.a, im.b], [im.b, im.a]] as const) {
        if (self.hp === Infinity || self.dead) continue;
        let mult = 1;
        if (other.mat === 'bird' && other.tag) mult = BIRDS[other.tag as BirdName]?.hit[self.mat] ?? 1;
        self.dmg += dmg * mult;
      }
      if (im.a.mat === 'egg' || im.b.mat === 'egg') {
        const e = this.eggs.find((q) => q.body === im.a || q.body === im.b);
        if (e && e.t > 0.05) e.t = 99;
      }
      if (im.speed > 250) this.shake = Math.max(this.shake, Math.min(6, im.speed / 150));
    }
  }

  private tickEggs(dt: number) {
    for (const e of this.eggs) {
      e.t += dt;
      if (e.t > 2.5 && !e.body.dead) {
        e.body.dead = true;
        this.world.explode(e.body.x, e.body.y, 90, 1600, 900);
        this.booms.push({ x: e.body.x, y: e.body.y, t: 0, r: 90 });
        this.puff(e.body.x, e.body.y, '#ff9a3c', 26, 260);
        this.shake = 10;
        this.events.push('boom');
      }
    }
    this.eggs = this.eggs.filter((e) => !e.body.dead);
  }

  private cull() {
    let died = false;
    for (const b of this.world.bodies) {
      if (b.dead) continue;
      const out = b.y > GROUND_Y + 200 || b.x < -300 || b.x > this.level.width + 400;
      if (b.mat === 'bird') { if (out) b.dead = true; continue; }
      if (b.dmg >= b.hp || (out && b.hp !== Infinity)) {
        b.dead = true;
        died = true;
        const boss = b.tag === 'boss';
        const pts = b.mat === 'bug' ? (boss ? SCORE.boss : SCORE.bug) : SCORE[b.mat as 'wood' | 'stone' | 'glass'] ?? 0;
        this.score += pts;
        this.popups.push({ x: b.x, y: b.y - b.r, text: String(pts), t: 0, big: b.mat === 'bug' });
        if (b.mat === 'bug') {
          this.events.push('squash');
          const name = boss ? 'heisenbug' : BUG_NAMES[b.id % BUG_NAMES.length];
          this.popups.push({ x: b.x, y: b.y - b.r - 16, text: `${name} fixed`, t: 0 });
        } else this.broken++;
        const cols = PIECE_COLORS[b.mat] ?? ['#fff'];
        const n = b.mat === 'bug' ? 14 : Math.min(18, 4 + Math.round((b.hw * b.hh) / 40));
        for (let i = 0; i < n; i++) {
          this.particles.push({
            x: b.x + (Math.random() - 0.5) * b.hw * 2, y: b.y + (Math.random() - 0.5) * b.hh * 2,
            vx: (Math.random() - 0.5) * 220 + b.vx * 0.3, vy: -Math.random() * 220 + b.vy * 0.3,
            t: 0, life: 0.6 + Math.random() * 0.6, color: cols[i % cols.length], size: 2 + Math.random() * 3,
          });
        }
      }
    }
    if (died) {
      this.world.bodies = this.world.bodies.filter((b) => !b.dead);
      this.world.wakeAll();
    }
  }

  private tickFx(dt: number) {
    for (const p of this.popups) { p.t += dt; p.y -= 30 * dt; }
    this.popups = this.popups.filter((p) => p.t < 1.2);
    for (const p of this.particles) { p.t += dt; p.vy += 600 * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > GROUND_Y) { p.y = GROUND_Y; p.vy *= -0.3; p.vx *= 0.6; } }
    this.particles = this.particles.filter((p) => p.t < p.life);
    for (const b of this.booms) b.t += dt;
    this.booms = this.booms.filter((b) => b.t < 0.5);
    this.shake = Math.max(0, this.shake - dt * 25);
  }

  /** Everything slow or asleep? */
  calm(): boolean {
    for (const b of this.world.bodies) {
      if (b.dead || b.invM === 0 || b.asleep) continue;
      if (Math.hypot(b.vx, b.vy) > 12 || Math.abs(b.w) > 0.6) return false;
    }
    return !this.eggs.length;
  }

  private tickShot(dt: number) {
    this.shotT += dt;
    const done = this.bugsLeft === 0
      ? this.shotT > 1 && (this.calm() || (this.endT += dt) > 2.5)
      : (this.shotT > 1.2 && this.calm()) || this.shotT > 9 || (this.flyers.every((f) => f.dead) && this.shotT > 3 && this.calm());
    if (!done) return;
    for (const f of this.flyers) {
      if (!f.dead) { this.puff(f.x, f.y, '#ffffff', 8); f.dead = true; }
    }
    this.world.bodies = this.world.bodies.filter((b) => !b.dead);
    this.flyers = [];
    this.world.wakeAll();
    if (this.bugsLeft === 0) return this.finish();
    this.current = this.queue.shift() ?? null;
    if (!this.current) { this.phase = 'lost'; this.events.push('lost'); return; }
    this.phase = 'aim';
  }

  private finish() {
    const spare = this.queue.length + (this.phase === 'aim' && this.current ? 1 : 0);
    for (let i = 0; i < spare; i++) {
      this.score += SCORE.bird;
      this.popups.push({ x: SLING.x + 20 + i * 26, y: SLING.y - 30, text: String(SCORE.bird), t: 0, big: true });
    }
    this.current = null;
    this.queue = [];
    this.phase = 'won';
    this.events.push('won');
  }

  puff(x: number, y: number, color: string, n: number, speed = 140) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.6);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, t: 0, life: 0.4 + Math.random() * 0.4, color, size: 2 + Math.random() * 3 });
    }
  }
}

/** Points of a launch arc, for the dotted preview. */
export function trajectory(vx: number, vy: number, gravity: number, n = 26, every = 0.055): { x: number; y: number }[] {
  const pts = [];
  for (let i = 1; i <= n; i++) {
    const t = i * every;
    pts.push({ x: SLING.x + vx * t, y: SLING.y + vy * t + 0.5 * gravity * t * t });
  }
  return pts;
}
