import { describe, expect, it } from 'vitest';
import { summarizeDecisions } from '../src/decisions.js';

const t0 = 1_700_000_000_000;
const rows = [
  { at: t0 - 100, kind: 'route' as const },                                                     // too old
  { at: t0 + 1, kind: 'route' as const, tier: 'light' },
  { at: t0 + 2, kind: 'dispatch' as const, ok: true, ms: 4000 },
  { at: t0 + 3, kind: 'dispatch' as const, ok: false, ms: 1000, error: 'timeout' },
  { at: t0 + 4, kind: 'review' as const, strength: 'cross-vendor', skipped: false },
  { at: t0 + 5, kind: 'review' as const, strength: 'cross-model', skipped: true },
  { at: t0 + 6, kind: 'gate' as const, rule: 'one-writer' },
];

describe('decisions summary', () => {
  it('counts only rows inside the window', () => {
    const s = summarizeDecisions(rows, t0);
    expect(s.total).toBe(6);
    expect(s.routes).toBe(1);
    expect(s.dispatches).toEqual({ total: 2, ok: 1, failed: 1, meanMs: 2500 });
    expect(s.reviews).toEqual({ total: 2, skippedBySizeGate: 1, byStrength: { 'cross-vendor': 1, 'cross-model': 1 } });
    expect(s.gates.oneWriter).toBe(1);
  });

  it('reports no mean at all rather than a mean of zero', () => {
    expect(summarizeDecisions([{ at: t0 + 1, kind: 'route' }], t0).dispatches.meanMs).toBeNull();
  });
});
