import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'pocket-ledger-'));
process.env.POCKET_CONFIG = join(tmp, 'pocket.config.json');
process.env.POCKET_LEGACY_PRICES = '';
writeFileSync(process.env.POCKET_CONFIG, '{}');

const { CallLedger } = await import('../src/ledger.js');
const { loadConfig } = await import('../src/config.js');
const cfg = loadConfig();

let n = 0;
let ledger: InstanceType<typeof CallLedger>;
beforeEach(() => {
  ledger = new CallLedger(join(tmp, `d${n++}`));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const rec = (over: Partial<any> = {}) => ({
  at: Date.now(),
  sessionId: 's1',
  agent: 'claude' as const,
  model: 'haiku',
  role: 'execute',
  inTok: 10_000,
  outTok: 1_000,
  cacheReadTok: 0,
  cacheWriteTok: 0,
  costUsd: 0.015,
  costBasis: 'sdk' as const,
  ...over,
});

describe('rollup', () => {
  it('attributes by agent, role and persona', () => {
    ledger.record(rec({ role: 'plan', persona: 'Fable', costUsd: 1 }));
    ledger.record(rec({ role: 'execute', persona: 'Larry', costUsd: 0.1 }));
    ledger.record(rec({ role: 'execute', persona: 'Larry', costUsd: 0.1 }));
    const r = ledger.rollup(0);
    expect(r.calls).toBe(3);
    expect(r.byRole.plan.calls).toBe(1);
    expect(r.byRole.execute.calls).toBe(2);
    expect(r.byPersona.Larry.usd).toBeCloseTo(0.2, 6);
    expect(r.usd).toBeCloseTo(1.2, 6);
  });

  // The orchestrator's own turns were the ~$11-per-14-dispatches nobody budgeted
  // for; they have to be visible as their own line, not folded into execution.
  it('keeps orchestration roles separately countable', () => {
    ledger.record(rec({ role: 'triage', costUsd: 0.002 }));
    ledger.record(rec({ role: 'reconcile', costUsd: 0.5 }));
    const r = ledger.rollup(0);
    expect(Object.keys(r.byRole).sort()).toEqual(['reconcile', 'triage']);
  });

  it('counts unpriced calls instead of scoring them as free', () => {
    ledger.record(rec({ costUsd: null, costBasis: 'unknown' }));
    ledger.record(rec({ costUsd: 0.5 }));
    const r = ledger.rollup(0);
    expect(r.unpricedCalls).toBe(1);
    expect(r.usd).toBeCloseTo(0.5, 6);
  });
});

describe('savings — the honesty contract', () => {
  it('returns null on too little data rather than a flattering number', () => {
    ledger.record(rec());
    expect(ledger.savings({ sinceTs: 0 }, cfg)).toBeNull();
  });

  it('returns null when the flagship itself is unpriceable', () => {
    for (let i = 0; i < 5; i++) ledger.record(rec({ agent: 'codex', model: 'gpt-5.6-sol', costUsd: 0.01, costBasis: 'table' }));
    // codex heavy tier has no price row, so "solo" has no meaning — say nothing.
    expect(ledger.savings({ sinceTs: 0 }, cfg)).toBeNull();
  });

  it('computes a real report when cheap models did the volume', () => {
    for (let i = 0; i < 10; i++) ledger.record(rec({ model: 'haiku', inTok: 100_000, outTok: 10_000, costUsd: 0.15, costBasis: 'sdk' }));
    const s = ledger.savings({ sinceTs: 0 }, cfg)!;
    expect(s).not.toBeNull();
    expect(s.flagshipModel).toBe('opus');
    expect(s.soloUsd).toBeGreaterThan(s.actualUsd);
    expect(s.savedPct).toBeGreaterThan(0);
    expect(s.basis).toBe('sdk');
    // 1M in + 100k out at opus 15/75 = 15 + 7.5
    expect(s.soloUsd).toBeCloseTo(22.5, 2);
  });

  it('returns null when the work was already done at flagship rates', () => {
    for (let i = 0; i < 5; i++) ledger.record(rec({ model: 'opus', inTok: 100_000, outTok: 10_000, costUsd: 2.25, costBasis: 'sdk' }));
    expect(ledger.savings({ sinceTs: 0 }, cfg)).toBeNull();
  });

  it('marks the basis as mixed when some calls were only estimated', () => {
    for (let i = 0; i < 5; i++) ledger.record(rec({ model: 'haiku', costUsd: 0.01, costBasis: 'sdk', inTok: 100_000, outTok: 10_000 }));
    for (let i = 0; i < 5; i++) ledger.record(rec({ model: 'haiku', costUsd: 0.01, costBasis: 'table', inTok: 100_000, outTok: 10_000 }));
    expect(ledger.savings({ sinceTs: 0 }, cfg)!.basis).toBe('mixed');
  });
});

describe('durability', () => {
  it('reloads records written by a previous process', () => {
    const dir = join(tmp, 'persist');
    const a = new CallLedger(dir);
    a.record(rec({ costUsd: 0.25 }));
    a.record(rec({ costUsd: 0.25 }));
    const b = new CallLedger(dir);
    expect(b.rollup(0).calls).toBe(2);
    expect(b.rollup(0).usd).toBeCloseTo(0.5, 6);
  });
});
