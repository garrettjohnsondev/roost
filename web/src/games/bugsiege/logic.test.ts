import { describe, expect, it } from 'vitest';
import { order } from './bot';
import {
  BUGS, COLS, DT, MAPS, ROWS, START_LIVES, TOWERS, TOWER_ORDER, WAVES, WAVE_GAP,
  build, callWave, canCall, damage, geo, ghostScore, maxPoints, newState, pathTiles, posAt, revive,
  sell, sellValue, stars, step, upgrade, upgradeCost, type State, type TowerKind,
} from './logic';

const run = (s: State, secs: number) => { for (let i = 0; i < secs / DT && !s.over; i++) step(s); };

/** A decent player: builds a mix spread over the spots, upgrades, calls waves on time. */
function bot(s: State, mix: TowerKind[]) {
  const spots = MAPS[s.map].spots.length;
  let next = 0;
  while (!s.over) {
    if (canCall(s) && s.wave === 0) callWave(s);
    // spend
    for (let tries = 0; tries < 3; tries++) {
      if (next < spots && build(s, order(s.map)[next], mix[next % mix.length])) { next++; continue; }
      const t = [...s.towers].sort((a, b) => a.level - b.level)[0];
      if (t && s.towers.length >= 4 && upgrade(s, t.spot)) continue;
      if (next < spots) break;
    }
    run(s, 1);
  }
}

describe('bug siege: maps and pathing', () => {
  it('has 3 maps with 10+ waves', () => {
    expect(MAPS.length).toBe(3);
    for (const m of MAPS) { expect(m.waves).toBeGreaterThanOrEqual(10); expect(m.waves).toBeLessThanOrEqual(WAVES.length); }
  });
  it('keeps build spots off the path, on the board, unique, and clear of the bottom-left crew corner', () => {
    MAPS.forEach((m, i) => {
      const road = pathTiles(i);
      const seen = new Set<string>();
      for (const [c, r] of m.spots) {
        expect(road.has(`${c},${r}`)).toBe(false);
        expect(c >= 0 && c < COLS && r >= 0 && r < ROWS).toBe(true);
        expect(seen.has(`${c},${r}`)).toBe(false);
        seen.add(`${c},${r}`);
        expect(c <= 1 && r >= 8).toBe(false);
      }
      expect(road.has('0,8')).toBe(false);
      // every spot is within reach of the road
      for (const [c, r] of m.spots) {
        const near = [...road].some((k) => { const [x, y] = k.split(',').map(Number); return Math.hypot(x - c, y - r) <= 2.3; });
        expect(near).toBe(true);
      }
    });
  });
  it('paths are axis-aligned and walk to the repo', () => {
    const g = geo(0, 0);
    expect(g.len).toBeGreaterThan(25);
    expect(posAt(g, 0)).toEqual([-0.5, 2.5]);
    expect(posAt(g, 2)).toEqual([1.5, 2.5]);
    expect(posAt(g, g.len + 5)).toEqual([15.5, 6.5]);
    for (const m of MAPS) for (const p of m.paths) for (let i = 1; i < p.length; i++) expect(p[i][0] === p[i - 1][0] || p[i][1] === p[i - 1][1]).toBe(true);
  });
  it('bugs walk the path and leak into the repo', () => {
    const s = newState(0);
    callWave(s);
    run(s, 3);
    expect(s.bugs.length).toBeGreaterThan(0);
    const lead = s.bugs[0];
    expect(lead.d).toBeCloseTo(BUGS.moth.speed * (3 - 0), 0);
    run(s, 40);
    expect(s.leaks).toBe(6);
    expect(s.lives).toBe(START_LIVES - 6);
  });
});

describe('bug siege: damage', () => {
  it('armor blunts light hits but never below 1; pierce ignores it', () => {
    expect(damage('beetle', 4)).toBe(2);
    expect(damage('stag', 3)).toBe(1);
    expect(damage('stag', 34, true)).toBe(34);
  });
  it('a tower kills a moth in range and pays out', () => {
    const s = newState(0);
    build(s, 0, 'wren');
    const coins = s.coins;
    callWave(s);
    run(s, 12);
    expect(s.kills).toBeGreaterThan(0);
    expect(s.coins).toBeGreaterThan(coins);
    expect(s.score).toBeGreaterThan(0);
  });
  it('frost slows and fire burns', () => {
    const s = newState(0);
    build(s, 0, 'tuck');
    callWave(s);
    run(s, 4);
    expect(s.bugs.some((b) => b.slowT > 0)).toBe(true);
    const f = newState(0);
    build(f, 0, 'juno');
    callWave(f);
    run(f, 4);
    expect(f.kills + f.bugs.filter((b) => b.burnT > 0).length).toBeGreaterThan(0);
  });
  it('the Memory Leak splits when it dies', () => {
    const s = newState(0);
    s.wave = 12;
    s.bugs.push({ id: 99, kind: 'leak', path: 0, d: 5, hp: 1, max: 900, x: 4.5, y: 3.5, slowT: 0, slowF: 0, burnT: 0, burnDps: 0, flash: 0 });
    build(s, 2, 'nell');
    const ev = [];
    for (let i = 0; i < 5; i++) ev.push(...step(s));
    expect(s.bossKills).toBe(1);
    expect(ev.some((e) => e.k === 'boss')).toBe(true);
    expect(s.bugs.filter((b) => b.kind === 'blob').length).toBe(2);
  });
  it('bly chains through a pack', () => {
    const s = newState(0);
    s.wave = 1;
    for (let i = 0; i < 4; i++) s.bugs.push({ id: 50 + i, kind: 'glitch', path: 0, d: 3 + i * 0.5, hp: 500, max: 500, x: 2.5 + i * 0.5, y: 2.5, slowT: 0, slowF: 0, burnT: 0, burnDps: 0, flash: 0 });
    build(s, 0, 'bly');
    const ev = step(s);
    const chain = ev.find((e) => e.k === 'chain');
    expect(chain && chain.k === 'chain' && chain.pts.length / 2 - 1).toBe(3);
  });
});

describe('bug siege: economy and waves', () => {
  it('build, upgrade, sell', () => {
    const s = newState(0);
    expect(build(s, 0, 'moss')).toBe(true);
    expect(build(s, 0, 'wren')).toBe(false);
    expect(s.coins).toBe(MAPS[0].coins - 50);
    const t = s.towers[0];
    expect(upgradeCost(t)).toBe(40);
    expect(upgrade(s, 0)).toBe(true);
    expect(upgrade(s, 0)).toBe(true);
    expect(upgrade(s, 0)).toBe(false);
    expect(t.spent).toBe(160);
    expect(sellValue(t)).toBe(112);
    const before = s.coins;
    expect(sell(s, 0)).toBe(112);
    expect(s.coins).toBe(before + 112);
    expect(s.towers.length).toBe(0);
  });
  it('cannot afford everything', () => {
    const s = newState(0);
    s.coins = 10;
    for (const k of TOWER_ORDER) expect(build(s, 1, k)).toBe(false);
  });
  it('waits for the first call, then counts down between waves', () => {
    const s = newState(0);
    run(s, 30);
    expect(s.wave).toBe(0);
    callWave(s);
    expect(s.wave).toBe(1);
    expect(canCall(s)).toBe(false);
    run(s, 6 + WAVE_GAP + 0.5);
    expect(s.wave).toBe(2);
  });
  it('calling early pays coins and points', () => {
    const s = newState(0);
    callWave(s);
    run(s, 6);
    expect(canCall(s)).toBe(true);
    const c = s.coins, p = s.score;
    callWave(s);
    expect(s.early).toBe(1);
    expect(s.coins).toBeGreaterThan(c + 20);
    expect(s.score).toBeGreaterThan(p);
  });
  it('an empty board loses; a decent build wins main branch with stars', () => {
    const lose = newState(0);
    callWave(lose);
    run(lose, 600);
    expect(lose.over).toBe('lost');
    expect(stars(lose)).toBe(0);

    const s = newState(0);
    bot(s, ['wren', 'moss', 'bram', 'tuck', 'ollie', 'wren', 'bly', 'juno', 'nell', 'wren']);
    expect(s.over).toBe('won');
    expect(stars(s)).toBeGreaterThanOrEqual(2);
    expect(s.score).toBeGreaterThan(ghostScore(0.2));
  });
  it('harder maps are winnable by a strong build', () => {
    for (const m of [1, 2]) {
      const s = newState(m);
      bot(s, ['wren', 'moss', 'bram', 'tuck', 'ollie', 'wren', 'bly', 'juno', 'nell', 'wren']);
      expect(s.over).toBe('won');
    }
  });
  it('ghost calibration climbs with strength', () => {
    expect(ghostScore(0.2)).toBeLessThan(maxPoints(0) * 0.5);
    expect(ghostScore(0.95)).toBeGreaterThan(maxPoints(0));
    expect(ghostScore(0.95)).toBeLessThan(maxPoints(1));
  });
  it('a mid-map save survives JSON and resumes', () => {
    const s = newState(1);
    build(s, 3, 'bram');
    callWave(s);
    run(s, 5);
    const r = revive(JSON.parse(JSON.stringify(s)))!;
    expect(r.towers[0].kind).toBe('bram');
    expect(r.bugs.length).toBe(s.bugs.length);
    run(r, 1);
    expect(r.t).toBeGreaterThan(s.t);
    expect(revive({ junk: 1 })).toBeNull();
  });
  it('every tower has 3 levels that get better', () => {
    for (const d of Object.values(TOWERS)) {
      expect(d.levels.length).toBe(3);
      expect(d.levels[2].dmg).toBeGreaterThan(d.levels[0].dmg);
    }
  });
});
