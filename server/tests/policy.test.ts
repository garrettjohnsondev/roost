import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'pocket-policy-'));
process.env.POCKET_CONFIG = join(tmp, 'pocket.config.json');
process.env.POCKET_LEGACY_PRICES = '';
writeFileSync(process.env.POCKET_CONFIG, '{}');

const { QuotaStore } = await import('../src/quota.js');
const { CallLedger } = await import('../src/ledger.js');
const { evaluatePolicy } = await import('../src/policy.js');
const { loadConfig } = await import('../src/config.js');
const budget = loadConfig().budget;

let n = 0;
let quota: InstanceType<typeof QuotaStore>;
let ledger: InstanceType<typeof CallLedger>;
beforeEach(() => {
  const d = join(tmp, `d${n++}`);
  quota = new QuotaStore(d);
  ledger = new CallLedger(d);
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const hoursFromNow = (h: number) => Math.floor((Date.now() + h * 3_600_000) / 1000);
const claudeAt = (pct: number, h = 48) => quota.noteClaude({ rateLimitType: 'seven_day', utilization: pct, resetsAt: hoursFromNow(h) });
const codexAt = (pct: number, h = 100) =>
  quota.noteCodexSnapshot({ primary: { usedPercent: pct, windowDurationMins: 10080, resetsAt: hoursFromNow(h) } }, { sparse: false });

describe('evaluatePolicy', () => {
  // The six-week regression, at the policy layer: with nothing live, agent-sync
  // returned {level:'ok'} and every gate stayed asleep.
  it('no data anywhere is reprioritize, never ok', () => {
    const v = evaluatePolicy(quota, ledger, budget);
    expect(v.level).toBe('reprioritize');
    expect(v.reasons.join(' ')).toMatch(/no live quota data/);
  });

  it('is ok when both suites have room', () => {
    claudeAt(20);
    codexAt(5);
    expect(evaluatePolicy(quota, ledger, budget).level).toBe('ok');
  });

  it('reprioritizes at 75 and gates at 90', () => {
    claudeAt(80);
    codexAt(5);
    expect(evaluatePolicy(quota, ledger, budget).level).toBe('reprioritize');

    const d = join(tmp, 'gate');
    const q2 = new QuotaStore(d);
    q2.noteClaude({ rateLimitType: 'seven_day', utilization: 93, resetsAt: hoursFromNow(48) });
    q2.noteCodexSnapshot({ primary: { usedPercent: 5, windowDurationMins: 10080, resetsAt: hoursFromNow(100) } }, { sparse: false });
    expect(evaluatePolicy(q2, new CallLedger(d), budget).level).toBe('gate');
  });

  it('one suite exhausted while the other has room only gates — work can still move', () => {
    claudeAt(99);
    codexAt(10);
    expect(evaluatePolicy(quota, ledger, budget).level).toBe('gate');
  });

  it('hard stops only when nothing has usable headroom', () => {
    claudeAt(99);
    codexAt(99);
    expect(evaluatePolicy(quota, ledger, budget).level).toBe('hardstop');
  });

  it('surfaces a surplus window alongside the level', () => {
    quota.noteClaude({ rateLimitType: 'five_hour', utilization: 0.25, resetsAt: hoursFromNow(1) });
    codexAt(5);
    const v = evaluatePolicy(quota, ledger, budget);
    expect(v.surplus).not.toBeNull();
    expect(v.surplus!.headroomPct).toBe(75);
  });

  it('refuses to enforce a dollar ceiling it cannot measure', () => {
    claudeAt(10);
    codexAt(10);
    const base = { at: Date.now(), sessionId: 's', agent: 'codex' as const, model: 'gpt-5.6-sol', role: 'chat', inTok: 1e6, outTok: 1e6, cacheReadTok: 0, cacheWriteTok: 0, costUsd: null, costBasis: 'unknown' as const };
    for (let i = 0; i < 5; i++) ledger.record({ ...base });
    const v = evaluatePolicy(quota, ledger, { ...budget, dailyUsd: 1 });
    expect(v.spentUsd).toBeNull();
    expect(v.level).not.toBe('hardstop');
    expect(v.reasons.join(' ')).toMatch(/not enforced/);
  });
});
