import { describe, expect, it } from 'vitest';
import { companionFor, levelFor, sinceSummary, type CompanionInput, type LifeEvent } from '../src/companions.js';

const H = 3_600_000, D = 24 * H;
const now = new Date(2026, 8, 25, 12).getTime();
const base = (over: Partial<CompanionInput> = {}): CompanionInput => ({
  names: ['Ollie'], ledger: [], life: [], now, working: new Set(), usedPercent: () => ({ percent: 40, vendor: 'claude' }), ...over,
});
const call = (at: number, out = 100, think?: number) => ({ at, persona: 'Ollie', outTok: out, reasoningTok: think });

describe('companions: every feeling from a record (item 40)', () => {
  it('a member who never worked says so, with no invented stats', () => {
    const c = companionFor('Ollie', base());
    expect(c.mood.key).toBe('new');
    expect(c.longestThink).toBeNull();
    expect(c.joined).toBeNull();
    expect(c.milestones.every((m) => m.earnedAt === null)).toBe(true);
  });

  it('working right now outranks every other mood', () => {
    const life: LifeEvent[] = [{ at: now - H, kind: 'verify', names: ['Ollie'], passed: false }];
    expect(companionFor('Ollie', base({ working: new Set(['Ollie']), life })).mood.key).toBe('busy');
  });

  it('a failed gate on their job makes them determined; a pass since makes them proud', () => {
    const failed: LifeEvent = { at: now - 2 * H, kind: 'verify', names: ['Ollie'], passed: false, job: 'the map' };
    expect(companionFor('Ollie', base({ life: [failed], ledger: [call(now - H)] })).mood.key).toBe('determined');
    const passed: LifeEvent = { at: now - H, kind: 'verify', names: ['Ollie'], passed: true, job: 'the map', sessionId: 's' };
    const c = companionFor('Ollie', base({ life: [{ ...failed, sessionId: 's' }, passed], ledger: [call(now - H)] }));
    expect(c.mood.key).toBe('proud');
    expect(c.mood.line).toContain('the map');
    expect(c.milestones.find((m) => m.id === 'comeback')!.earnedAt).toBe(passed.at);
  });

  it('energy is what is left of their subscription, and hungry when nearly gone; unknown stays unknown', () => {
    expect(companionFor('Ollie', base({ usedPercent: () => ({ percent: 95, vendor: 'claude' }), ledger: [call(now - 5 * H)] })).mood.key).toBe('hungry');
    expect(companionFor('Ollie', base({ usedPercent: () => ({ percent: null, vendor: 'claude' }) })).energy).toBeNull();
  });

  it('they miss you after three quiet days', () => {
    const c = companionFor('Ollie', base({ ledger: [call(now - 4 * D)] }));
    expect(c.mood.key).toBe('missed');
    expect(c.mood.line).toBe("It's been 4 days.");
  });

  it('a streak counts back from today, or from yesterday before today’s first call', () => {
    const ledger = [call(now - 2 * D), call(now - D), call(now - 4 * D)];
    const c = companionFor('Ollie', base({ ledger }));
    expect(c.streak).toBe(2);
    expect(c.bestStreak).toBe(2);
  });

  it('milestones come from single real calls', () => {
    const c = companionFor('Ollie', base({ ledger: [call(now - H, 60_000, 25_000)] }));
    expect(c.milestones.find((m) => m.id === 'marathon')!.earnedAt).not.toBeNull();
    expect(c.milestones.find((m) => m.id === 'deep')!.earnedAt).not.toBeNull();
    expect(c.longestThink).toBe(25_000);
  });

  it('level grows with work, a shipped job worth ten calls', () => {
    expect(levelFor(0, 0)).toBe(1);
    expect(levelFor(0, 10)).toBeGreaterThan(levelFor(10, 0));
    expect(levelFor(300, 0)).toBeGreaterThan(levelFor(30, 0));
  });

  it('“while you were away” is counted, not guessed', () => {
    const s = sinceSummary({
      ledger: [call(now - 3 * H), call(now - 2 * H), { at: now - H, persona: 'Moss' }, call(now - 30 * H)],
      life: [{ at: now - H, kind: 'verify', names: ['Ollie'], passed: true }],
      since: now - 10 * H, now,
    });
    expect(s).toEqual({ busiest: 'Ollie', calls: 3, shipped: 1, failed: 0 });
  });
});
