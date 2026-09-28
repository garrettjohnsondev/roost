import { describe, expect, it } from 'vitest';
import { aimAt, arc, collapseTicks, ghostFortScore, ghostScore, ghostShot, knocked, SLOWMO_SECS, timeScale } from './logic';
import { GROUND_Y, LEVELS, levelValue } from './levels';
import { Sim } from './game';

const runUntil = (s: Sim, secs: number, stop: () => boolean = () => false) => {
  for (let i = 0; i < secs * 120 && !stop(); i++) s.step();
};

describe('ghosts', () => {
  it('score rises with strength, easy is modest and hard is hard', () => {
    expect(ghostScore(0.2)).toBeLessThan(ghostScore(0.55));
    expect(ghostScore(0.55)).toBeLessThan(ghostScore(0.95));
    // a clear of fort 1 with a spare bird beats Moss
    const f1 = levelValue(LEVELS[0]);
    expect(ghostScore(0.2)).toBeLessThan(f1.bugs + 10000);
    // Nell needs more than a plain clear of any fort
    for (const l of LEVELS) expect(ghostScore(0.95)).toBeGreaterThan(levelValue(l).bugs);
  });

  it('per-fort ghost score is at least a clear and grows with strength', () => {
    for (const l of LEVELS) {
      const { bugs } = levelValue(l);
      expect(ghostFortScore(l, 0.2)).toBeGreaterThanOrEqual(bugs);
      expect(ghostFortScore(l, 0.95)).toBeGreaterThan(ghostFortScore(l, 0.2));
    }
  });

  it('aimAt lands on the target', () => {
    const v = aimAt(600, GROUND_Y - 10)!;
    const pts = arc(v.vx, v.vy, 2000, 0.005);
    const near = pts.reduce((m, p) => Math.min(m, Math.hypot(p.x - 600, p.y - (GROUND_Y - 10))), Infinity);
    expect(near).toBeLessThan(4);
  });

  it("a strong ghost's shot is the same every time and ends near a bug", () => {
    const l = LEVELS[0];
    expect(ghostShot(l, 0.95)).toEqual(ghostShot(l, 0.95));
    const s = ghostShot(l, 1);
    const pts = arc(s.vx, s.vy, l.width + 60);
    const end = pts[pts.length - 1];
    expect(Math.abs(end.x - l.bugs[0].x)).toBeLessThan(60);
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

  it('a real shot reports launch, impact, then a collapse a second later', () => {
    const s = new Sim(0);
    s.skipIntro();
    const a = (5 * Math.PI) / 180;
    s.launch(Math.cos(a) * 820, -Math.sin(a) * 820);
    const seen: string[] = [];
    runUntil(s, 6, () => { seen.push(...s.events.splice(0)); return s.phase !== 'flying'; });
    seen.push(...s.events.splice(0));
    expect(seen[0]).toBe('launch');
    const impact = seen.indexOf('impact');
    const collapse = seen.findIndex((e) => e.startsWith('collapse:'));
    expect(impact).toBeGreaterThan(0);
    expect(collapse).toBeGreaterThan(impact);
    const [, broken, moved] = seen[collapse].split(':').map(Number);
    expect(broken + moved).toBeGreaterThan(0);
    expect(seen.filter((e) => e === 'impact').length).toBe(1);
  });
});

describe('slow motion', () => {
  it('slows then eases back', () => {
    expect(timeScale(0)).toBe(1);
    expect(timeScale(SLOWMO_SECS)).toBeLessThan(0.5);
    expect(timeScale(0.05)).toBeGreaterThan(timeScale(SLOWMO_SECS));
  });

  it('kicks in when the last bug goes mid-shot', () => {
    const s = new Sim(0);
    s.skipIntro();
    const a = (5 * Math.PI) / 180;
    s.launch(Math.cos(a) * 820, -Math.sin(a) * 820);
    let slowed = false;
    runUntil(s, 8, () => { if (s.slowmo > 0) slowed = true; return s.phase === 'won'; });
    expect(s.phase).toBe('won');
    expect(slowed).toBe(true);
    expect(s.tickReal(0.1)).toBeLessThan(1);
  });
});

describe('new things', () => {
  it('TNT goes off when it breaks and hurts its neighbours', () => {
    const s = new Sim(14);
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
    const s = new Sim(15);
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

  it('Tuck bounces off the ground and a tap hops it up', () => {
    const s = new Sim(14);
    s.skipIntro();
    s.launch(300, -200); // Rue first on fort 15; swap in Tuck by hand
    s.flyers[0].dead = true;
    runUntil(s, 4, () => s.phase === 'aim');
    expect(s.current).toBe('tuck');
    s.launch(200, -300);
    runUntil(s, 0.2);
    expect(s.ability()).toBe(true);
    expect(s.flyers[0].vy).toBeLessThan(-400);
  });

  it('a boss takes several bug-hits of damage', () => {
    const s = new Sim(16);
    const boss = s.bugs.find((b) => b.tag === 'boss')!;
    const bug = s.bugs.find((b) => b.tag !== 'boss')!;
    expect(boss.hp).toBeGreaterThanOrEqual(bug.hp * 4);
  });

});
