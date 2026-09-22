import { describe, expect, it } from 'vitest';
import { guardDispatch, GateRefused, resetTaskBudget, type GateDeps } from '../src/gate.js';
import type { Headroom } from '../src/quota.js';

const H = (state: Headroom['state'], reason = state): Headroom => ({ state, worstPercent: null, ageMins: 0, reason });
const deps = (over: Partial<GateDeps> = {}): GateDeps => ({
  headroom: () => H('room'),
  presence: () => 'present',
  taskTokens: () => 0,
  budget: { reprioritizeAtPct: 75, gateAtPct: 90, hardStopPct: 98, staleAfterMins: 90, surplusHeadroomPct: 25, surplusWithinMins: 360, maxDispatchesPerTask: 2, maxTaskTokens: 1_000 },
  ...over,
});

describe('guardDispatch', () => {
  it('refuses an absent vendor and an exhausted one, with the reason', () => {
    expect(() => guardDispatch({ agent: 'codex' }, deps({ presence: () => 'absent' }))).toThrow(GateRefused);
    expect(() => guardDispatch({ agent: 'claude' }, deps({ headroom: () => H('exhausted', '7-day at 99%') }))).toThrow(/99%/);
  });

  it('allows but flags a gated vendor', () => {
    expect(guardDispatch({ agent: 'claude' }, deps({ headroom: () => H('gated') }))).toMatchObject({ ok: true, gated: true });
  });

  it('bounds the task by dispatch count', () => {
    resetTaskBudget('t1');
    guardDispatch({ agent: 'claude', taskId: 't1' }, deps());
    guardDispatch({ agent: 'claude', taskId: 't1' }, deps());
    expect(() => guardDispatch({ agent: 'claude', taskId: 't1' }, deps())).toThrow(/dispatch ceiling/);
  });

  it('bounds the task by ledgered tokens', () => {
    resetTaskBudget('t2');
    expect(() => guardDispatch({ agent: 'claude', taskId: 't2' }, deps({ taskTokens: () => 1_000 }))).toThrow(/token ceiling/);
  });

  it('does not count untasked dispatches against any ceiling', () => {
    for (let i = 0; i < 5; i++) expect(guardDispatch({ agent: 'claude' }, deps()).ok).toBe(true);
  });
});
