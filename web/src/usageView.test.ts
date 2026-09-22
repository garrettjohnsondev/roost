import { describe, expect, it } from 'vitest';
import { barColor, headroomNote } from './usageView';
import type { AgentUsage } from './types';

const win = (over: Partial<AgentUsage['windows'][number]> = {}) => ({
  key: 'claude:session', label: '5-hour session', usedPercent: 40, resetsAt: null, windowDurationMins: 300, observedAt: Date.now(), source: 'sdk-usage', ...over,
});
const usage = (over: Partial<AgentUsage> = {}): AgentUsage => ({ windows: [win()], usageAllowed: true, headroom: 'room', ...over });

describe('fuel gauge honesty', () => {
  it('says a stale percent is stale and when it was last seen', () => {
    const n = headroomNote(usage({ headroom: 'stale', windows: [win({ observedAt: Date.now() - 3 * 3600_000 })] }));
    expect(n?.tone).toBe('muted');
    expect(n?.text).toMatch(/Stale — last seen 3h ago/);
  });

  it('puts an explicit denial above everything', () => {
    expect(headroomNote(usage({ usageAllowed: false, headroom: 'room' }))).toEqual({ text: 'Provider reports usage not allowed', tone: 'bad' });
    expect(headroomNote(usage({ headroom: 'exhausted' }))?.tone).toBe('bad');
  });

  it('says "no percentages" rather than nothing when windows carry no number', () => {
    expect(headroomNote(usage({ headroom: 'unknown', windows: [win({ usedPercent: null })] }))?.text).toBe('No percentages reported');
    expect(headroomNote(usage({ headroom: 'unknown', windows: [] }))).toBeNull();
  });

  it('never colours a rejected or stale bar green', () => {
    expect(barColor(5, 'rejected', 'room')).toBe('var(--danger)');
    expect(barColor(5, undefined, 'exhausted')).toBe('var(--danger)');
    expect(barColor(5, undefined, 'stale')).not.toBe('var(--ok)');
    expect(barColor(5, undefined, 'room')).toBe('var(--ok)');
  });
});
