import { describe, expect, it } from 'vitest';
import { seeded } from '../types';
import { COMBO_WINDOW, N, fresh, ghostPace, ghostScore, speed, step, upgrade, type State } from './logic';

const base = (over: Partial<State> = {}): State => ({ ...fresh('classic', seeded(1)), seed: [0, 0], ...over });

describe('conga logic', () => {
  it('moves, eats and grows', () => {
    const s = base({ seed: [8, 7] });
    const r = step(s, [1, 0], seeded(2));
    expect(r.dead).toBe(false);
    expect(r.ate).toBe(true);
    expect(r.state.body).toHaveLength(4);
    expect(r.state.score).toBe(1);
  });

  it('dies on the wall in classic, wraps in wrap mode', () => {
    const edge = base({ body: [[N - 1, 3], [N - 2, 3], [N - 3, 3]] });
    expect(step(edge, [1, 0]).dead).toBe(true);
    const r = step({ ...edge, mode: 'wrap' }, [1, 0]);
    expect(r.dead).toBe(false);
    expect(r.state.body[0]).toEqual([0, 3]);
  });

  it('bumping the line kills, unless ghost-through is running', () => {
    const body: State['body'] = [[5, 5], [6, 5], [6, 6], [5, 6], [4, 6], [4, 5]];
    const s = base({ body, dir: [0, 1] });
    expect(step(s, [0, 1]).dead).toBe(true);
    const phased = step({ ...s, active: { kind: 'phase', until: 99 } }, [0, 1]);
    expect(phased.dead).toBe(false);
  });

  it('double seeds and combos add bonus points', () => {
    const s = base({ seed: [8, 7], active: { kind: 'double', until: 50 } });
    expect(step(s, [1, 0], seeded(3)).gained).toBe(2);
    const c = base({ seed: [8, 7], combo: 2, lastEat: 0, tick: 5 });
    const r = step(c, [1, 0], seeded(3));
    expect(r.state.combo).toBe(3);
    expect(r.gained).toBe(2);
    const late = step({ ...c, tick: COMBO_WINDOW + 5 }, [1, 0], seeded(3));
    expect(late.state.combo).toBe(1);
  });

  it('power seeds are picked up, run out, and slow-mo slows', () => {
    const s = base({ power: { at: [8, 7], kind: 'slow', until: 30 } });
    const r = step(s, [1, 0]);
    expect(r.powered).toBe('slow');
    expect(r.state.power).toBeNull();
    expect(speed(r.state)).toBeGreaterThan(speed(s));
    let t = r.state;
    for (let i = 0; i < 60 && t.active; i++) t = step({ ...t, body: [[7, 7], [6, 7], [5, 7]] }, [1, 0]).state;
    expect(t.active).toBeNull();
    const gone = step(base({ power: { at: [0, 14], kind: 'double', until: 1 } }), [1, 0]);
    expect(gone.state.power).toBeNull();
  });

  it('power seeds appear after eating', () => {
    let spawned = 0;
    for (let k = 0; k < 40; k++) if (step(base({ seed: [8, 7] }), [1, 0], seeded(k)).state.power) spawned++;
    expect(spawned).toBeGreaterThan(3);
    expect(spawned).toBeLessThan(30);
  });

  it('upgrades old saves and calibrates ghosts', () => {
    expect(upgrade({ body: [[1, 1]], dir: [1, 0], seed: [2, 2], score: 3 }).mode).toBe('classic');
    expect(ghostScore(0.2)).toBeLessThan(13);
    expect(ghostScore(0.95)).toBeGreaterThan(50);
    expect(ghostPace(10, 1000)).toBe(10);
    expect(ghostPace(10, 32)).toBe(2);
  });
});
