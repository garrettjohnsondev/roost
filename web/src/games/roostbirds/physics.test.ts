import { describe, expect, it } from 'vitest';
import { makeBox, makeCircle, World } from './physics';
import { LEVELS, spawnLevel, starsFor, levelValue, WORLDS } from './levels';
import { Sim } from './game';
import { SOLUTIONS } from './solutions';
import { replay } from './solver';

const DT = 1 / 120;
function run(w: World, secs: number) { for (let i = 0; i < secs / DT; i++) w.step(DT); }
function withGround() {
  const w = new World();
  w.add(makeBox(0, 100, 4000, 200, 'ground', 0, true)); // top at y=0
  return w;
}

describe('physics', () => {
  it('a box falls and rests on the ground', () => {
    const w = withGround();
    const b = w.add(makeBox(0, -100, 20, 20, 'wood'));
    run(w, 3);
    expect(b.y).toBeGreaterThan(-11);
    expect(b.y).toBeLessThan(-9);
    expect(Math.abs(b.vy)).toBeLessThan(1);
    expect(Math.abs(b.a)).toBeLessThan(0.01);
  });

  it('a circle lands on a box and a thrown one bounces off a wall', () => {
    const w = withGround();
    w.add(makeBox(0, -20, 40, 40, 'stone'));
    const ball = w.add(makeCircle(0, -150, 10, 'bird'));
    run(w, 3);
    expect(ball.y).toBeLessThan(-48);
    expect(ball.y).toBeGreaterThan(-52);

    const w2 = withGround();
    const wall = w2.add(makeBox(100, -30, 20, 60, 'stone'));
    const shot = w2.add(makeCircle(0, -30, 10, 'bird'));
    shot.vx = 300;
    run(w2, 1);
    expect(shot.x).toBeLessThan(wall.x - 19);
  });

  it('a stack of 3 stays standing for 5 seconds', () => {
    const w = withGround();
    const s = [0, 1, 2].map((i) => w.add(makeBox(0, -10 - i * 20, 20, 20, 'wood')));
    run(w, 5);
    s.forEach((b, i) => {
      expect(Math.abs(b.x)).toBeLessThan(1);
      expect(Math.abs(b.y - (-10 - i * 20))).toBeLessThan(1.5);
      expect(Math.abs(b.a)).toBeLessThan(0.02);
    });
  });

  it('explosions shove and hurt things', () => {
    const w = withGround();
    const b = w.add(makeBox(30, -10, 20, 20, 'wood'));
    run(w, 1);
    w.explode(0, -5, 80, 400, 100);
    expect(b.vx).toBeGreaterThan(0);
    expect(b.dmg).toBeGreaterThan(0);
  });
});

describe('levels', () => {
  it('three worlds of fifteen, each ending in its one boss', () => {
    expect(LEVELS.length).toBe(45);
    for (let w = 0; w < WORLDS.length; w++) {
      const ls = LEVELS.filter((l) => l.world === w);
      expect(ls.length).toBe(15);
      expect(ls.map((l) => l.num)).toEqual(Array.from({ length: 15 }, (_, k) => k + 1));
      expect(ls[14].boss).toBeTruthy();
      expect(ls[14].bugs.some((b) => b.boss)).toBe(true);
      expect(ls.slice(0, 14).some((l) => l.boss || l.bugs.some((b) => b.boss))).toBe(false);
      // the world's new bird shows up in its first three forts
      expect(ls.slice(0, 3).some((l) => l.birds.includes(WORLDS[w].newBird))).toBe(true);
    }
    // the cloud floats: every sky fort has balloons
    expect(LEVELS.filter((l) => l.world === 2).every((l) => l.islands.length > 0)).toBe(true);
    for (const l of LEVELS) {
      expect(l.bugs.length).toBeGreaterThan(0);
      expect(l.birds.length).toBeGreaterThan(0);
    }
  });

  it('every fort stands on its own for 4 seconds, even fully awake', () => {
    for (const l of LEVELS) {
      const { world, blocks, bugs } = spawnLevel(l);
      world.wakeAll();
      const start = [...blocks, ...bugs].map((b) => [b.x, b.y]);
      run(world, 4);
      [...blocks, ...bugs].forEach((b, i) => {
        const d = `${l.name}: ${b.mat} at ${start[i][0]},${start[i][1]} -> ${b.x.toFixed(1)},${b.y.toFixed(1)} a=${b.a.toFixed(2)}`;
        expect(Math.abs(b.x - start[i][0]) + Math.abs(b.y - start[i][1]), d).toBeLessThan(3);
        expect(Math.abs(b.a), d).toBeLessThan(0.05);
        expect(b.dmg, d).toBe(0);
      });
    }
  });

  it("every level is winnable: the solver's recorded shots win it with the birds you get", () => {
    expect(SOLUTIONS.length).toBe(LEVELS.length);
    LEVELS.forEach((l, i) => {
      const sol = SOLUTIONS[i];
      expect(sol.shots.length, l.name).toBe(sol.birds);
      expect(sol.birds, l.name).toBeLessThanOrEqual(l.birds.length);
      const s = replay(i, sol.shots);
      expect(s.phase, l.name).toBe('won');
      expect(s.score, l.name).toBe(sol.score);
    });
  });

  it('difficulty rises: fort 1 is a one-bird clear with birds to spare, later worlds need more', () => {
    expect(SOLUTIONS[0].birds).toBe(1);
    expect(LEVELS[0].birds.length - SOLUTIONS[0].birds).toBeGreaterThanOrEqual(2);
    const need = (w: number) => LEVELS.map((l, i) => (l.world === w ? SOLUTIONS[i].birds : 0)).reduce((a, b) => a + b, 0);
    expect(need(1)).toBeGreaterThan(need(0));
    expect(need(2)).toBeGreaterThan(need(1));
    // the last world's late forts leave at most two birds to spare
    LEVELS.forEach((l, i) => {
      if (l.world === 2 && l.num >= 10) expect(l.birds.length - SOLUTIONS[i].birds, l.name).toBeLessThanOrEqual(2);
    });
  });

  it('a miss moves on to the next bird', () => {
    const miss = new Sim(0);
    miss.skipIntro();
    miss.launch(-200, -100); // backwards, off the map
    for (let i = 0; i < 120 * 15 && miss.phase === 'flying'; i++) miss.step();
    expect(miss.phase).toBe('aim');
    expect(miss.queue.length).toBe(1);
  });

  it('stars rise with score', () => {
    const l = LEVELS[0];
    const { bugs, blocks } = levelValue(l);
    expect(starsFor(l, bugs - 1)).toBe(0);
    expect(starsFor(l, bugs)).toBe(1);
    expect(starsFor(l, bugs + blocks + 20000)).toBe(3);
  });
});
