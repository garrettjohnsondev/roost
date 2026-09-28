import { describe, expect, it } from 'vitest';
import { autoplay, order } from './bot';
import {
  ABILITY_CD, BUGS, DT, H, HERO_REACH, MAPS, START_LIVES, SELL_BACK, TOWERS, W, WAVE_GAP,
  addBug, build, buildCost, callWave, canCall, distToPath, earlyBonus, geo, ghostTarget, heroSpecial, hurt, moveHero,
  newState, posAt, preview, revive, sell, sellValue, specialize, stars, stats, step, targets, totalWaves, towerAt, upgrade, upgradeCost,
  type State,
} from './logic';

const run = (s: State, secs: number) => { for (let i = 0; i < secs / DT && !s.over; i++) step(s); };
/** Park the hero far from the road so it doesn't interfere. */
const benchHero = (s: State) => { s.hero.x = s.hero.tx = 0.5; s.hero.y = s.hero.ty = H - 0.3; s.hero.dead = 999; };

describe('maps', () => {
  it('has six maps that each unlock a new theme, with a boss on every third', () => {
    expect(MAPS.length).toBe(6);
    expect(new Set(MAPS.map((m) => m.theme)).size).toBe(6);
    MAPS.forEach((m, i) => {
      const boss = m.waves.some((w) => w.some(([k]) => BUGS[k].boss));
      expect(boss).toBe((i + 1) % 3 === 0);
    });
  });
  it('keeps build spots off the road, on the board, apart, and near enough to matter', () => {
    MAPS.forEach((m, i) => {
      m.spots.forEach(([x, y], j) => {
        expect(distToPath(i, x, y)).toBeGreaterThan(1.1);
        expect(distToPath(i, x, y)).toBeLessThan(3.3);
        expect(x > 0.7 && x < W - 0.7 && y > 0.8 && y < H - 0.4).toBe(true);
        m.spots.forEach(([a, b], k) => { if (k !== j) expect(Math.hypot(a - x, b - y)).toBeGreaterThan(1.5); });
      });
      expect(distToPath(i, ...m.hero)).toBeLessThan(0.05);
    });
  });
});

describe('path following', () => {
  it('walks bugs along the polyline at their speed and costs lives at the end', () => {
    const s = newState(0); benchHero(s);
    const b = addBug(s, 'mite');
    run(s, 2);
    expect(b.d).toBeCloseTo(2 * BUGS.mite.speed, 1);
    const g = geo(0, 0);
    const [x, y] = posAt(g, b.d);
    expect(b.x).toBeCloseTo(x, 3); expect(b.y).toBeCloseTo(y, 3);
    // turns the first corner (8,4) -> down
    b.d = 9.5; run(s, DT);
    expect(b.x).toBeCloseTo(8, 1); expect(b.y).toBeGreaterThan(4);
    b.d = g.len - 0.01; run(s, 0.1);
    expect(s.bugs.length).toBe(0);
    expect(s.lives).toBe(START_LIVES - BUGS.mite.lives);
  });
  it('sends each group down its own road on two-road maps', () => {
    const s = newState(1); benchHero(s);
    callWave(s); run(s, 4);
    expect(new Set(s.bugs.map((b) => b.path))).toEqual(new Set([0, 1]));
  });
});

describe('towers', () => {
  it('builds for the price, upgrades 3 levels, then branches into one of two specs', () => {
    const s = newState(0); s.coins = 5000;
    expect(build(s, 0, 'sniper')).toBe(true);
    expect(s.coins).toBe(5000 - buildCost('sniper'));
    expect(build(s, 0, 'pecker')).toBe(false);
    const t = towerAt(s, 0)!;
    expect(upgrade(s, 0)).toBe(true); expect(upgrade(s, 0)).toBe(true);
    expect(t.level).toBe(3);
    expect(upgradeCost(t)).toBeNull();
    expect(upgrade(s, 0)).toBe(false);
    expect(specialize(s, 0, 1)).toBe(true);
    expect(t.level).toBe(4); expect(t.spec).toBe('piercer');
    expect(stats(t).pierce).toBe(1);
    expect(specialize(s, 0, 0)).toBe(false);
  });
  it('each of the 4 towers has 3 levels that get stronger and 2 distinct specs', () => {
    for (const d of Object.values(TOWERS)) {
      expect(d.levels.length).toBe(3);
      expect(d.levels[2].dmg * d.levels[2].rate).toBeGreaterThan(d.levels[0].dmg * d.levels[0].rate);
      expect(d.specs.length).toBe(2);
      expect(d.specs[0].id).not.toBe(d.specs[1].id);
    }
    expect(Object.keys(TOWERS).length).toBe(4);
  });
  it('sells for 70% of everything spent', () => {
    const s = newState(0); s.coins = 1000;
    build(s, 0, 'mortar'); upgrade(s, 0);
    const t = towerAt(s, 0)!;
    const spent = TOWERS.mortar.costs[0] + TOWERS.mortar.costs[1];
    expect(sellValue(t)).toBe(Math.floor(spent * SELL_BACK));
    const before = s.coins;
    expect(sell(s, 0)).toBe(true);
    expect(s.coins).toBe(before + Math.floor(spent * 0.7));
    expect(towerAt(s, 0)).toBeNull();
  });
});

describe('targeting priority', () => {
  it('peckers shoot the bug closest to the repo; snipers the toughest', () => {
    const s = newState(0);
    const a = addBug(s, 'mite', 12), b = addBug(s, 'mite', 14), boss = addBug(s, 'stag', 13);
    const [x, y] = [b.x, b.y - 1.5];
    const first = targets(s, x, y, TOWERS.pecker.levels[2], 'first');
    expect(first[0]).toBe(b);
    const strong = targets(s, x, y, TOWERS.sniper.levels[0], 'strong');
    expect(strong[0]).toBe(boss);
    expect(first).toContain(a);
  });
  it('mortars cannot hit flyers, peckers can, and the hero ignores them', () => {
    const s = newState(0);
    const g = addBug(s, 'gnat', 3);
    expect(targets(s, g.x, g.y, TOWERS.mortar.levels[2], 'first')).toHaveLength(0);
    expect(targets(s, g.x, g.y, TOWERS.pecker.levels[0], 'first')).toHaveLength(1);
    s.hero.x = s.hero.tx = g.x; s.hero.y = s.hero.ty = g.y;
    run(s, 0.5);
    expect(s.hero.engaged).toBe(-1);
  });
});

describe('damage, splash and slow', () => {
  it('armor soaks damage unless pierced', () => {
    const s = newState(0);
    const b = addBug(s, 'beetle', 3);
    const plain = hurt(s, b, 20, 0);
    const pierced = hurt(s, b, 20, 1);
    expect(plain).toBeCloseTo(20 * (1 - BUGS.beetle.armor));
    expect(pierced).toBe(20);
  });
  it('a mortar egg splashes every ground bug in the blast', () => {
    const s = newState(0); s.coins = 999; benchHero(s);
    const spot = MAPS[0].spots.findIndex(([x, y]) => x === 6 && y === 6);
    build(s, spot, 'mortar');
    const pack = [addBug(s, 'mite', 7), addBug(s, 'mite', 7.2), addBug(s, 'mite', 7.4)];
    pack.forEach((b) => { b.lane = 0; });
    const hp0 = pack.map((b) => b.hp);
    run(s, 1.8);
    expect(pack.filter((b, i) => b.hp < hp0[i] || !s.bugs.includes(b)).length).toBe(3);
  });
  it('frost slows, and bugs speed back up after', () => {
    const s = newState(0); s.coins = 999; benchHero(s);
    const spot = MAPS[0].spots.findIndex(([x, y]) => x === 6 && y === 6);
    build(s, spot, 'frost');
    const b = addBug(s, 'stag', 7.5);
    run(s, 1.2);
    expect(b.slow).toBeGreaterThan(0.3);
    const d0 = b.d; run(s, 1);
    expect(b.d - d0).toBeLessThan(BUGS.stag.speed * 0.8);
    s.towers = []; run(s, 3);
    expect(b.slow).toBe(0);
  });
});

describe('specialisations', () => {
  const at = (spec: 0 | 1, kind: 'pecker' | 'mortar' | 'sniper' | 'frost') => {
    const s = newState(0); s.coins = 9999; benchHero(s);
    const spot = MAPS[0].spots.findIndex(([x, y]) => x === 6 && y === 6);
    build(s, spot, kind); upgrade(s, spot); upgrade(s, spot); specialize(s, spot, spec);
    s.towers[0].built = 1; s.towers[0].cd = 0;
    return s;
  };
  it('Swarm pecks two bugs at once', () => {
    const s = at(0, 'pecker');
    addBug(s, 'stag', 7); addBug(s, 'stag', 7.6);
    run(s, 0.05);
    expect(new Set(s.shots.map((x) => x.target)).size).toBe(2);
  });
  it('Talon hits flyers for triple', () => {
    const s = at(1, 'pecker');
    addBug(s, 'gnat', 7);
    run(s, 0.05);
    expect(s.shots[0].dmg).toBe(TOWERS.pecker.specs[1].stats.dmg * 3);
  });
  it('Quake eggs stun the pack', () => {
    const s = at(1, 'mortar');
    const b = addBug(s, 'stag', 7); b.lane = 0;
    run(s, 1);
    expect(b.stunT).toBeGreaterThan(0);
  });
  it('Armor-piercer ignores armor; Deadeye sometimes crits', () => {
    const s = at(1, 'sniper');
    const b = addBug(s, 'stag', 7); b.hp = b.max = 100000;
    run(s, 0.05);
    expect(b.max - b.hp).toBeCloseTo(TOWERS.sniper.specs[1].stats.dmg, 0);
    const d = at(0, 'sniper');
    const c = addBug(d, 'stag', 7); c.hp = c.max = 1e7;
    let crits = 0;
    for (let i = 0; i < 40; i++) { d.towers[0].cd = 0; run(d, DT); crits += d.events.filter((e) => e.t === 'snipe' && e.crit).length; d.events.length = 0; }
    expect(crits).toBeGreaterThan(3);
    expect(crits).toBeLessThan(25);
  });
  it('Blizzard chills everything in range at once; Shatter makes chilled bugs take more', () => {
    const s = at(0, 'frost');
    const bs = [addBug(s, 'mite', 6.5), addBug(s, 'mite', 7.5), addBug(s, 'mite', 8.5)];
    run(s, 0.05);
    expect(bs.every((b) => b.slowT > 0)).toBe(true);
    const t = at(1, 'frost');
    const b = addBug(t, 'stag', 7.5); b.hp = b.max = 1e6;
    run(t, 1);
    expect(b.ampT).toBeGreaterThan(0);
    expect(hurt(t, b, 100, 1)).toBeCloseTo(150);
  });
});

describe('hero', () => {
  it('walks to where you tap, then blocks and fights a ground bug', () => {
    const s = newState(0);
    const g = geo(0, 0);
    const [tx, ty] = posAt(g, 6);
    moveHero(s, tx, ty);
    run(s, 0.5);
    expect(Math.hypot(s.hero.x - tx, s.hero.y - ty)).toBeGreaterThan(0.1);
    run(s, 6);
    expect(Math.hypot(s.hero.x - tx, s.hero.y - ty)).toBeLessThan(0.06);
    const b = addBug(s, 'beetle', 6 - HERO_REACH + 0.2); b.lane = 0;
    run(s, 0.3);
    expect(s.hero.engaged).toBe(b.id);
    const d0 = b.d; run(s, 1);
    expect(b.d).toBeCloseTo(d0, 3);
    expect(b.hp).toBeLessThan(b.max);
  });
  it('levels up from kills, and the special hits everything around on a cooldown', () => {
    const s = newState(0);
    const lv = s.hero.level;
    const [hx, hy] = [s.hero.x, s.hero.y];
    const bugs = [0, 1, 2].map(() => { const b = addBug(s, 'mite', 0); b.x = hx + 0.3; b.y = hy; return b; });
    expect(heroSpecial(s)).toBe(true);
    expect(bugs.every((b) => b.hp <= 0)).toBe(true);
    expect(s.hero.ability).toBe(ABILITY_CD);
    expect(heroSpecial(s)).toBe(false);
    for (let i = 0; i < 20; i++) { const b = addBug(s, 'mite', 0); hurt(s, b, 999, 0, '#fff', true); }
    expect(s.hero.level).toBeGreaterThan(lv);
  });
  it('dies to a boss it cannot hold and respawns later', () => {
    const s = newState(2);
    const g = geo(2, 0);
    const [x, y] = posAt(g, 10);
    s.hero.x = s.hero.tx = x; s.hero.y = s.hero.ty = y;
    const b = addBug(s, 'leak', 9.5); b.hp = b.max = 1e6;
    run(s, 12);
    expect(s.events.some((e) => e.t === 'herodown')).toBe(true);
  });
});

describe('waves and economy', () => {
  it('the first wave waits for you; later ones come on their own', () => {
    const s = newState(0);
    run(s, 30);
    expect(s.wave).toBe(0);
    expect(canCall(s)).toBe(true);
    callWave(s);
    expect(canCall(s)).toBe(false);
    run(s, 12);
    expect(s.queue.length).toBe(0);
    expect(s.nextIn).toBeGreaterThan(0);
    run(s, WAVE_GAP + 0.5);
    expect(s.wave).toBe(2);
  });
  it('pays a bonus for calling a wave early, bigger the earlier', () => {
    const s = newState(0); s.lives = 999;
    callWave(s); run(s, 12);
    const b1 = earlyBonus(s);
    expect(b1).toBeGreaterThan(0);
    run(s, 5);
    expect(earlyBonus(s)).toBeLessThan(b1);
    const c = s.coins, bonus = earlyBonus(s);
    callWave(s);
    expect(s.coins).toBe(c + bonus);
    expect(s.early).toBe(1);
  });
  it('previews what is coming and pays bounties', () => {
    expect(preview(0, 1)).toEqual([{ kind: 'mite', n: 10 }, { kind: 'moth', n: 4 }]);
    const s = newState(0);
    const b = addBug(s, 'beetle', 2);
    const c = s.coins;
    hurt(s, b, 9999, 1);
    expect(s.coins).toBe(c + BUGS.beetle.bounty);
  });
  it('the Memory Leak splits into leaklets', () => {
    const s = newState(2);
    const b = addBug(s, 'leak', 5);
    hurt(s, b, 1e6, 1);
    expect(s.bugs.filter((x) => x.kind === 'blob').length).toBe(BUGS.leak.splits);
    expect(s.bossDown).toBe(1);
  });
});

describe('stars, saves and ghosts', () => {
  it('3 stars for 18+ lives, 2 for 10+, 1 for any win', () => {
    expect(stars({ over: 'won', lives: 20 })).toBe(3);
    expect(stars({ over: 'won', lives: 18 })).toBe(3);
    expect(stars({ over: 'won', lives: 12 })).toBe(2);
    expect(stars({ over: 'won', lives: 1 })).toBe(1);
    expect(stars({ over: 'lost', lives: 20 })).toBe(0);
  });
  it('saves mid-map as JSON and picks up where it left off', () => {
    const s = newState(1); s.coins = 999;
    build(s, order(1)[0], 'pecker'); callWave(s); run(s, 7);
    const copy = revive(JSON.parse(JSON.stringify(s)))!;
    run(s, 5); run(copy, 5);
    expect(copy.bugs.length).toBe(s.bugs.length);
    expect(copy.score).toBe(s.score);
    expect(revive({ v: 1 })).toBeNull();
  });
  it('ghost targets rise with strength and with the map', () => {
    for (let m = 0; m < MAPS.length; m++) expect(ghostTarget(m, 0.2)).toBeLessThan(ghostTarget(m, 0.95));
    expect(ghostTarget(0, 0.5)).toBeLessThan(ghostTarget(5, 0.5));
  });
});

describe('the automated player', () => {
  it('3-stars map 1 and beats the weak ghost there', () => {
    const s = autoplay(newState(0));
    expect(s.over).toBe('won');
    expect(stars(s)).toBe(3);
    expect(s.score).toBeGreaterThan(ghostTarget(0, 0.2));
  });
  it('holds every map for at least one star', () => {
    for (let m = 0; m < MAPS.length; m++) {
      const s = autoplay(newState(m));
      expect(s.over, MAPS[m].name).toBe('won');
      expect(stars(s)).toBeGreaterThanOrEqual(1);
      expect(s.wave).toBe(totalWaves(m));
    }
  }, 60000);
  it('loses a map if you build nothing', () => {
    const s = newState(0);
    benchHero(s);
    callWave(s);
    while (!s.over) { if (canCall(s)) callWave(s); step(s); }
    expect(s.over).toBe('lost');
  });
});
