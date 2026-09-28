/** An automated player, for tests and balance: builds on the spots that see
 *  the most road, mixes the four towers, upgrades, picks specs that fit the
 *  map, parks the hero on the busiest stretch and pops the ability on packs. */
import {
  BUGS, DT, KINDS, MAPS, TOWERS, build, buildCost, callWave, canCall, coverage, snapToPath, specialize, step,
  towerAt, upgrade, upgradeCost, heroSpecial, moveHero, ABILITY_R, type Kind, type State,
} from './logic';

const orderCache = new Map<number, number[]>();
/** Build spots, best first (most road within a typical range). */
export function order(map: number): number[] {
  let o = orderCache.get(map);
  if (!o) {
    const sp = MAPS[map].spots;
    o = sp.map((_, i) => i).sort((a, b) => coverage(map, sp[b][0], sp[b][1], 2.8) - coverage(map, sp[a][0], sp[a][1], 2.8));
    orderCache.set(map, o);
  }
  return o;
}

const MIX: Kind[] = ['pecker', 'mortar', 'frost', 'sniper', 'pecker', 'mortar', 'sniper', 'pecker', 'frost', 'mortar', 'sniper', 'pecker', 'mortar', 'sniper', 'pecker', 'frost', 'sniper'];

function specFor(s: State, k: Kind): 0 | 1 {
  const flyers = MAPS[s.map].waves.some((w) => w.some(([b]) => BUGS[b].fly));
  if (k === 'pecker') return flyers ? 1 : 0;
  if (k === 'mortar') return 0;
  if (k === 'sniper') return 1;
  return 1;
}

/** One decision tick: spend, place the hero, use the ability, call waves. */
export function think(s: State, opts: { early?: boolean } = {}) {
  const spots = order(s.map);
  const want = Math.min(spots.length, 3 + s.wave * 2);
  for (let tries = 0; tries < 4; tries++) {
    const built = s.towers.length;
    const kind = MIX[built % MIX.length];
    const spot = spots.find((i) => !towerAt(s, i));
    if (built < want && spot !== undefined) {
      if (build(s, spot, kind)) continue;
      if (built < 3) break; // save up for the opening
    }
    const t = [...s.towers].sort((a, b) => a.level - b.level || a.spent - b.spent)[0];
    if (!t || t.level >= 4) {
      if (spot !== undefined && build(s, spot, kind)) continue;
      break;
    }
    const c = upgradeCost(t);
    if (c !== null ? upgrade(s, t.spot) : specialize(s, t.spot, specFor(s, t.kind))) continue;
    if (spot !== undefined && built < spots.length && s.coins >= buildCost(kind) + 40 && build(s, spot, kind)) continue;
    break;
  }
  // hero: stand on the road by the best spot
  const [hx, hy] = snapToPath(s.map, ...MAPS[s.map].spots[spots[0]]);
  if (Math.hypot(s.hero.tx - hx, s.hero.ty - hy) > 0.1) moveHero(s, hx, hy);
  const h = s.hero;
  const near = s.bugs.filter((b) => Math.hypot(b.x - h.x, b.y - h.y) <= ABILITY_R);
  if (near.length >= 3 || near.some((b) => BUGS[b.kind].boss)) heroSpecial(s);
  if (canCall(s) && (s.wave === 0 || (opts.early && s.bugs.length < 4))) callWave(s);
}

/** Play a whole map to the end. */
export function autoplay(s: State, opts: { early?: boolean } = {}): State {
  let t = 0;
  while (!s.over && t < 60 * 60 * 30) {
    if (t % 30 === 0) think(s, opts);
    step(s);
    s.events.length = 0;
    t++;
  }
  return s;
}
export { KINDS, TOWERS, DT };
