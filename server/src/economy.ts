import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './config.js';
import { CERTS, CRATES, ITEMS, ODDS, PAINTS, RARITIES, SLOTS, ghostItem, itemById, type CrateDef, type Item, type Rarity, type Slot } from './catalog.js';

/** Coins, keys, crates and the wardrobe (games wave 1). Personal and local:
 *  one player, one file, no real money anywhere. */

export interface Owned { uid: string; itemId: string; paint?: string; cert?: string; at: number; source: string }
export interface OwnedCrate { uid: string; crate: string; at: number; source: string }
export type Loadout = Partial<Record<Slot, string>>; // slot -> owned uid
export interface Challenge { day: string; gameId: string; target: number; lowerIsBetter?: boolean; text: string; host: string; done: boolean }
export interface EconomyState {
  coins: number;
  keys: number;
  crates: OwnedCrate[];
  items: Owned[];
  equipped: Record<string, Loadout>;
  stats: { jobs: number; runs: number; ghosts: number; crates: number };
  ghostsBeaten: Record<string, number>;
  freeDay: string | null;
  challenge: Challenge | null;
  log: Array<{ at: number; text: string; coins?: number; keys?: number }>;
}

const empty = (): EconomyState => ({
  coins: 100, keys: 1, crates: [], items: [], equipped: {}, stats: { jobs: 0, runs: 0, ghosts: 0, crates: 0 },
  ghostsBeaten: {}, freeDay: null, challenge: null, log: [{ at: Date.now(), text: 'Welcome gift: 100 coins and a key' }],
});

/** Coins, fixed and published so nothing feels rigged. */
export const EARN = { run: 5, best: 10, achievement: 25, job: 20, challenge: 50, ghost: 40 } as const;
/** Chance a crate drops: after any game run, and after a job whose checks pass. */
export const DROP = { run: 0.08, job: 0.25 } as const;
export const PAINTED = 0.2;
export const CERTIFIED = 0.15;

const CHALLENGES: Array<Omit<Challenge, 'day' | 'done'>> = [
  { gameId: 'snake', target: 15, text: 'Get a Conga line of 15', host: 'pip' },
  { gameId: 'minesweeper', target: 120, lowerIsBetter: true, text: 'Clear Medium Minesweeper in 2 minutes', host: 'moss' },
  { gameId: 'stack', target: 20, text: 'Stack 20 planks', host: 'tuck' },
  { gameId: 'hatch', target: 5000, text: 'Score 5,000 in Hatch', host: 'wren' },
  { gameId: 'flappy', target: 15, text: 'Flap through 15 gaps', host: 'bly' },
  { gameId: 'breakout', target: 2000, text: 'Score 2,000 in Brick Nest', host: 'bram' },
  { gameId: 'memory', target: 14, lowerIsBetter: true, text: 'Clear Crew Match in 14 moves or fewer', host: 'juno' },
  { gameId: 'basketball', target: 30, text: 'Score 30 in Hoops', host: 'juno' },
  { gameId: 'soccer', target: 7, text: 'Score 7 penalties', host: 'fig' },
  { gameId: 'baseball', target: 5, text: 'Hit 5 home runs', host: 'tuck' },
  { gameId: 'fieldgoal', target: 30, text: 'Kick 30 points of field goals', host: 'bram' },
  { gameId: 'solitaire', target: 300, lowerIsBetter: true, text: 'Win Solitaire in under 5 minutes', host: 'ollie' },
  { gameId: 'sudoku', target: 480, lowerIsBetter: true, text: 'Solve a Sudoku in under 8 minutes', host: 'wren' },
  { gameId: 'roostbirds', target: 20000, text: 'Score 20,000 on one Roost Birds fort', host: 'ollie' },
];

export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function crateOnSale(c: CrateDef, now = new Date()): boolean {
  return !c.months || c.months.includes(now.getMonth() + 1);
}

/** Roll a rarity at Rocket League's odds. */
export function rollRarity(rnd: () => number): Rarity {
  let r = rnd() * 100;
  for (const k of RARITIES) { if ((r -= ODDS[k]) < 0) return k; }
  return 'rare';
}

/** What a crate gives. A free drop is mostly commons: it rolls, then any
 *  rarity above Very Rare is kept only one time in four. */
export function rollCrate(crate: string, rnd: () => number): { item: Item; paint?: string; cert?: string } {
  const pool = ITEMS.filter((i) => i.series.includes(crate));
  let rarity = rollRarity(rnd);
  if (crate === 'free' && (rarity === 'import' || rarity === 'exotic' || rarity === 'black-market') && rnd() > 0.25) rarity = 'very-rare';
  // Fall back down the ladder if a series has nothing at that rarity.
  let options: Item[] = [];
  for (let i = RARITIES.indexOf(rarity); i >= 0 && !options.length; i--) options = pool.filter((x) => x.rarity === RARITIES[i]);
  if (!options.length) options = pool;
  const item = options[Math.floor(rnd() * options.length)];
  const paint = item.slot !== 'title' && rnd() < PAINTED ? PAINTS[Math.floor(rnd() * PAINTS.length)].id : undefined;
  const cert = rnd() < CERTIFIED ? CERTS[Math.floor(rnd() * CERTS.length)].id : undefined;
  return { item, paint, cert };
}

let seq = 0;
const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export class Economy {
  private s: EconomyState;
  constructor(private file = join(dataDir(), 'economy.json'), private rnd: () => number = Math.random) {
    try { this.s = { ...empty(), ...JSON.parse(readFileSync(file, 'utf8')) }; } catch { this.s = empty(); }
  }
  private save(): void {
    try {
      mkdirSync(join(this.file, '..'), { recursive: true });
      writeFileSync(`${this.file}.tmp`, JSON.stringify(this.s));
      renameSync(`${this.file}.tmp`, this.file);
    } catch { /* next write retries */ }
  }
  private note(text: string, coins?: number, keys?: number): void {
    this.s.log = [{ at: Date.now(), text, coins, keys }, ...this.s.log].slice(0, 60);
  }
  private addCrate(crate: string, source: string): OwnedCrate {
    const c = { uid: uid(), crate, at: Date.now(), source };
    this.s.crates.push(c);
    return c;
  }

  state(now = new Date()): EconomyState & { challenge: Challenge } {
    const day = dayKey(now);
    if (!this.s.challenge || this.s.challenge.day !== day) {
      const t = CHALLENGES[hash(day) % CHALLENGES.length];
      this.s.challenge = { ...t, day, done: false };
      this.save();
    }
    return this.s as EconomyState & { challenge: Challenge };
  }

  /** A finished game run. Returns what it earned, for the toast. */
  run(gameId: string, opts: { best?: boolean; achievements?: number } = {}): { coins: number; crate?: OwnedCrate } {
    let coins = EARN.run + (opts.best ? EARN.best : 0) + (opts.achievements ?? 0) * EARN.achievement;
    this.s.coins += coins;
    this.s.stats.runs++;
    let crate: OwnedCrate | undefined;
    if (this.rnd() < DROP.run) crate = this.addCrate(this.rnd() < 0.5 ? 'season1' : 'season2', `a ${gameId} run`);
    this.note(`Played ${gameId}${crate ? ' — a crate dropped!' : ''}`, coins);
    this.save();
    return { coins, crate };
  }

  achievement(gameId: string, id: string): number {
    this.s.coins += EARN.achievement;
    this.note(`Achievement in ${gameId}: ${id}`, EARN.achievement);
    this.save();
    return EARN.achievement;
  }

  /** A job whose checks passed: work pays too. */
  job(crew?: string): { coins: number; crate?: OwnedCrate } {
    this.s.coins += EARN.job;
    this.s.stats.jobs++;
    let crate: OwnedCrate | undefined;
    if (this.rnd() < DROP.job) crate = this.addCrate(this.rnd() < 0.5 ? 'season1' : 'season2', 'shipping work');
    this.note(`${crew ?? 'The crew'} shipped a job${crate ? ' — a crate dropped!' : ''}`, EARN.job);
    this.save();
    return { coins: EARN.job, crate };
  }

  challengeResult(gameId: string, score: number, now = new Date()): { done: boolean; keys?: number; coins?: number } {
    const c = this.state(now).challenge;
    if (c.done || c.gameId !== gameId) return { done: c.done };
    const met = c.lowerIsBetter ? score <= c.target : score >= c.target;
    if (!met) return { done: false };
    c.done = true;
    this.s.keys += 1;
    this.s.coins += EARN.challenge;
    this.note(`Daily challenge done: ${c.text}`, EARN.challenge, 1);
    this.save();
    return { done: true, keys: 1, coins: EARN.challenge };
  }

  /** Beat a ghost: the first time per ghost per game pays a key, coins, and
   *  (once ever per ghost) that ghost's own aura. */
  ghost(gameId: string, crew: string): { first: boolean; keys?: number; coins?: number; item?: Owned } {
    const k = `${gameId}:${crew}`;
    if (this.s.ghostsBeaten[k]) return { first: false };
    this.s.ghostsBeaten[k] = Date.now();
    this.s.stats.ghosts++;
    this.s.keys += 1;
    this.s.coins += EARN.ghost;
    let item: Owned | undefined;
    const g = ghostItem(crew);
    if (!this.s.items.some((i) => i.itemId === g.id)) {
      item = { uid: uid(), itemId: g.id, at: Date.now(), source: `beating ${crew}'s ghost` };
      this.s.items.push(item);
    }
    this.note(`Beat ${crew}'s ghost in ${gameId}`, EARN.ghost, 1);
    this.save();
    return { first: true, keys: 1, coins: EARN.ghost, item };
  }

  buy(crateId: string, now = new Date()): OwnedCrate {
    const c = CRATES.find((x) => x.id === crateId);
    if (!c || c.free) throw new Error('That crate isn’t for sale.');
    if (!crateOnSale(c, now)) throw new Error(`${c.name} is out of season.`);
    if (this.s.coins < c.price) throw new Error(`Needs ${c.price} coins — you have ${this.s.coins}.`);
    this.s.coins -= c.price;
    const oc = this.addCrate(c.id, 'the shop');
    this.note(`Bought a ${c.name}`, -c.price);
    this.save();
    return oc;
  }

  claimFree(now = new Date()): OwnedCrate {
    const day = dayKey(now);
    if (this.s.freeDay === day) throw new Error('Today’s free drop is already claimed.');
    this.s.freeDay = day;
    const oc = this.addCrate('free', 'the daily drop');
    this.note('Claimed the daily drop');
    this.save();
    return oc;
  }

  /** Opening costs a key, except the free daily drop, which opens itself. */
  open(crateUid: string): Owned {
    const i = this.s.crates.findIndex((c) => c.uid === crateUid);
    if (i < 0) throw new Error('No such crate.');
    const crate = this.s.crates[i];
    const needsKey = crate.crate !== 'free';
    if (needsKey && this.s.keys < 1) throw new Error('You need a key. Keys come from the daily challenge and beating ghosts.');
    if (needsKey) this.s.keys -= 1;
    this.s.crates.splice(i, 1);
    const r = rollCrate(crate.crate, this.rnd);
    const owned: Owned = { uid: uid(), itemId: r.item.id, paint: r.paint, cert: r.cert, at: Date.now(), source: CRATES.find((c) => c.id === crate.crate)?.name ?? crate.crate };
    this.s.items.push(owned);
    this.s.stats.crates++;
    this.note(`Opened a crate: ${r.item.name}`, undefined, needsKey ? -1 : undefined);
    this.save();
    return owned;
  }

  /** Five of one rarity for one of the next rarity up (not Black Market, not ghosts). */
  tradeUp(uids: string[]): Owned {
    if (uids.length !== 5 || new Set(uids).size !== 5) throw new Error('Pick exactly five items.');
    const picked = uids.map((u) => this.s.items.find((i) => i.uid === u));
    if (picked.some((p) => !p)) throw new Error('One of those isn’t yours.');
    const rarities = picked.map((p) => itemById(p!.itemId)?.rarity);
    const r = rarities[0];
    if (!r || r === 'ghost' || r === 'black-market' || rarities.some((x) => x !== r)) throw new Error('All five must share one rarity below Black Market.');
    const equippedUids = new Set(Object.values(this.s.equipped).flatMap((l) => Object.values(l)));
    if (uids.some((u) => equippedUids.has(u))) throw new Error('Take them off first — one is being worn.');
    const next = RARITIES[RARITIES.indexOf(r) + 1];
    const pool = ITEMS.filter((x) => x.rarity === next);
    const item = pool[Math.floor(this.rnd() * pool.length)];
    this.s.items = this.s.items.filter((i) => !uids.includes(i.uid));
    const paint = item.slot !== 'title' && this.rnd() < PAINTED ? PAINTS[Math.floor(this.rnd() * PAINTS.length)].id : undefined;
    const owned: Owned = { uid: uid(), itemId: item.id, paint, at: Date.now(), source: 'a trade-up' };
    this.s.items.push(owned);
    this.note(`Traded up five ${r} items for ${item.name}`);
    this.save();
    return owned;
  }

  equip(crew: string, slot: Slot, itemUid: string | null): Loadout {
    if (!SLOTS.includes(slot)) throw new Error('No such slot.');
    const lo = (this.s.equipped[crew] ??= {});
    if (itemUid === null) delete lo[slot];
    else {
      const it = this.s.items.find((i) => i.uid === itemUid);
      const def = it && itemById(it.itemId);
      if (!it || !def) throw new Error('Not in your inventory.');
      if (def.slot !== slot) throw new Error(`That goes in ${def.slot}, not ${slot}.`);
      lo[slot] = itemUid;
    }
    this.save();
    return lo;
  }

  /** What everyone is wearing, resolved for drawing anywhere in the app. */
  looks(): Record<string, Partial<Record<Slot, { itemId: string; art: string; paint?: string; cert?: string; certValue?: number; text?: string; rarity: string; name: string }>>> {
    const out: ReturnType<Economy['looks']> = {};
    for (const [crew, lo] of Object.entries(this.s.equipped)) {
      const look: (typeof out)[string] = {};
      for (const [slot, u] of Object.entries(lo) as Array<[Slot, string]>) {
        const it = this.s.items.find((i) => i.uid === u);
        const def = it && itemById(it.itemId);
        if (!it || !def) continue;
        look[slot] = { itemId: def.id, art: def.art, paint: it.paint, cert: it.cert, certValue: it.cert ? (this.s.stats as any)[it.cert] ?? 0 : undefined, text: def.text, rarity: def.rarity, name: def.name };
      }
      out[crew] = look;
    }
    return out;
  }
}
