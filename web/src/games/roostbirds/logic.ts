/** Pure helpers for Roost Birds: per-level ghosts, worlds and saves, the
 *  collapse haptics count and the slow-mo clock. No DOM, no physics world:
 *  easy to test. */
import { GROUND_Y, LEVELS, LEVELS_PER_WORLD, levelValue, WORLDS } from './levels';
import { SOLUTIONS } from './solutions';
import { GHOSTS } from '../types';

export const GRAVITY = 600;
export const SLING_XY = { x: 110, y: GROUND_Y - 64 };
export const MAX_SPEED_V = 820;

// ---------- ghosts, one per level ----------

/** Who haunts each level, world by world: weak crew early, stronger later,
 *  the strongest on the bosses. */
const GHOST_PLAN: string[][] = [
  ['Moss', 'Moss', 'Moss', 'Tuck', 'Tuck', 'Tuck', 'Bly', 'Bly', 'Bly', 'Otto', 'Otto', 'Otto', 'Fig', 'Fig', 'Juno'],
  ['Fig', 'Fig', 'Fig', 'Wren', 'Wren', 'Wren', 'Rue', 'Rue', 'Rue', 'Rue', 'Juno', 'Juno', 'Bram', 'Bram', 'Ollie'],
  ['Wren', 'Wren', 'Rue', 'Rue', 'Rue', 'Juno', 'Juno', 'Juno', 'Bram', 'Bram', 'Bram', 'Ollie', 'Ollie', 'Ollie', 'Nell'],
];

export interface LevelGhost { name: string; sprite: string; strength: number; target: number }

/** The ghost on a level, and the score it posted there: a share of the best
 *  score the level solver found (so it's always beatable), bigger for
 *  stronger crew, never below a plain clear. */
export function levelGhost(index: number): LevelGhost {
  const l = LEVELS[index];
  const name = GHOST_PLAN[l.world][l.num - 1];
  const g = GHOSTS.find((x) => x.name === name) ?? GHOSTS[0];
  const best = SOLUTIONS[index]?.score ?? levelValue(l).bugs;
  const share = 0.55 + 0.4 * g.strength;
  const target = Math.max(levelValue(l).bugs, Math.round((best * share) / 100) * 100);
  return { name: g.name, sprite: g.sprite, strength: g.strength, target: Math.min(target, best - 100) };
}

// ---------- worlds and the save ----------

export interface Save {
  v: 2;
  /** Best stars per level (all 45). */
  stars: number[];
  /** Levels whose ghost you've beaten. */
  ghosts: boolean[];
  /** Show the one-time "the worlds are new" note. */
  note: boolean;
}

/** Reads any save. Saves from before the worlds (17 forts, no `v`) start
 *  over, with a note saying why. */
export function normalizeSave(raw: unknown): Save {
  const s = raw as Partial<Save> & { unlocked?: number } | null;
  const fresh: Save = { v: 2, stars: LEVELS.map(() => 0), ghosts: LEVELS.map(() => false), note: false };
  if (!s || typeof s !== 'object') return fresh;
  if (s.v !== 2) return { ...fresh, note: Array.isArray(s.stars) && s.stars.some((n) => Number(n) > 0) };
  return {
    v: 2,
    stars: LEVELS.map((_, i) => Math.max(0, Math.min(3, Number(s.stars?.[i]) || 0))),
    ghosts: LEVELS.map((_, i) => !!s.ghosts?.[i]),
    note: !!s.note,
  };
}

export const worldLevels = (w: number) => LEVELS.map((_, i) => i).filter((i) => LEVELS[i].world === w);
export const worldStars = (s: Save, w: number) => worldLevels(w).reduce((n, i) => n + s.stars[i], 0);
export const worldCleared = (s: Save, w: number) => worldLevels(w).every((i) => s.stars[i] > 0);
/** A world opens once the one before it has enough stars. */
export const worldOpen = (s: Save, w: number) => w === 0 || worldStars(s, w - 1) >= WORLDS[w].unlockStars;
/** Levels open in order within a world. */
export function levelOpen(s: Save, index: number): boolean {
  const l = LEVELS[index];
  if (!worldOpen(s, l.world)) return false;
  return l.num === 1 || s.stars[index - 1] > 0;
}
/** The first open level with no stars yet in a world (or its last). */
export function nextLevel(s: Save, w: number): number {
  const ls = worldLevels(w);
  return ls.find((i) => levelOpen(s, i) && s.stars[i] === 0) ?? ls[ls.length - 1];
}
export const MAX_WORLD_STARS = LEVELS_PER_WORLD * 3;

// ---------- feel ----------

/** How many haptic ticks a collapse earns: one per piece that broke or got
 *  knocked loose in the second after impact, capped at 12. */
export function collapseTicks(broken: number, moved: number): number {
  const n = Math.round(broken + moved * 0.6);
  return Math.max(0, Math.min(12, n));
}

/** Did this block move enough to count as knocked over? */
export function knocked(from: { x: number; y: number; a: number }, to: { x: number; y: number; a: number }): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) > 5 || Math.abs(to.a - from.a) > 0.25;
}

/** Slow motion after the last bug: 0.3x for a moment, easing back to 1. */
export const SLOWMO_SECS = 1.1;
export function timeScale(slowmoLeft: number): number {
  if (slowmoLeft <= 0) return 1;
  const k = slowmoLeft / SLOWMO_SECS; // 1 -> 0
  return k > 0.35 ? 0.28 : 0.28 + (1 - k / 0.35) * 0.72;
}
