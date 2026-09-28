/** Pure Conga rules: a grid, a line, seeds, power seeds and combos. */

export const N = 15;
export type P = [number, number];
export type Mode = 'classic' | 'wrap';
export type Power = 'slow' | 'phase' | 'double';
export const POWERS: Power[] = ['slow', 'phase', 'double'];
/** Ticks a picked-up power lasts, and how long a power seed waits on the board. */
export const POWER_TICKS = 45;
export const POWER_LIFE = 70;
/** Seeds eaten within this many ticks of each other build a combo. */
export const COMBO_WINDOW = 22;
/** Chance a power seed appears after a regular seed is eaten. */
export const POWER_CHANCE = 0.3;

export interface State {
  body: P[];
  dir: P;
  seed: P;
  score: number;
  mode: Mode;
  tick: number;
  /** A power seed waiting on the board. */
  power: { at: P; kind: Power; until: number } | null;
  /** The power currently running. */
  active: { kind: Power; until: number } | null;
  combo: number;
  lastEat: number;
}

export interface StepResult {
  state: State;
  dead: boolean;
  ate: boolean;
  gained: number;
  powered: Power | null;
}

export const same = (a: P, b: P) => a[0] === b[0] && a[1] === b[1];

export function freeCell(body: P[], rand: () => number = Math.random, avoid: P[] = []): P {
  for (let k = 0; k < 500; k++) {
    const c: P = [Math.floor(rand() * N), Math.floor(rand() * N)];
    if (!body.some((b) => same(b, c)) && !avoid.some((b) => same(b, c))) return c;
  }
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) {
    const c: P = [x, y];
    if (!body.some((b) => same(b, c)) && !avoid.some((b) => same(b, c))) return c;
  }
  return [0, 0];
}

export function fresh(mode: Mode = 'classic', rand: () => number = Math.random): State {
  const body: P[] = [[7, 7], [6, 7], [5, 7]];
  return { body, dir: [1, 0], seed: freeCell(body, rand), score: 0, mode, tick: 0, power: null, active: null, combo: 0, lastEat: -999 };
}

/** Fill in fields an older save didn't have. */
export function upgrade(s: Partial<State> & Pick<State, 'body' | 'dir' | 'seed' | 'score'>): State {
  return { mode: 'classic', tick: 0, power: null, active: null, combo: 0, lastEat: -999, ...s };
}

export const hasPower = (s: State, k: Power) => s.active?.kind === k && s.tick < s.active.until;

/** Milliseconds per move: speeds up as the line grows; slow-mo stretches it. */
export function speed(s: State): number {
  const base = Math.max(80, 190 - s.score * 2.5 - (s.mode === 'wrap' ? 12 : 0));
  return hasPower(s, 'slow') ? Math.round(base * 1.7) : base;
}

export function step(s: State, dir: P, rand: () => number = Math.random): StepResult {
  const tick = s.tick + 1;
  let head: P = [s.body[0][0] + dir[0], s.body[0][1] + dir[1]];
  if (s.mode === 'wrap') head = [(head[0] + N) % N, (head[1] + N) % N];
  const wall = head[0] < 0 || head[1] < 0 || head[0] >= N || head[1] >= N;
  const self = s.body.slice(0, -1).some((b) => same(b, head));
  if (wall || (self && !hasPower(s, 'phase'))) {
    return { state: { ...s, tick }, dead: true, ate: false, gained: 0, powered: null };
  }
  const ate = same(head, s.seed);
  const body = [head, ...(ate ? s.body : s.body.slice(0, -1))];
  let { power, active, combo, lastEat, score, seed } = s;
  if (active && tick >= active.until) active = null;
  if (power && tick >= power.until) power = null;
  let powered: Power | null = null;
  if (power && same(head, power.at)) {
    powered = power.kind;
    active = { kind: power.kind, until: tick + POWER_TICKS };
    power = null;
  }
  let gained = 0;
  if (ate) {
    combo = tick - lastEat <= COMBO_WINDOW ? combo + 1 : 1;
    lastEat = tick;
    gained = (active?.kind === 'double' ? 2 : 1) + (combo >= 3 ? 1 : 0);
    score += gained;
    seed = freeCell(body, rand, power ? [power.at] : []);
    if (!power && !active && rand() < POWER_CHANCE) {
      const kind = POWERS[Math.floor(rand() * POWERS.length)];
      power = { at: freeCell(body, rand, [seed]), kind, until: tick + POWER_LIFE };
    }
  } else if (tick - lastEat > COMBO_WINDOW) combo = 0;
  return { state: { ...s, body, dir, seed, score, tick, power, active, combo, lastEat }, dead: false, ate, gained, powered };
}

/** A ghost of this strength finishes on this many points. */
export const ghostScore = (strength: number) => Math.round(4 + 58 * Math.pow(strength, 1.3));
/** Where a ghost is at this tick of your run (about one seed per 16 moves). */
export const ghostPace = (target: number, tick: number) => Math.min(target, Math.floor(tick / 16));
