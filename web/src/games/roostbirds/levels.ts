/** Three worlds of fifteen hand-built forts, each world a small coding story
 *  with one backdrop, its own gimmick and a new bird, and a boss at 15.
 *  Coordinates: x from the left edge, heights measured up from the ground
 *  (the game flips them). */

import { makeBox, makeCircle, World, type Body } from './physics';

export type BlockMat = 'wood' | 'stone' | 'glass' | 'tnt';
export type BirdName = 'rue' | 'pip' | 'ollie' | 'wren' | 'moss' | 'bly' | 'tuck';
export interface BlockDef { x: number; y: number; w: number; h: number; mat: BlockMat }
export interface BugDef { x: number; y: number; r: number; boss?: boolean }
/** A floating sky island: a slab held up by balloons (dx from the island's
 *  centre, up: how high over the slab's top the balloon floats). Pop them
 *  all and it drops. */
export interface IslandDef { x: number; y: number; w: number; h: number; balloons: { dx: number; up: number }[] }
export interface Level {
  name: string;
  /** 0, 1, 2 */
  world: number;
  /** 1..15 within its world */
  num: number;
  width: number;
  birds: BirdName[];
  blocks: BlockDef[];
  bugs: BugDef[];
  islands: IslandDef[];
  /** The boss's name, on a boss level. */
  boss?: string;
  /** One line on the intro card: what this fort is about. */
  hint: string;
}

export interface WorldDef {
  name: string;
  story: string;
  /** The bird this world brings in. */
  newBird: BirdName;
  newBirdSays: string;
  gimmick: string;
  boss: string;
  /** Stars needed in the previous world to open this one. */
  unlockStars: number;
}

export const WORLDS: WorldDef[] = [
  {
    name: 'Legacy Code',
    story: 'Ancient ruins at dusk. Nobody remembers who wrote this, but the bugs moved in long ago.',
    newBird: 'ollie', newBirdSays: 'Ollie joins: heavy, and he cracks stone.',
    gimmick: 'Stone and wood: find the weak post.',
    boss: 'the Ancient Bug', unlockStars: 0,
  },
  {
    name: 'Merge Conflict',
    story: 'A humming glass server room. Two branches, two forts, and both have to go.',
    newBird: 'bly', newBirdSays: 'Bly joins: tap and he boomerangs back.',
    gimmick: 'Glass, joined forts and TNT.',
    boss: 'the Merge Beast', unlockStars: 30,
  },
  {
    name: 'The Cloud',
    story: 'Sky islands on balloons. Pop the balloons and the whole thing comes down.',
    newBird: 'tuck', newBirdSays: 'Tuck joins: he bounces. Tap for a big hop.',
    gimmick: 'Balloon-lifted forts.',
    boss: 'the Cloud Leak', unlockStars: 30,
  },
];
export const LEVELS_PER_WORLD = 15;

export const SCORE = { bug: 5000, boss: 8000, glass: 300, wood: 500, stone: 800, tnt: 400, balloon: 300, bird: 10000 };
/** A boss bug takes this many ordinary bugs' worth of hits. */
export const BOSS_HP = 5;
export const ISLAND_T = 14;

class Fort {
  blocks: BlockDef[] = [];
  bugs: BugDef[] = [];
  islands: IslandDef[] = [];
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
  boss(cx: number, base: number, r = 15) { this.bugs.push({ x: cx, y: base + r, r, boss: true }); }
  tnt(cx: number, base: number, s = 20) { return this.block(cx, base, s, s, 'tnt'); }
  /** A floating slab `h` above the ground; returns its top. */
  island(cx: number, h: number, w: number, balloons: [number, number][]) {
    this.islands.push({ x: cx, y: h + ISLAND_T / 2, w, h: ISLAND_T, balloons: balloons.map(([dx, up]) => ({ dx, up })) });
    return h + ISLAND_T;
  }
}

interface Spec { name: string; hint: string; width: number; birds: BirdName[]; boss?: boolean; build: (f: Fort) => void }

function world(w: number, specs: Spec[]): Level[] {
  return specs.map((s, i) => {
    const f = new Fort();
    s.build(f);
    return {
      name: s.name, world: w, num: i + 1, width: s.width, birds: s.birds, hint: s.hint,
      blocks: f.blocks, bugs: f.bugs, islands: f.islands, boss: s.boss ? WORLDS[w].boss : undefined,
    };
  });
}

// ---------------------------------------------------------------- world 1
const LEGACY = world(0, [
  {
    name: 'Hello, world', hint: 'Drag back, let go. One bug, one shed.', width: 760, birds: ['rue', 'rue', 'rue'],
    build: (f) => { const t = f.frame(520, 0, 60, 40, 'wood'); f.bug(520, t); },
  },
  {
    name: 'Dead code', hint: 'Two old sheds. Knock them both flat.', width: 820, birds: ['rue', 'rue', 'rue'],
    build: (f) => {
      const t = f.frame(520, 0, 60, 40, 'wood'); f.bug(520, t);
      const u = f.frame(660, 0, 60, 50, 'wood'); f.bug(660, 0); f.bug(660, u);
    },
  },
  {
    name: 'Carved in stone', hint: 'Stone shrugs off Rue. Ollie cracks it: tap to slam down.', width: 860, birds: ['ollie', 'ollie', 'rue'],
    build: (f) => {
      const t = f.frame(600, 0, 70, 50, 'stone', 'wood');
      f.bug(600, 0); f.bug(600, t);
    },
  },
  {
    name: 'Scattered TODOs', hint: 'Pip splits in three mid-air. Three posts, three bugs.', width: 900, birds: ['pip', 'pip', 'rue'],
    build: (f) => {
      for (const x of [540, 620, 700]) { const t = f.post(x, 0, 55, 'wood', 18); f.bug(x, t, 9); }
    },
  },
  {
    name: 'Spaghetti', hint: 'A wobbly three-floor tower. Hit it low.', width: 900, birds: ['rue', 'ollie', 'pip'],
    build: (f) => {
      let t = f.frame(640, 0, 80, 45, 'wood'); f.bug(640, 0);
      t = f.frame(640, t, 70, 40, 'wood'); f.bug(640, t - 50);
      t = f.frame(640, t, 60, 35, 'wood', 'stone'); f.bug(640, t - 45); f.bug(640, t);
    },
  },
  {
    name: 'Load-bearing hack', hint: 'Stone on top, one wooden post holding it all up.', width: 940, birds: ['rue', 'ollie', 'pip'],
    build: (f) => {
      f.post(600, 0, 70, 'stone', 16);
      f.post(700, 0, 70, 'wood', 12);
      const t = f.beam(650, 70, 150, 'stone', 14);
      f.bug(650, 0, 12);
      f.bug(620, t); f.bug(680, t);
      f.post(820, 0, 40, 'stone', 30); f.bug(820, 40);
    },
  },
  {
    name: 'The long scroll', hint: 'Wren zooms when you tap. Four shrines in a row.', width: 1100, birds: ['wren', 'wren', 'pip'],
    build: (f) => {
      for (let i = 0; i < 4; i++) {
        const x = 540 + i * 130;
        const t = f.frame(x, 0, 44, 36 + i * 10, 'wood', i % 2 ? 'stone' : 'wood');
        f.bug(x, t, 9);
      }
    },
  },
  {
    name: 'Buried in the vault', hint: 'Moss drops an egg that goes off. Aim it at the roof.', width: 980, birds: ['moss', 'moss', 'ollie'],
    build: (f) => {
      f.post(640, 0, 34, 'stone', 22); f.post(740, 0, 34, 'stone', 22);
      f.bug(690, 0, 12);
      const t = f.beam(690, 34, 150, 'stone', 14);
      f.bug(650, t); f.bug(730, t);
      f.post(690, t, 30, 'stone', 16);
    },
  },
  {
    name: 'Goto considered harmful', hint: 'Ruins that climb. Each step is taller.', width: 1100, birds: ['pip', 'wren', 'ollie', 'rue'],
    build: (f) => {
      for (let i = 0; i < 4; i++) {
        const x = 520 + i * 140;
        let t = 0;
        for (let k = 0; k <= i; k++) t = f.frame(x, t, 56, 30, k % 2 ? 'stone' : 'wood', 'wood');
        f.bug(x, t, 9);
      }
    },
  },
  {
    name: 'Undocumented', hint: 'A wall in the way. Lob high over it.', width: 1000, birds: ['moss', 'ollie', 'rue'],
    build: (f) => {
      f.post(560, 0, 130, 'stone', 22);
      let t = f.frame(700, 0, 90, 44, 'wood', 'stone'); f.bug(700, 0);
      t = f.frame(700, t, 70, 36, 'wood'); f.bug(700, t);
      f.post(840, 0, 130, 'stone', 22);
      f.bug(900, 0, 11);
    },
  },
  {
    name: 'The monolith', hint: 'A stone block on wooden legs. Take out the legs.', width: 1000, birds: ['wren', 'ollie', 'pip', 'rue'],
    build: (f) => {
      f.post(640, 0, 60, 'wood', 12); f.post(700, 0, 60, 'wood', 12); f.post(760, 0, 60, 'wood', 12);
      const t = f.block(700, 60, 150, 50, 'stone');
      f.bug(670, 0, 10); f.bug(730, 0, 10);
      f.bug(700, t, 12);
      f.bug(860, 0);
    },
  },
  {
    name: 'Two temples', hint: 'Stone out front, wood behind a wall. Save a bird for the back.', width: 1120, birds: ['ollie', 'pip', 'moss', 'rue'],
    build: (f) => {
      let t = f.frame(560, 0, 80, 50, 'stone'); f.bug(560, 0);
      t = f.frame(560, t, 60, 30, 'stone', 'wood'); f.bug(560, t);
      f.post(760, 0, 150, 'stone', 24);
      let u = f.frame(960, 0, 80, 50, 'wood', 'stone'); f.bug(960, 0);
      u = f.frame(960, u, 80, 40, 'wood', 'stone'); f.bug(940, u); f.bug(980, u);
    },
  },
  {
    name: 'The keystone', hint: 'Two stone slabs lean on one wooden post. Knock it out.', width: 1040, birds: ['wren', 'ollie', 'pip', 'moss'],
    build: (f) => {
      f.post(620, 0, 70, 'stone', 20); f.post(780, 0, 70, 'stone', 20); f.post(700, 0, 70, 'wood', 20);
      const t = f.block(655, 70, 86, 16, 'stone'); f.block(745, 70, 86, 16, 'stone');
      f.bug(660, 0, 11); f.bug(740, 0, 11);
      f.bug(645, t); f.bug(755, t);
      const u = f.frame(930, 0, 60, 60, 'stone'); f.bug(930, 0); f.bug(930, u, 9);
    },
  },
  {
    name: 'Catacombs', hint: 'Stone floors stacked deep. Eggs go right through the gaps.', width: 1080, birds: ['moss', 'ollie', 'moss', 'pip'],
    build: (f) => {
      let t = f.frame(700, 0, 130, 40, 'stone'); f.bug(670, 0); f.bug(730, 0);
      t = f.frame(700, t, 110, 36, 'stone', 'wood'); f.bug(700, t - 46);
      t = f.frame(700, t, 80, 30, 'wood', 'stone'); f.bug(700, t - 40); f.bug(700, t);
      f.block(920, 0, 40, 80, 'stone'); f.bug(920, 80, 11);
    },
  },
  {
    name: 'The Ancient Bug', hint: 'Boss. It takes five bugs worth of hits, and it lives in the temple.', width: 1140, birds: ['ollie', 'moss', 'pip', 'wren'], boss: true,
    build: (f) => {
      f.post(540, 0, 90, 'stone', 20);
      let t = f.frame(720, 0, 140, 55, 'stone'); f.boss(720, 0, 16);
      t = f.frame(720, t, 110, 40, 'stone'); f.bug(690, t - 50); f.bug(750, t - 50);
      t = f.frame(720, t, 70, 30, 'stone', 'wood'); f.bug(720, t);
      f.post(880, 0, 130, 'stone', 22);
      f.post(990, 0, 50, 'stone', 20); f.post(1070, 0, 50, 'stone', 20);
      const u = f.beam(1030, 50, 110, 'stone', 16); f.bug(1030, 0, 12);
      f.bug(1030, u, 9);
    },
  },
]);

// ---------------------------------------------------------------- world 2
const MERGE = world(1, [
  {
    name: 'Pull request', hint: 'Glass racks break easy. Welcome to the server room.', width: 840, birds: ['rue', 'rue', 'pip'],
    build: (f) => {
      let t = f.frame(580, 0, 70, 50, 'glass'); f.bug(580, 0);
      t = f.frame(580, t, 70, 40, 'glass'); f.bug(580, t);
    },
  },
  {
    name: 'Hot path', hint: 'TNT goes off when it breaks, and takes its neighbours.', width: 900, birds: ['rue', 'pip', 'rue'],
    build: (f) => {
      const t = f.frame(640, 0, 110, 50, 'stone', 'glass');
      f.tnt(640, 0, 22); f.bug(605, 0, 9); f.bug(675, 0, 9);
      f.bug(640, t);
    },
  },
  {
    name: 'Revert', hint: 'Bly boomerangs: fly past, tap, and he comes back for the bug behind.', width: 900, birds: ['bly', 'bly', 'rue'],
    build: (f) => {
      f.post(600, 0, 150, 'stone', 22);
      f.bug(650, 0, 10); f.bug(685, 0, 9);
      const t = f.frame(780, 0, 50, 40, 'glass'); f.bug(780, t, 9);
    },
  },
  {
    name: 'Ours and theirs', hint: 'Two forts joined by one beam. Both have to fall.', width: 1000, birds: ['pip', 'bly', 'rue'],
    build: (f) => {
      const a = f.frame(600, 0, 60, 60, 'glass'); f.bug(600, 0);
      f.frame(800, 0, 60, 60, 'glass'); f.bug(800, 0);
      const t = f.beam(700, a, 250, 'wood', 10);
      f.bug(700, t, 9);
      const b = f.frame(600, t, 50, 30, 'glass', 'wood'); f.bug(600, b);
      const c = f.frame(800, t, 50, 30, 'glass', 'wood'); f.bug(800, c);
    },
  },
  {
    name: 'Chain reaction', hint: 'A row of crates. One good spark does the rest.', width: 1040, birds: ['rue', 'wren', 'pip'],
    build: (f) => {
      for (let i = 0; i < 4; i++) {
        const x = 580 + i * 95;
        const t = f.frame(x, 0, 60, 44, i % 2 ? 'stone' : 'glass', 'stone');
        f.tnt(x, 0, 20);
        f.bug(x, t, 9);
      }
    },
  },
  {
    name: 'Cherry-pick', hint: 'Lone bugs on tall glass stalks. Pick them one by one.', width: 1060, birds: ['pip', 'bly', 'wren'],
    build: (f) => {
      const hs = [110, 60, 150, 90];
      hs.forEach((h, i) => { const x = 560 + i * 125; const t = f.post(x, 0, h, 'glass', 14); f.bug(x, t, 9); });
    },
  },
  {
    name: 'Rebase', hint: 'Glass racks with stone lids. The lids fall on the bugs.', width: 1000, birds: ['ollie', 'pip', 'bly'],
    build: (f) => {
      let t = f.frame(680, 0, 120, 44, 'glass', 'stone'); f.bug(650, 0); f.bug(710, 0);
      t = f.frame(680, t, 100, 40, 'glass', 'stone'); f.bug(680, t - 50);
      t = f.frame(680, t, 70, 36, 'glass', 'stone'); f.bug(680, t - 46); f.bug(680, t);
    },
  },
  {
    name: 'Diff', hint: 'Mirror-image racks. The back one hides behind stone.', width: 1080, birds: ['bly', 'pip', 'moss', 'ollie'],
    build: (f) => {
      let t = f.frame(580, 0, 70, 50, 'glass'); f.bug(580, 0); f.bug(580, t);
      f.post(740, 0, 140, 'stone', 22);
      t = f.frame(880, 0, 70, 50, 'glass'); f.bug(880, 0); f.bug(880, t);
    },
  },
  {
    name: 'Git blame', hint: 'A crate behind the wall. Find a way round.', width: 1000, birds: ['bly', 'moss', 'ollie'],
    build: (f) => {
      f.post(620, 0, 120, 'stone', 26);
      f.tnt(680, 0, 22); f.bug(710, 0, 9);
      let t = f.frame(760, 0, 60, 50, 'glass', 'stone'); f.bug(760, 0, 9);
      t = f.frame(760, t, 60, 30, 'glass'); f.bug(760, t);
      f.post(860, 0, 80, 'stone', 20); f.bug(860, 80, 9);
    },
  },
  {
    name: 'Squash commits', hint: 'A tall glass rack, and a stone box behind it.', width: 1060, birds: ['wren', 'pip', 'bly'],
    build: (f) => {
      let t = 0;
      for (let i = 0; i < 5; i++) {
        t = f.frame(640, t, 70, 34, 'glass', i === 4 ? 'stone' : 'glass');
        if (i % 2 === 0) f.bug(640, t - 44);
      }
      f.bug(640, t);
      f.post(900, 0, 50, 'stone', 20); f.post(980, 0, 50, 'stone', 20);
      const u = f.beam(940, 50, 110, 'stone', 16); f.bug(940, 0, 12); f.bug(940, u, 9);
    },
  },
  {
    name: 'Detached HEAD', hint: 'A bug up high on a ledge, crates below, a vault out front.', width: 1100, birds: ['bly', 'ollie', 'pip'],
    build: (f) => {
      f.post(800, 0, 120, 'stone', 20); f.post(920, 0, 120, 'stone', 20);
      const t = f.beam(860, 120, 160, 'glass', 12); f.bug(835, t); f.bug(885, t);
      f.tnt(860, 0, 24); f.bug(830, 0, 9); f.bug(890, 0, 9);
      f.post(560, 0, 40, 'stone', 20); f.post(640, 0, 40, 'stone', 20);
      const u = f.beam(600, 40, 110, 'stone', 16); f.bug(600, 0, 11); f.bug(600, u, 9);
    },
  },
  {
    name: 'Force push', hint: 'Stone walls round a glass core full of TNT.', width: 1080, birds: ['ollie', 'bly', 'moss'],
    build: (f) => {
      f.post(650, 0, 110, 'stone', 22); f.post(830, 0, 110, 'stone', 22);
      const t = f.beam(740, 110, 210, 'stone', 14);
      const k = f.tnt(740, 0, 26); f.bug(700, 0); f.bug(780, 0);
      const g = f.block(740, k, 26, 26, 'glass'); f.bug(740, g, 9);
      f.bug(700, t); f.bug(780, t);
      const u = f.frame(990, 0, 60, 60, 'stone'); f.bug(990, 0); f.bug(990, u, 9);
    },
  },
  {
    name: 'Octopus merge', hint: 'Three forts on long stone beams. Bring every one down.', width: 1140, birds: ['pip', 'bly', 'ollie'],
    build: (f) => {
      for (const x of [540, 780, 1020]) {
        f.post(x - 34, 0, 60, 'stone', 14); f.post(x + 34, 0, 60, 'stone', 14); f.bug(x, 0);
        const t = f.beam(x, 60, 100, 'stone', 12);
        const u = f.frame(x, t, 50, 30, 'glass', 'stone'); f.bug(x, u, 9);
        f.tnt(x, t, 18);
      }
      f.post(660, 0, 110, 'stone', 20); f.post(900, 0, 110, 'stone', 20);
    },
  },
  {
    name: 'Conflict markers', hint: 'Layer on layer: glass, stone, crates. Plan three shots.', width: 1140, birds: ['moss', 'bly', 'ollie'],
    build: (f) => {
      f.post(560, 0, 100, 'stone', 22);
      let t = f.frame(720, 0, 120, 44, 'stone', 'stone'); f.tnt(720, 0, 22); f.bug(680, 0, 9); f.bug(760, 0, 9);
      t = f.frame(720, t, 100, 40, 'stone', 'stone'); f.bug(720, t - 50);
      t = f.frame(720, t, 60, 34, 'stone', 'glass'); f.bug(720, t);
      f.post(880, 0, 150, 'stone', 22);
      const u = f.frame(1030, 0, 60, 60, 'stone', 'stone'); f.bug(1030, 0); f.tnt(1030, u, 18);
      f.bug(1030, u + 18, 9);
    },
  },
  {
    name: 'The Merge Beast', hint: 'Boss. Two forts, one beast between them. Everything has to fall.', width: 1160, birds: ['bly', 'ollie', 'moss', 'pip'], boss: true,
    build: (f) => {
      let a = f.frame(560, 0, 80, 60, 'stone', 'stone'); f.bug(560, 0);
      a = f.frame(560, a, 60, 34, 'glass', 'stone'); f.bug(560, a);
      f.post(680, 0, 100, 'stone', 22); f.post(880, 0, 100, 'stone', 22);
      const t = f.beam(780, 100, 230, 'stone', 16);
      f.boss(780, 0, 17); f.tnt(730, 0, 22); f.tnt(830, 0, 22);
      f.bug(780, t);
      f.post(960, 0, 160, 'stone', 22);
      let b = f.frame(1060, 0, 80, 60, 'stone', 'stone'); f.bug(1060, 0);
      b = f.frame(1060, b, 60, 34, 'glass', 'stone'); f.bug(1060, b);
    },
  },
]);

// ---------------------------------------------------------------- world 3
const CLOUD = world(2, [
  {
    name: 'First upload', hint: 'This fort floats. Pop the balloons and it drops.', width: 880, birds: ['rue', 'rue', 'tuck'],
    build: (f) => {
      const t = f.island(600, 110, 90, [[-38, 55], [38, 55]]);
      f.bug(600, t);
    },
  },
  {
    name: 'Bounce rate', hint: 'Tuck bounces. Skip him under the ledge. Tap for a hop.', width: 940, birds: ['tuck', 'tuck', 'rue'],
    build: (f) => {
      const t = f.island(640, 60, 150, [[-65, 120], [65, 120]]);
      f.post(640, t, 60, 'stone', 30); f.bug(600, t); f.bug(680, t);
      f.bug(620, 0); f.bug(660, 0);
    },
  },
  {
    name: 'Latency', hint: 'Two islands, near and far.', width: 1000, birds: ['pip', 'tuck', 'rue'],
    build: (f) => {
      let t = f.island(560, 140, 80, [[-34, 40], [34, 40]]);
      t = f.frame(560, t, 50, 30, 'glass'); f.bug(560, t, 9);
      let u = f.island(820, 80, 100, [[-44, 70], [44, 70]]);
      u = f.frame(820, u, 60, 40, 'wood'); f.bug(820, u - 50); f.bug(820, u);
    },
  },
  {
    name: 'Object storage', hint: 'Heavy stone crates on a floating slab. Drop it on them.', width: 1000, birds: ['tuck', 'ollie', 'pip'],
    build: (f) => {
      const t = f.island(700, 150, 140, [[-62, 60], [62, 60]]);
      f.block(670, t, 40, 40, 'stone'); f.block(730, t, 40, 40, 'stone');
      const u = f.beam(700, t + 40, 100, 'wood', 10); f.bug(700, u, 9);
      f.post(640, 0, 30, 'stone', 16); f.post(760, 0, 30, 'stone', 16);
      f.bug(700, 0, 12); f.bug(670, 0, 9); f.bug(730, 0, 9);
    },
  },
  {
    name: 'Autoscaling', hint: 'A tower that grows to the sky, with a balloon crown.', width: 1020, birds: ['wren', 'tuck', 'pip'],
    build: (f) => {
      let t = f.frame(700, 0, 70, 40, 'wood'); f.bug(700, 0);
      t = f.frame(700, t, 60, 40, 'glass'); f.bug(700, t - 50);
      const u = f.island(700, 190, 110, [[-48, 50], [48, 50]]);
      f.bug(680, u); f.bug(720, u);
      f.bug(700, t, 9);
    },
  },
  {
    name: 'Region failover', hint: 'Knock one island into the other.', width: 1060, birds: ['bly', 'tuck'],
    build: (f) => {
      let t = f.island(640, 170, 90, [[-38, 50], [38, 50]]);
      t = f.frame(640, t, 60, 34, 'stone', 'wood'); f.bug(640, t);
      f.tnt(640, 184, 18);
      let u = f.island(820, 90, 120, [[-54, 60], [54, 60]]);
      u = f.frame(820, u, 80, 40, 'glass', 'stone'); f.bug(820, u - 50); f.bug(820, u);
    },
  },
  {
    name: 'Cold start', hint: 'A shielded island: stone walls hide the balloons.', width: 1060, birds: ['ollie', 'tuck', 'moss', 'pip'],
    build: (f) => {
      f.post(560, 0, 170, 'stone', 22);
      const t = f.island(740, 130, 130, [[-58, 50], [58, 50]]);
      let u = f.frame(740, t, 70, 40, 'stone', 'stone'); f.bug(740, t);
      f.bug(740, u, 9);
      f.post(900, 0, 170, 'stone', 22);
      f.bug(740, 0, 12);
      f.post(980, 0, 40, 'stone', 18); f.post(1040, 0, 40, 'stone', 18);
      f.beam(1010, 40, 90, 'stone', 14); f.bug(1010, 0, 11);
      void u;
    },
  },
  {
    name: 'Edge cache', hint: 'Bugs perched on the islands\' rims. Clip them off.', width: 1080, birds: ['pip', 'wren'],
    build: (f) => {
      const a = f.island(580, 150, 110, [[0, 70]]);
      f.bug(540, a, 9); f.bug(620, a, 9); f.post(580, a, 40, 'glass', 14);
      const b = f.island(820, 70, 140, [[-60, 100], [60, 100]]);
      f.bug(770, b, 9); f.bug(870, b, 9); f.block(820, b, 60, 30, 'stone'); f.bug(820, b + 30, 9);
    },
  },
  {
    name: 'Serverless', hint: 'No ground under this fort at all. Every balloon counts.', width: 1080, birds: ['tuck', 'bly', 'pip'],
    build: (f) => {
      const t = f.island(760, 200, 170, [[-76, 50], [0, 80], [76, 50]]);
      let u = f.frame(760, t, 110, 40, 'wood', 'stone'); f.bug(730, t); f.bug(790, t);
      u = f.frame(760, u, 60, 30, 'glass'); f.bug(760, u);
      f.post(560, 0, 50, 'stone', 18); f.post(620, 0, 50, 'stone', 18);
      f.beam(590, 50, 90, 'stone', 14); f.bug(590, 0, 11);
    },
  },
  {
    name: 'Rate limited', hint: 'Balloons behind glass, crates on the slab, and one more up high.', width: 1120, birds: ['bly', 'moss', 'tuck'],
    build: (f) => {
      const t = f.island(760, 110, 230, [[-100, 60], [100, 60]]);
      f.post(660, t, 80, 'glass', 12); f.post(860, t, 80, 'glass', 12);
      const u = f.frame(760, t, 80, 44, 'stone', 'glass'); f.tnt(760, t, 20); f.bug(760, u);
      f.bug(720, 0); f.bug(800, 0);
      f.post(560, 0, 110, 'stone', 22);
      f.post(960, 0, 200, 'stone', 22);
      const v = f.island(1050, 210, 70, [[0, 50]]); f.bug(1050, v, 9);
    },
  },
  {
    name: 'Vendor lock-in', hint: 'A stone cage in the sky, a vault on the ground, a lookout far off.', width: 1140, birds: ['ollie', 'tuck', 'bly'],
    build: (f) => {
      const t = f.island(700, 180, 150, [[-66, 90], [66, 90]]);
      f.post(645, t, 50, 'stone', 16); f.post(755, t, 50, 'stone', 16);
      f.beam(700, t + 50, 136, 'stone', 12);
      f.bug(685, t); f.bug(715, t);
      f.post(560, 0, 60, 'stone', 20);
      f.post(840, 0, 60, 'stone', 22); f.post(920, 0, 60, 'stone', 22);
      const u = f.beam(880, 60, 110, 'stone', 16); f.bug(880, 0, 12);
      f.post(880, u, 40, 'stone', 20);
      const v = f.island(1060, 230, 70, [[0, 45]]); f.bug(1060, v, 9);
      f.post(1000, 0, 120, 'stone', 20);
    },
  },
  {
    name: 'Eventual consistency', hint: 'Three islands, far apart. Each one needs its own shot.', width: 1160, birds: ['tuck', 'pip', 'bly'],
    build: (f) => {
      const hs = [70, 170, 250];
      hs.forEach((h, i) => {
        const x = 560 + i * 240;
        const t = f.island(x, h, 90, [[-38, 40], [38, 40]]);
        const u = f.frame(x, t, 50, 34, i === 1 ? 'stone' : 'glass', 'stone');
        f.bug(x, t, 9); f.bug(x, u, 9);
      });
      f.post(680, 0, 120, 'stone', 22); f.post(920, 0, 160, 'stone', 22);
    },
  },
  {
    name: 'Split brain', hint: 'Two copies of the same fort, one high, one low. Both must go.', width: 1140, birds: ['bly', 'ollie', 'tuck'],
    build: (f) => {
      for (const [x, h] of [[600, 30], [960, 210]] as const) {
        const t = f.island(x, h, 130, [[-58, 90], [58, 90]]);
        let u = f.frame(x, t, 80, 40, 'stone', 'stone'); f.bug(x, t, 11);
        u = f.frame(x, u, 60, 30, 'stone', 'stone'); f.bug(x, u - 40, 9); f.bug(x, u, 9);
      }
      f.post(780, 0, 190, 'stone', 24);
    },
  },
  {
    name: 'Cascade failure', hint: 'Islands stacked on islands, and a stone keep. Start at the top.', width: 1160, birds: ['pip', 'tuck', 'ollie'],
    build: (f) => {
      f.post(560, 0, 150, 'stone', 22);
      const a = f.island(720, 110, 120, [[-54, 120], [54, 120]]);
      f.block(690, a, 40, 40, 'stone'); f.block(750, a, 40, 40, 'stone'); f.bug(720, a, 9);
      const b = f.island(720, 240, 90, [[-40, 30], [40, 30]]);
      f.tnt(720, b, 20); f.bug(690, b, 9); f.bug(750, b, 9);
      f.post(860, 0, 120, 'stone', 22);
      let t = f.frame(1010, 0, 90, 50, 'stone', 'stone'); f.bug(1010, 0, 12);
      t = f.frame(1010, t, 70, 40, 'stone', 'stone'); f.bug(1010, t - 50, 9); f.bug(1010, t, 9);
    },
  },
  {
    name: 'The Cloud Leak', hint: 'Boss. It floats on four balloons behind stone, and its guards are spread far.', width: 1180, birds: ['tuck', 'bly', 'ollie', 'moss', 'pip'], boss: true,
    build: (f) => {
      f.post(560, 0, 200, 'stone', 24);
      const t = f.island(760, 190, 200, [[-92, 90], [-40, 110], [40, 110], [92, 90]]);
      f.post(685, t, 60, 'stone', 18); f.post(835, t, 60, 'stone', 18);
      f.beam(760, t + 60, 170, 'stone', 14);
      f.boss(760, t, 18);
      f.bug(715, t, 9); f.bug(805, t, 9);
      f.post(700, 0, 40, 'stone', 20); f.post(820, 0, 40, 'stone', 20);
      const g = f.beam(760, 40, 140, 'stone', 14); f.bug(760, 0, 12);
      f.bug(760, g, 9);
      f.post(960, 0, 220, 'stone', 22);
      const u = f.island(1080, 240, 80, [[0, 60]]); f.bug(1080, u, 9);
      const v = f.frame(1080, 0, 60, 50, 'stone', 'stone'); f.bug(1080, 0); f.bug(1080, v, 9);
    },
  },
]);

export const LEVELS: Level[] = [...LEGACY, ...MERGE, ...CLOUD];

/** Index into LEVELS for a world and a 1-based level number. */
export const levelIndex = (w: number, num: number) => w * LEVELS_PER_WORLD + num - 1;

export function levelValue(l: Level) {
  const bugs = l.bugs.reduce((n, b) => n + (b.boss ? SCORE.boss : SCORE.bug), 0);
  const blocks = l.blocks.reduce((n, b) => n + SCORE[b.mat], 0) + l.islands.reduce((n, i) => n + i.balloons.length * SCORE.balloon, 0);
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

/** The highest point of a level (for the camera), in heights above ground. */
export function levelTop(l: Level): number {
  let top = 0;
  for (const b of l.blocks) top = Math.max(top, b.y + b.h / 2);
  for (const b of l.bugs) top = Math.max(top, b.y + b.r);
  for (const i of l.islands) for (const b of i.balloons) top = Math.max(top, i.y + i.h / 2 + b.up + 14);
  return top;
}

export interface Balloon { x: number; y: number; r: number; island: Body; dead: boolean; phase: number }

/** Builds the physics world for a level: ground, islands, blocks and bugs.
 *  Islands hang still (no mass) until their balloons are gone. */
export function spawnLevel(l: Level): { world: World; ground: Body; blocks: Body[]; bugs: Body[]; islands: Body[]; balloons: Balloon[] } {
  const world = new World();
  const ground = world.add(makeBox(l.width / 2, GROUND_Y + 100, l.width + 2000, 200, 'ground', 0, true));
  const islands = l.islands.map((d) => {
    const b = world.add(makeBox(d.x, GROUND_Y - d.y, d.w, d.h, 'stone'));
    b.hp = Infinity;
    b.tag = 'island';
    b.invM = 0; b.invI = 0; // hanging from its balloons
    return b;
  });
  const balloons: Balloon[] = [];
  l.islands.forEach((d, i) => d.balloons.forEach((p, k) => balloons.push({
    x: d.x + p.dx, y: GROUND_Y - (d.y + d.h / 2 + p.up), r: 12, island: islands[i], dead: false, phase: i * 1.7 + k * 2.3,
  })));
  const blocks = l.blocks.map((d) => world.add(makeBox(d.x, GROUND_Y - d.y, d.w, d.h, d.mat)));
  const bugs = l.bugs.map((d) => {
    const b = world.add(makeCircle(d.x, GROUND_Y - d.y, d.r, 'bug'));
    b.invI = 0; // beetles slide, they don't roll
    if (d.boss) { b.hp *= BOSS_HP; b.tag = 'boss'; }
    return b;
  });
  // forts start asleep: rock solid until something hits them
  for (const b of [...blocks, ...bugs]) b.asleep = true;
  return { world, ground, blocks, bugs, islands, balloons };
}

/** Lets a hanging island fall: it gets its mass back. */
export function dropIsland(b: Body) {
  if (b.invM > 0) return;
  b.invM = 1 / b.m;
  b.invI = 12 / (b.m * (4 * b.hw * b.hw + 4 * b.hh * b.hh));
  b.asleep = false;
}
