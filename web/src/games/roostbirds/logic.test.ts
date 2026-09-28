import { describe, expect, it } from 'vitest';
import { collapseTicks, knocked, levelGhost, levelOpen, normalizeSave, SLOWMO_SECS, timeScale, worldLevels, worldOpen, worldStars } from './logic';
import { LEVELS, levelValue, WORLDS } from './levels';
import { SOLUTIONS } from './solutions';
import { Sim } from './game';
import { replay } from './solver';

const runUntil = (s: Sim, secs: number, stop: () => boolean = () => false) => {
  for (let i = 0; i < secs * 120 && !stop(); i++) s.step();
};
const byName = (n: string) => LEVELS.findIndex((l) => l.name === n);

describe('ghosts, one per level', () => {
  it('get stronger through each world, the strongest on the boss, Nell on the last', () => {
    for (let w = 0; w < WORLDS.length; w++) {
      const gs = worldLevels(w).map(levelGhost);
      for (let k = 1; k < gs.length; k++) expect(gs[k].strength).toBeGreaterThanOrEqual(gs[k - 1].strength);
      expect(gs[14].strength).toBe(Math.max(...gs.map((g) => g.strength)));
    }
    expect(levelGhost(0).name).toBe('Moss');
    expect(levelGhost(LEVELS.length - 1).name).toBe('Nell');
  });

  it('targets rise world to world and are beatable (under the solver best, over a clear)', () => {
    const avg = WORLDS.map((_, w) => {
      // how much of the level's best score the ghost demands
      const ts = worldLevels(w).map((i) => levelGhost(i).target / SOLUTIONS[i].score);
      return ts.reduce((a, b) => a + b, 0) / ts.length;
    });
    // and in raw points the boss ghosts climb world to world
    const boss = WORLDS.map((_, w) => levelGhost(worldLevels(w)[14]).target);
    expect(boss[2]).toBeGreaterThan(boss[0]);
    expect(avg[1]).toBeGreaterThan(avg[0]);
    expect(avg[2]).toBeGreaterThan(avg[1]);
    LEVELS.forEach((l, i) => {
      const g = levelGhost(i);
      expect(g.target, l.name).toBeGreaterThanOrEqual(levelValue(l).bugs);
      expect(g.target, l.name).toBeLessThan(SOLUTIONS[i].score);
    });
    // each boss's ghost posts the top score of its world
    for (let w = 0; w < WORLDS.length; w++) {
      const ts = worldLevels(w).map((i) => levelGhost(i).target);
      expect(ts[14]).toBe(Math.max(...ts));
    }
  });
});

describe('worlds and saves', () => {
  it('an old fort save starts over with a note; a fresh one has no note', () => {
    const old = normalizeSave({ stars: [3, 2, 1], unlocked: 4 });
    expect(old.note).toBe(true);
    expect(old.stars.every((s) => s === 0)).toBe(true);
    expect(old.stars.length).toBe(45);
    expect(normalizeSave(null).note).toBe(false);
    const again = normalizeSave({ ...old, note: false, stars: old.stars.map((_, i) => (i === 0 ? 3 : 0)) });
    expect(again.stars[0]).toBe(3);
    expect(again.note).toBe(false);
  });

  it('levels open in order; the next world opens at its star threshold', () => {
    const s = normalizeSave(null);
    expect(levelOpen(s, 0)).toBe(true);
    expect(levelOpen(s, 1)).toBe(false);
    expect(worldOpen(s, 1)).toBe(false);
    for (const i of worldLevels(0)) s.stars[i] = 2; // 30 stars
    expect(worldStars(s, 0)).toBe(30);
    expect(worldOpen(s, 1)).toBe(true);
    expect(levelOpen(s, worldLevels(1)[0])).toBe(true);
    expect(worldOpen(s, 2)).toBe(false);
    s.stars[worldLevels(0)[3]] = 1;
    expect(worldOpen(s, 1)).toBe(false);
  });
});

describe('collapse haptics', () => {
  it('scales with what fell, capped at 12', () => {
    expect(collapseTicks(0, 0)).toBe(0);
    expect(collapseTicks(1, 0)).toBe(1);
    expect(collapseTicks(3, 5)).toBe(6);
    expect(collapseTicks(40, 40)).toBe(12);
    expect(knocked({ x: 0, y: 0, a: 0 }, { x: 1, y: 1, a: 0.05 })).toBe(false);
    expect(knocked({ x: 0, y: 0, a: 0 }, { x: 0, y: 0, a: 0.6 })).toBe(true);
  });
});

describe('slow motion', () => {
  it('slows then eases back', () => {
    expect(timeScale(0)).toBe(1);
    expect(timeScale(SLOWMO_SECS)).toBeLessThan(0.5);
    expect(timeScale(0.05)).toBeGreaterThan(timeScale(SLOWMO_SECS));
  });
});

describe('mechanics', () => {
  it('TNT goes off when it breaks and hurts its neighbours', () => {
    const s = new Sim(byName('Hot path'));
    s.skipIntro();
    const tnt = s.blocks.find((b) => b.mat === 'tnt')!;
    const bugsBefore = s.bugsLeft;
    tnt.dmg = tnt.hp + 1;
    s.world.wakeAll();
    const seen: string[] = [];
    runUntil(s, 1.5, () => { seen.push(...s.events.splice(0)); return false; });
    expect(seen).toContain('boom');
    expect(s.bugsLeft).toBeLessThan(bugsBefore);
  });

  it('Bly boomerangs: a tap turns it back toward the sling', () => {
    const s = new Sim(byName('Revert'));
    s.skipIntro();
    expect(s.current).toBe('bly');
    s.launch(500, -420);
    runUntil(s, 0.3);
    const b = s.flyers[0];
    expect(b.vx).toBeGreaterThan(0);
    expect(s.ability()).toBe(true);
    runUntil(s, 0.6);
    expect(b.vx).toBeLessThan(0);
  });

  it('Tuck hops on a tap', () => {
    const s = new Sim(byName('Bounce rate'));
    s.skipIntro();
    expect(s.current).toBe('tuck');
    s.launch(200, -300);
    runUntil(s, 0.2);
    expect(s.ability()).toBe(true);
    expect(s.flyers[0].vy).toBeLessThan(-400);
  });

  it('popping every balloon drops the island and its fort', () => {
    const i = byName('First upload');
    const s = replay(i, SOLUTIONS[i].shots);
    expect(s.phase).toBe('won');
    expect(s.balloons.every((q) => q.dead)).toBe(true);
    expect(s.islands[0].invM).toBeGreaterThan(0);
    // an island still on its balloons hangs dead still
    const h = new Sim(i);
    h.skipIntro();
    const y = h.islands[0].y;
    runUntil(h, 2);
    expect(h.islands[0].y).toBe(y);
  });

  it('a blast pops balloons in reach', () => {
    const s = new Sim(byName('Region failover'));
    s.skipIntro();
    const tnt = s.blocks.find((b) => b.mat === 'tnt')!;
    tnt.dmg = tnt.hp + 1;
    s.world.wakeAll();
    runUntil(s, 0.2);
    expect(s.balloons.some((q) => q.dead)).toBe(true);
  });

  it('a boss takes several bug-hits of damage and has a name', () => {
    for (let w = 0; w < WORLDS.length; w++) {
      const s = new Sim(worldLevels(w)[14]);
      const boss = s.bugs.find((b) => b.tag === 'boss')!;
      const bug = s.bugs.find((b) => b.tag !== 'boss')!;
      expect(boss.hp).toBeGreaterThanOrEqual(bug.hp * 4);
      expect(s.level.boss).toBe(WORLDS[w].boss);
    }
  });

  it('a clone plays out exactly like the original', () => {
    const i = byName('Two temples');
    const a = new Sim(i); a.skipIntro();
    const b = a.clone();
    for (const s of [a, b]) { s.launch(700, -300); runUntil(s, 12, () => s.phase !== 'flying'); }
    expect(b.score).toBe(a.score);
    expect(b.bugsLeft).toBe(a.bugsLeft);
  });
});
