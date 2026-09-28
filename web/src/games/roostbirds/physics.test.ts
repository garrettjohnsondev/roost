import { describe, expect, it } from 'vitest';
import { makeBox, makeCircle, World } from './physics';
import { LEVELS, spawnLevel, starsFor, levelValue } from './levels';
import { MAX_SPEED, Sim } from './game';

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
  it('has at least 12 levels, each with a bug and a bird', () => {
    expect(LEVELS.length).toBeGreaterThanOrEqual(12);
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

  it('a good shot clears fort 1, scores, and a miss moves to the next bird', () => {
    const s = new Sim(0);
    s.skipIntro();
    const a = (5 * Math.PI) / 180;
    s.launch(Math.cos(a) * MAX_SPEED, -Math.sin(a) * MAX_SPEED);
    for (let i = 0; i < 120 * 15 && s.phase === 'flying'; i++) s.step();
    expect(s.phase).toBe('won');
    expect(s.stars).toBeGreaterThanOrEqual(1);

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
