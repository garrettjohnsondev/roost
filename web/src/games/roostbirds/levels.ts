/** Seventeen hand-made forts full of bugs. Coordinates: x from the left edge,
 *  heights measured up from the ground (the game flips them). */

import { makeBox, makeCircle, World, type Body } from './physics';

export type BlockMat = 'wood' | 'stone' | 'glass' | 'tnt';
export type BirdName = 'rue' | 'pip' | 'ollie' | 'wren' | 'moss' | 'bly' | 'tuck';
export interface BlockDef { x: number; y: number; w: number; h: number; mat: BlockMat }
export interface BugDef { x: number; y: number; r: number; boss?: boolean }
export interface Level {
  name: string;
  scene: string;
  width: number;
  birds: BirdName[];
  blocks: BlockDef[];
  bugs: BugDef[];
}

export const SCORE = { bug: 5000, boss: 8000, glass: 300, wood: 500, stone: 800, tnt: 400, bird: 10000 };
/** A boss bug takes this many ordinary bugs' worth of hits. */
export const BOSS_HP = 5;

class Fort {
  blocks: BlockDef[] = [];
  bugs: BugDef[] = [];
  /** A block sitting on `base`; returns its top. */
  block(cx: number, base: number, w: number, h: number, mat: BlockMat) {
    this.blocks.push({ x: cx, y: base + h / 2, w, h, mat });
    return base + h;
  }
  post(cx: number, base: number, h: number, mat: BlockMat, w = 10) { return this.block(cx, base, w, h, mat); }
  beam(cx: number, base: number, w: number, mat: BlockMat, t = 10) { return this.block(cx, base, w, t, mat); }
  /** Two posts and a roof beam: a doorway. Returns the roof top. */
  frame(cx: number, base: number, span: number, h: number, mat: BlockMat, roof: BlockMat = mat) {
    this.post(cx - span / 2 + 5, base, h, mat);
    this.post(cx + span / 2 - 5, base, h, mat);
    return this.beam(cx, base + h, span + 8, roof);
  }
  bug(cx: number, base: number, r = 10) { this.bugs.push({ x: cx, y: base + r, r }); }
  boss(cx: number, base: number) { this.bugs.push({ x: cx, y: base + 15, r: 15, boss: true }); }
  tnt(cx: number, base: number, s = 20) { return this.block(cx, base, s, s, 'tnt'); }
  done(name: string, scene: string, width: number, birds: BirdName[]): Level {
    return { name, scene, width, birds, blocks: this.blocks, bugs: this.bugs };
  }
}

function build(f: (b: Fort) => void, name: string, scene: string, width: number, birds: BirdName[]) {
  const b = new Fort();
  f(b);
  return b.done(name, scene, width, birds);
}

export const LEVELS: Level[] = [
  // 1. One bug, one shed.
  build((f) => {
    const t = f.frame(560, 0, 60, 40, 'wood');
    f.bug(560, 0);
    f.bug(560, t);
  }, 'Hello, bug', 'orchard', 800, ['rue', 'rue', 'rue']),

  // 2. Glass is brittle.
  build((f) => {
    const t = f.frame(540, 0, 70, 50, 'glass');
    f.bug(540, t);
    const t2 = f.frame(660, 0, 70, 50, 'glass');
    f.bug(660, 0);
    f.bug(660, t2);
  }, 'Brittle tests', 'greenhouse', 860, ['rue', 'rue', 'pip']),

  // 3. Pip splits.
  build((f) => {
    for (const x of [520, 610, 700]) {
      const t = f.post(x, 0, 50, 'wood', 20);
      f.bug(x, t, 9);
    }
    f.bug(565, 0);
  }, 'Scattered warnings', 'picnic', 880, ['pip', 'pip', 'rue']),

  // 4. Two floors.
  build((f) => {
    let t = f.frame(600, 0, 90, 45, 'wood');
    f.bug(600, 0);
    t = f.frame(600, t, 70, 40, 'wood', 'glass');
    f.bug(600, t - 50);
    f.bug(600, t);
  }, 'Nested loops', 'workshop', 900, ['rue', 'pip', 'rue']),

  // 5. Stone walls need Ollie.
  build((f) => {
    f.post(520, 0, 60, 'stone', 16);
    f.post(640, 0, 60, 'stone', 16);
    f.beam(580, 60, 140, 'stone', 12);
    f.bug(580, 0, 12);
    f.bug(560, 72);
    f.bug(600, 72);
    const t = f.frame(820, 0, 60, 40, 'stone', 'wood');
    f.bug(820, 0);
    f.bug(820, t);
  }, 'Legacy module', 'castle', 980, ['ollie', 'ollie', 'rue']),

  // 6. Wren speeds through a long line.
  build((f) => {
    for (let i = 0; i < 5; i++) {
      const x = 520 + i * 125;
      const t = f.frame(x, 0, 40, 30 + i * 12, i % 2 ? 'glass' : 'wood');
      f.bug(x, t, 9);
    }
  }, 'The long queue', 'station', 1150, ['wren', 'wren', 'pip']),

  // 7. Moss drops an egg on a bunker.
  build((f) => {
    f.post(600, 0, 30, 'stone', 20);
    f.post(700, 0, 30, 'stone', 20);
    f.bug(650, 0, 12);
    f.beam(650, 30, 140, 'wood', 12);
    f.block(650, 42, 60, 20, 'stone');
    f.bug(610, 42);
    f.bug(690, 42);
    let t = f.block(930, 0, 50, 20, 'stone');
    t = f.frame(930, t, 40, 40, 'glass', 'stone');
    f.bug(930, t);
  }, 'Bunker bug', 'garage', 1050, ['moss', 'moss', 'rue']),

  // 8. A tall tower.
  build((f) => {
    let t = 0;
    for (let i = 0; i < 4; i++) {
      t = f.frame(640, t, 70, 40, i % 2 ? 'glass' : 'wood', 'wood');
      if (i === 1 || i === 3) f.bug(640, t);
    }
    f.bug(640, 0);
    const u = f.frame(960, 0, 50, 50, 'wood', 'stone');
    f.bug(960, 0, 9);
    f.bug(960, u, 9);
  }, 'Stack overflow', 'lighthouse', 1080, ['pip', 'wren', 'ollie', 'rue']),

  // 9. Two keeps.
  build((f) => {
    for (const x of [580, 920]) {
      let t = f.frame(x, 0, 80, 50, 'stone', 'wood');
      f.bug(x, 0);
      t = f.frame(x, t, 60, 35, 'wood', 'glass');
      f.bug(x, t);
    }
    f.block(750, 0, 30, 30, 'glass');
    f.bug(750, 30);
  }, 'Merge conflict', 'lake', 1100, ['ollie', 'moss', 'pip', 'wren']),

  // 10. The glass palace.
  build((f) => {
    let t = f.frame(620, 0, 120, 45, 'glass');
    f.bug(590, 0); f.bug(650, 0);
    t = f.frame(620, t, 90, 40, 'glass', 'stone');
    f.bug(620, t - 50);
    t = f.frame(620, t, 50, 30, 'glass');
    f.bug(620, t);
    const p = f.post(1010, 0, 90, 'stone', 18);
    f.bug(1010, p);
  }, 'Race condition', 'observatory', 1120, ['wren', 'pip', 'moss']),

  // 11. Behind a wall.
  build((f) => {
    f.post(560, 0, 110, 'stone', 20);
    f.post(592, 0, 60, 'stone', 16);
    let t = f.frame(720, 0, 90, 40, 'wood');
    f.bug(720, 0);
    t = f.frame(720, t, 90, 40, 'wood');
    f.bug(720, t - 50);
    f.bug(720, t);
    f.post(900, 0, 130, 'stone', 20);
    const u = f.frame(1010, 0, 60, 35, 'stone', 'stone');
    f.bug(1010, 0);
    f.bug(1010, u);
  }, 'Behind the firewall', 'summit', 1120, ['moss', 'ollie', 'wren', 'pip']),

  // 12. The boss.
  build((f) => {
    let t = f.frame(760, 0, 130, 50, 'stone', 'stone');
    f.boss(760, 0);
    t = f.frame(760, t, 100, 40, 'wood', 'glass');
    f.bug(740, t - 50); f.bug(780, t - 50);
    t = f.frame(760, t, 60, 35, 'glass', 'wood');
    f.bug(760, t);
    for (const x of [540, 1020]) {
      const tt = f.frame(x, 0, 50, 45, 'stone', 'wood');
      f.bug(x, tt, 9);
    }
  }, 'The heisenbug', 'spaceship', 1130, ['ollie', 'moss', 'pip', 'wren', 'rue']),

  // 13. Bonus: the steps.
  build((f) => {
    for (let i = 0; i < 4; i++) {
      const x = 560 + i * 150;
      let t = 0;
      for (let k = 0; k <= i; k++) t = f.frame(x, t, 60, 30, k % 2 ? 'glass' : 'wood', k === i ? 'stone' : 'wood');
      f.bug(x, t, 9);
    }
    f.bug(1010, 0);
  }, 'Regression steps', 'rooftop', 1130, ['pip', 'wren', 'ollie', 'moss']),

  // 14. Bonus: the vault.
  build((f) => {
    f.post(640, 0, 70, 'stone', 20);
    f.post(800, 0, 70, 'stone', 20);
    f.beam(720, 70, 190, 'stone', 14);
    f.boss(720, 0);
    let t = f.frame(720, 84, 90, 35, 'wood', 'glass');
    f.bug(720, 84);
    t = f.frame(720, t, 60, 30, 'glass', 'stone');
    f.bug(720, t);
    const s = f.block(1000, 0, 60, 60, 'stone');
    f.bug(1000, s, 12);
    f.post(900, 0, 90, 'stone', 16);
  }, 'Production outage', 'submarine', 1130, ['moss', 'ollie', 'moss', 'wren', 'pip']),
  // 15. TNT: one good knock and the whole shed goes.
  build((f) => {
    let t = f.frame(600, 0, 90, 45, 'wood');
    f.tnt(600, 0);
    f.bug(578, 0, 8); f.bug(622, 0, 8);
    t = f.frame(600, t, 70, 40, 'wood', 'glass');
    f.bug(600, t);
    const u = f.frame(820, 0, 60, 50, 'stone', 'wood');
    f.tnt(820, 0, 22);
    f.bug(820, u);
  }, 'Hot fix', 'workshop', 960, ['rue', 'tuck', 'rue']),

  // 16. Bly boomerangs back to the bug you walled off.
  build((f) => {
    f.post(620, 0, 140, 'stone', 20);
    f.bug(670, 0, 10);
    f.bug(705, 0, 9);
    let t = f.frame(880, 0, 80, 45, 'wood');
    f.tnt(880, 0);
    t = f.frame(880, t, 60, 35, 'glass', 'wood');
    f.bug(880, t);
  }, 'Backwards compat', 'station', 960, ['bly', 'bly', 'tuck']),

  // 17. Bosses can take a beating: a health bar and a chain of crates.
  build((f) => {
    const t = f.frame(760, 0, 140, 55, 'stone', 'stone');
    f.boss(760, 0);
    f.tnt(725, 0); f.tnt(795, 0);
    const u = f.frame(760, t, 90, 40, 'wood', 'glass');
    f.bug(760, u);
    f.tnt(560, 0, 22);
    f.bug(560, 22, 9);
    const v = f.frame(990, 0, 60, 60, 'glass', 'wood');
    f.bug(990, 0); f.bug(990, v);
  }, 'Kernel panic', 'spaceship', 1130, ['tuck', 'ollie', 'bly', 'moss', 'pip']),
];

export function levelValue(l: Level) {
  const bugs = l.bugs.reduce((n, b) => n + (b.boss ? SCORE.boss : SCORE.bug), 0);
  const blocks = l.blocks.reduce((n, b) => n + SCORE[b.mat], 0);
  return { bugs, blocks };
}

/** 1 star to clear; 2 for real damage; 3 for a demolition with birds to
 *  spare (one on a short level, two when you get four or five). */
export function starsFor(l: Level, score: number): number {
  const { bugs, blocks } = levelValue(l);
  if (score < bugs) return 0;
  if (score >= bugs + blocks * 0.4 + SCORE.bird * Math.max(1, Math.floor(l.birds.length / 2))) return 3;
  if (score >= bugs + blocks * 0.25) return 2;
  return 1;
}

export const GROUND_Y = 340;

/** Builds the physics world for a level: ground, blocks and bugs. */
export function spawnLevel(l: Level): { world: World; ground: Body; blocks: Body[]; bugs: Body[] } {
  const world = new World();
  const ground = world.add(makeBox(l.width / 2, GROUND_Y + 100, l.width + 2000, 200, 'ground', 0, true));
  const blocks = l.blocks.map((d) => world.add(makeBox(d.x, GROUND_Y - d.y, d.w, d.h, d.mat)));
  const bugs = l.bugs.map((d) => {
    const b = world.add(makeCircle(d.x, GROUND_Y - d.y, d.r, 'bug'));
    b.invI = 0; // beetles slide, they don't roll
    if (d.boss) { b.hp *= BOSS_HP; b.tag = 'boss'; }
    return b;
  });
  // forts start asleep: rock solid until something hits them
  for (const b of [...blocks, ...bugs]) b.asleep = true;
  return { world, ground, blocks, bugs };
}
