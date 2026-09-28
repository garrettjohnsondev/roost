/** An automated player for checking the levels: a beam search over launch
 *  angle, pull and when to tap for the bird's trick. It proves each level is
 *  winnable (and records the winning shots so tests can replay them) and
 *  measures how many birds a good player needs. Pure: no DOM. */
import { MAX_SPEED, Sim } from './game';
import { LEVELS } from './levels';

import type { Shot } from './solutions';
export type { Shot };

export function fire(sim: Sim, s: Shot) {
  const v = s.p * MAX_SPEED, r = (s.a * Math.PI) / 180;
  sim.launch(Math.cos(r) * v, -Math.sin(r) * v);
  for (let n = 0; sim.phase === 'flying' && n < 120 * 14; n++) {
    if (s.t && !sim.abilityUsed && sim.shotT >= s.t) sim.ability();
    sim.step();
    sim.events.length = 0;
    sim.particles.length = 0;
    sim.popups.length = 0;
  }
}

/** Plays a level's shots from the start. */
export function replay(index: number, shots: Shot[]): Sim {
  const sim = new Sim(index);
  sim.skipIntro();
  for (const s of shots) {
    if (sim.phase !== 'aim') break;
    fire(sim, s);
  }
  return sim;
}

/** How close a state is to a win: dead bugs, plus partial credit for hurt ones. */
export function progress(sim: Sim): number {
  let v = 0;
  for (const b of sim.bugs) {
    const w = b.tag === 'boss' ? 3 : 1;
    v += b.dead ? w : w * 0.6 * Math.min(1, b.dmg / b.hp);
  }
  return v + sim.score * 1e-7;
}

export interface Solve { shots: Shot[]; score: number; birds: number; given: number; firstGood: number }

export function grid(bird: string, fine = false): Shot[] {
  const out: Shot[] = [];
  const angles: number[] = [];
  for (let a = -6; a <= 72; a += fine ? 2 : 3) angles.push(a);
  const pulls = fine ? [1, 0.93, 0.86, 0.79, 0.72, 0.65, 0.58, 0.5] : [1, 0.9, 0.8, 0.7, 0.6, 0.5];
  const taps = bird === 'rue' ? [0] : bird === 'tuck' ? [0, 0.6, 1.0] : [0, 0.35, 0.6, 0.85, 1.1];
  for (const a of angles) for (const p of pulls) for (const t of taps) out.push({ a, p, t });
  return out;
}

/** Beam search: at each bird, try every shot from the best few states. */
export function solve(index: number, beam = 3, fine = false): Solve | null {
  const level = LEVELS[index];
  const root = new Sim(index);
  root.skipIntro();
  let states: { sim: Sim; shots: Shot[] }[] = [{ sim: root, shots: [] }];
  let firstGood = 0;
  const start = root.bugsLeft;
  for (let depth = 1; depth <= level.birds.length; depth++) {
    const next: { sim: Sim; shots: Shot[]; v: number }[] = [];
    let best: { sim: Sim; shots: Shot[] } | null = null;
    for (const st of states) {
      const cands = grid(st.sim.current ?? 'rue', fine);
      for (const shot of cands) {
        const c = st.sim.clone();
        fire(c, shot);
        if (depth === 1 && c.bugsLeft < start) firstGood++;
        if (c.phase === 'won') {
          if (!best || c.score > best.sim.score) best = { sim: c, shots: [...st.shots, shot] };
          continue;
        }
        if (c.phase !== 'aim') continue;
        next.push({ sim: c, shots: [...st.shots, shot], v: progress(c) });
      }
      if (depth === 1) firstGood /= cands.length;
    }
    if (best) return { shots: best.shots, score: best.sim.score, birds: depth, given: level.birds.length, firstGood };
    next.sort((p, q) => q.v - p.v);
    const keep: typeof next = [];
    for (const n of next) {
      if (keep.some((k) => Math.abs(k.v - n.v) < 1e-9)) continue;
      keep.push(n);
      if (keep.length >= beam) break;
    }
    states = keep;
    if (!states.length) break;
  }
  return null;
}
