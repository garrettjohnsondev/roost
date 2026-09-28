import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Economy, rollCrate, rollRarity } from '../src/economy.js';
import { ITEMS, ODDS, RARITIES } from '../src/catalog.js';

const file = () => join(mkdtempSync(join(tmpdir(), 'econ-')), 'economy.json');
const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };

describe('Roost Crates, Rocket League style, no money', () => {
  it('odds are 55/28/12/4/1', () => {
    expect(RARITIES.map((r) => ODDS[r])).toEqual([55, 28, 12, 4, 1]);
    expect(rollRarity(() => 0)).toBe('rare');
    expect(rollRarity(() => 0.995)).toBe('black-market');
    expect(rollRarity(() => 0.6)).toBe('very-rare');
  });
  it('every crate series can drop something, and seasonal items only come from their crates', () => {
    for (const c of ['season1', 'season2', 'spooky', 'frosty', 'bloom', 'free']) expect(rollCrate(c, seq(0.1, 0.5, 0.9)).item).toBeTruthy();
    const pumpkin = ITEMS.find((i) => i.id === 'hat-pumpkin')!;
    expect(pumpkin.series).toEqual(['spooky']);
  });
  it('starts with a welcome gift, buys with coins, opens with a key', () => {
    const e = new Economy(file(), seq(0.1));
    const s = e.state(new Date('2026-09-29T10:00:00'));
    expect(s.coins).toBe(100);
    e.run('snake'); e.run('snake'); // +10
    for (let i = 0; i < 8; i++) e.run('snake', { best: true }); // +120 -> 230
    const crate = e.buy('season1');
    expect(e.state().coins).toBe(230 - 150);
    const item = e.open(crate.uid);
    expect(item.itemId).toBeTruthy();
    expect(e.state().keys).toBe(0);
    const c2 = e.buy.bind(e);
    expect(() => c2('season1')).toThrow(/Needs 150 coins/);
  });
  it('seasonal crates are sold only in season', () => {
    const e = new Economy(file());
    for (let i = 0; i < 60; i++) e.run('snake');
    expect(() => e.buy('spooky', new Date('2026-07-01T12:00:00'))).toThrow(/out of season/);
    expect(e.buy('spooky', new Date('2026-10-05T12:00:00')).crate).toBe('spooky');
  });
  it('one free drop a day, and it opens without a key', () => {
    const e = new Economy(file(), seq(0.3));
    const d = new Date('2026-09-29T09:00:00');
    const free = e.claimFree(d);
    expect(() => e.claimFree(d)).toThrow(/already claimed/);
    e.state().keys = 0;
    expect(e.open(free.uid).source).toBe('Daily Drop');
  });
  it('trade up: five of one rarity for one of the next', () => {
    const e = new Economy(file(), seq(0.01));
    const s = e.state();
    for (let i = 0; i < 5; i++) s.items.push({ uid: `u${i}`, itemId: 'hat-beanie', at: 0, source: 't' });
    const got = e.tradeUp(['u0', 'u1', 'u2', 'u3', 'u4']);
    expect(ITEMS.find((i) => i.id === got.itemId)?.rarity).toBe('very-rare');
    expect(e.state().items).toHaveLength(1);
  });
  it('a ghost pays once, with its own aura; only strong ghosts pay a key', () => {
    const e = new Economy(file());
    expect(e.ghost('snake', 'Moss').keys).toBe(0);
    const r = e.ghost('snake', 'Ollie');
    expect(r.first).toBe(true);
    expect(r.keys).toBe(1);
    expect(r.item?.itemId).toBe('ghost-ollie');
    expect(e.ghost('snake', 'Ollie').first).toBe(false);
  });
  it('the daily challenge pays a key when met', () => {
    const e = new Economy(file());
    const d = new Date('2026-09-29T09:00:00');
    const c = e.state(d).challenge;
    const score = c.lowerIsBetter ? c.target - 1 : c.target + 1;
    expect(e.challengeResult(c.gameId, score, d)).toMatchObject({ done: true, keys: 1 });
  });
  it('equips what you own into the right slot, and it shows in looks()', () => {
    const e = new Economy(file());
    e.state().items.push({ uid: 'h', itemId: 'hat-tophat', paint: 'cobalt', at: 0, source: 't' });
    e.equip('Ollie', 'hat', 'h');
    expect(() => e.equip('Ollie', 'prop', 'h')).toThrow(/goes in hat/);
    expect(e.looks().Ollie.hat).toMatchObject({ art: 'tophat', paint: 'cobalt' });
  });
});
