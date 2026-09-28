import { describe, expect, it } from 'vitest';
import { advise, planRoutes, planWords } from '../src/subscription.js';

const DAY = 86_400_000;
const week = (used: number, daysLeft: number, now: number) => ({ usedPercent: used, resetsAt: now + daysLeft * DAY, windowDurationMins: 10080 });

describe('your plan decides how Pip hands out work', () => {
  it('$100 never uses Haiku, and everyday work goes to Opus', () => {
    const r = planRoutes('100');
    expect(JSON.stringify(r.claude)).not.toMatch(/haiku/);
    expect(r.claude.standard.model).toBe('opus');
    expect(r.claude.light.model).toBe('sonnet');
  });
  it('$20 keeps Haiku for chores and Opus for the hard problems only', () => {
    const r = planRoutes('20');
    expect(r.claude.light.model).toBe('haiku');
    expect(r.claude.standard.model).toBe('sonnet');
    expect(r.claude.heavy.model).toBe('opus');
  });
  it('light and standard may cross vendors; heavy stays put', () => {
    const r = planRoutes('100');
    expect(r.claude.light.candidates?.map((c) => c.agent)).toEqual(['claude', 'codex']);
    expect(r.claude.heavy.candidates).toBeUndefined();
  });
  it('says the ladder in plain words', () => {
    expect(planWords('100')).toMatch(/Everyday work: Opus\./);
  });
});

describe('the advisor reads the week', () => {
  const now = 1_000 * DAY;
  it('burning fast: steps down', () => {
    expect(advise('100', week(80, 4, now), now).suggest).toBe('20');
  });
  it('lots left late in the week: steps up', () => {
    expect(advise('100', week(20, 2, now), now).suggest).toBe('200');
  });
  it('on pace: stays', () => {
    expect(advise('100', week(50, 3.5, now), now).suggest).toBe('100');
  });
  it('no reading: stays, and says so', () => {
    expect(advise('20', null).why).toMatch(/No usage reading/);
  });
});
