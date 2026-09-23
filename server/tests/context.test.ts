import { describe, expect, it } from 'vitest';
import { pressureFor, adviseContext, fromClaudeContextUsage, fromCodexTokenUsage, withAdvice, compactionIntent, type ContextState } from '../src/context.js';

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

  it('reads the camelCase shape that query.getContextUsage() actually returns', () => {
    // SDKControlGetContextUsageResponse: totalTokens / rawMaxTokens / percentage /
    // categories[].isDeferred. The snake_case shape only exists on /context
    // messages; reading it here returned null on every real call, so the
    // Claude context meter never emitted once.
    const s = fromClaudeContextUsage({
      totalTokens: 150_000, maxTokens: 200_000, rawMaxTokens: 200_000, percentage: 75, model: 'opus',
      categories: [
        { name: 'messages', tokens: 90_000, color: '' },
        { name: 'stale schemas', tokens: 5_000, color: '', isDeferred: true },
      ],
      gridRows: [], memoryFiles: [],
    })!;
    expect(s.usedTokens).toBe(150_000);
    expect(s.maxTokens).toBe(200_000);
    expect(s.percent).toBe(75);
    expect(s.categories!.some((c) => c.name === 'stale schemas')).toBe(false);
  });
});

describe('fromCodexTokenUsage', () => {
  it('computes percent against the engine-reported window', () => {
    // inputTokens INCLUDES cachedInputTokens (codexInputSplit.ts is the one
    // place that assumption lives). The old fixture added them on top and
    // encoded a double count as the expected answer.
    const s = fromCodexTokenUsage({ inputTokens: 90_000, cachedInputTokens: 60_000, outputTokens: 2_000 }, 200_000)!;
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

describe('compactionIntent — whether to compact, and whether to ask first', () => {
  const at = (percent: number | null, extra: Partial<ContextState> = {}): ContextState =>
    withAdvice({
      agent: 'claude', usedTokens: percent == null ? null : percent * 2000, maxTokens: 200_000,
      percent, pressure: pressureFor(percent), observedAt: 0, ...extra,
    })!;

  it('does nothing while the context is clear or merely filling', () => {
    expect(compactionIntent({ state: at(10), auto: false, handledAt: null }).kind).toBe('none');
    expect(compactionIntent({ state: at(45), auto: false, handledAt: null }).kind).toBe('none');
  });

  it('offers once the context is degrading, and carries the meter’s own reason', () => {
    const i = compactionIntent({ state: at(65), auto: false, handledAt: null });
    expect(i.kind).toBe('offer');
    if (i.kind !== 'offer') throw new Error('unreachable');
    expect(i.percent).toBe(65);
    expect(i.reason).toContain('65%');
  });

  it('never treats unknown as pressure', () => {
    // The honesty rule this whole project runs on. Compacting someone's context
    // off the back of a null would be the most destructive version of reading
    // missing data as a measurement.
    expect(compactionIntent({ state: at(null), auto: false, handledAt: null }).kind).toBe('none');
    expect(compactionIntent({ state: at(null), auto: true, handledAt: null }).kind).toBe('none');
    expect(compactionIntent({ state: null, auto: true, handledAt: null }).kind).toBe('none');
  });

  it('acts without asking only when the setting was remembered', () => {
    expect(compactionIntent({ state: at(65), auto: true, handledAt: null }).kind).toBe('auto');
    expect(compactionIntent({ state: at(65), auto: false, handledAt: null }).kind).toBe('offer');
  });

  it('asks once per level, not once per turn', () => {
    // Re-asking every reply is how a useful prompt trains people to dismiss it.
    expect(compactionIntent({ state: at(65), auto: false, handledAt: 'degrading' }).kind).toBe('none');
    // ...but an escalation is a new question.
    expect(compactionIntent({ state: at(85), auto: false, handledAt: 'degrading' }).kind).toBe('offer');
  });

  it('offers when the engine says we are past the window even with no percent', () => {
    const i = compactionIntent({
      state: at(null, { overLimit: { tokensOver: 12_000, kind: 'hard_limit' } }),
      auto: false, handledAt: null,
    });
    expect(i.kind).toBe('offer');
  });
})

describe('compactionIntent — asking again after it drained', () => {
  const st = (percent: number | null, pressure?: any): ContextState =>
    withAdvice({ agent: 'claude', usedTokens: 1, maxTokens: 200_000, percent,
                 pressure: pressure ?? pressureFor(percent), observedAt: 0 })!;

  it('forgets the level once pressure falls back, so the card can return', () => {
    // Otherwise the first compaction is the last one ever offered.
    const i = compactionIntent({ state: st(20), auto: false, handledAt: 'degrading' });
    expect(i).toEqual({ kind: 'none', forget: true });
  });

  it('does not forget on unknown — losing the meter is not evidence it drained', () => {
    const i = compactionIntent({ state: st(null), auto: false, handledAt: 'degrading' });
    expect(i.kind).toBe('none');
    expect((i as any).forget).toBeUndefined();
  });

  it('offers again at the same level after a drain and a refill', () => {
    let handledAt: any = null;
    const step = (p: number) => {
      const i = compactionIntent({ state: st(p), auto: false, handledAt });
      if (i.kind === 'none' && i.forget) handledAt = null;
      else if (i.kind !== 'none') handledAt = i.pressure;
      return i.kind;
    };
    expect(step(65)).toBe('offer');   // fills
    expect(step(65)).toBe('none');    // same level, already asked
    expect(step(12)).toBe('none');    // compacted, drains -> forget
    expect(step(65)).toBe('offer');   // fills again -> asks again
  });
})
