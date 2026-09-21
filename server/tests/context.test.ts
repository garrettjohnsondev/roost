import { describe, expect, it } from 'vitest';
import { pressureFor, adviseContext, fromClaudeContextUsage, fromCodexTokenUsage, withAdvice } from '../src/context.js';

describe('pressureFor', () => {
  it('treats unknown as unknown, never as clear', () => {
    expect(pressureFor(null)).toBe('unknown');
  });

  // Thresholds are deliberately tighter than any engine auto-compact trigger:
  // all 18 frontier models tested degrade with length, with real losses around
  // 50k in a 200k window. Waiting for compaction means waiting past the damage.
  it('warns well before the window is full', () => {
    expect(pressureFor(10)).toBe('clear');
    expect(pressureFor(45)).toBe('filling');
    expect(pressureFor(65)).toBe('degrading');
    expect(pressureFor(85)).toBe('critical');
  });
});

describe('adviseContext', () => {
  const at = (percent: number) => ({ agent: 'claude' as const, usedTokens: 1, maxTokens: 2, percent, pressure: pressureFor(percent), observedAt: Date.now() });

  it('says nothing while there is room', () => {
    expect(adviseContext(at(10))).toBeNull();
  });

  it('escalates cheapest-first: dispatch, then compact, then handoff', () => {
    expect(adviseContext(at(45))!.action).toBe('dispatch');
    expect(adviseContext(at(65))!.action).toBe('compact');
    expect(adviseContext(at(85))!.action).toBe('handoff');
  });

  it('distinguishes a hard limit from a compaction window', () => {
    const hard = adviseContext({ ...at(99), overLimit: { tokensOver: 4_000, kind: 'hard_limit' } })!;
    expect(hard.action).toBe('handoff');
    expect(hard.reason).toMatch(/will be refused/);
    const soft = adviseContext({ ...at(99), overLimit: { tokensOver: 4_000, kind: 'compaction_window' } })!;
    expect(soft.reason).toMatch(/compaction window/);
  });
});

describe('fromClaudeContextUsage', () => {
  const LIVE = {
    model: 'claude-sonnet-4',
    total_tokens: 120_000,
    raw_max_tokens: 200_000,
    percentage: 60,
    categories: [
      { name: 'messages', tokens: 90_000, kind: 'used' },
      { name: 'tools', tokens: 20_000, kind: 'used' },
      { name: 'free', tokens: 80_000, kind: 'free' },
      { name: 'stale schemas', tokens: 5_000, kind: 'deferred' },
    ],
  };

  it('maps the structured report and ranks the biggest consumers', () => {
    const s = fromClaudeContextUsage({ context_usage: LIVE })!;
    expect(s.percent).toBe(60);
    expect(s.pressure).toBe('degrading');
    expect(s.categories![0]).toMatchObject({ name: 'messages', tokens: 90_000 });
  });

  it('excludes deferred rows, which are out-of-window by definition', () => {
    const s = fromClaudeContextUsage({ context_usage: LIVE })!;
    expect(s.categories!.some((c) => c.name === 'stale schemas')).toBe(false);
  });

  it('returns null rather than inventing a reading', () => {
    expect(fromClaudeContextUsage(undefined)).toBeNull();
    expect(fromClaudeContextUsage({ context_usage: {} })).toBeNull();
  });
});

describe('fromCodexTokenUsage', () => {
  it('computes percent against the engine-reported window', () => {
    const s = fromCodexTokenUsage({ inputTokens: 30_000, cachedInputTokens: 60_000, outputTokens: 2_000 }, 200_000)!;
    expect(s.usedTokens).toBe(92_000);
    expect(s.percent).toBe(46);
    expect(s.pressure).toBe('filling');
  });

  it('returns null when the window is unknown', () => {
    expect(fromCodexTokenUsage({ inputTokens: 1000 }, null)).toBeNull();
  });
});

describe('withAdvice', () => {
  it('attaches advice without mutating the reading', () => {
    const s = withAdvice(fromCodexTokenUsage({ inputTokens: 170_000 }, 200_000))!;
    expect(s.percent).toBe(85);
    expect(s.advice!.action).toBe('handoff');
  });
});
