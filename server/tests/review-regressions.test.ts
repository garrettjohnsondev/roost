import { describe, expect, it, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Regression tests for the 2026-09-21 cross-vendor review. Each block names
 *  the failure it pins down; every one of these was live before the fix. */

const tmp = mkdtempSync(join(tmpdir(), 'pocket-review-'));
process.env.POCKET_CONFIG = join(tmp, 'pocket.config.json');
process.env.POCKET_LEGACY_PRICES = '';
writeFileSync(process.env.POCKET_CONFIG, '{}');

const { QuotaStore, normalizePct, clampPct } = await import('../src/quota.js');
const { loadConfig } = await import('../src/config.js');
const { CallLedger } = await import('../src/ledger.js');
const budget = loadConfig().budget;

let n = 0;
let store: InstanceType<typeof QuotaStore>;
beforeEach(() => {
  store = new QuotaStore(join(tmp, `q${n++}`));
});
afterEach(() => vi.useRealTimers());
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('a documented 0-100 percent is clamped, never guessed at', () => {
  it('stores an honest 1% as 1 — the value every window shows right after a reset', () => {
    store.noteClaudeUsageRead({
      rate_limits: { limits: [{ kind: 'weekly_all', group: 'weekly', percent: 1, severity: 'normal' }] },
      rate_limits_available: true,
    });
    expect(store.windows('claude').find((w) => w.key === 'claude:weekly_all')?.usedPercent).toBe(1);
    expect(store.headroom('claude', budget).state).toBe('room');
  });

  it('is why clampPct exists separately from the fraction heuristic', () => {
    expect(normalizePct(1)).toBe(100); // the ambiguous streaming path, unchanged
    expect(clampPct(1)).toBe(1);
    expect(clampPct(0)).toBe(0);
    expect(clampPct(250)).toBe(100);
    expect(clampPct('7')).toBeNull();
  });
});

describe('an explicit denial is never hidden', () => {
  it('lets a rejected rate_limit_event through the usage-read authority window', () => {
    store.noteClaudeUsageRead({
      rate_limits: { limits: [{ kind: 'session', group: 'session', percent: 23, severity: 'normal' }] },
      rate_limits_available: true,
    });
    store.noteClaude({ rateLimitType: 'five_hour', utilization: 0.99, status: 'rejected' });
    expect(store.windows('claude').find((w) => w.key === 'claude:session')?.status).toBe('rejected');
    expect(store.headroom('claude', budget).state).toBe('exhausted');
  });

  it('reads a denial with no percentage as exhausted, not unknown', () => {
    store.noteClaude({ rateLimitType: 'five_hour', status: 'rejected' });
    expect(store.windows('claude')[0].usedPercent).toBeNull();
    expect(store.headroom('claude', budget).state).toBe('exhausted');
  });

  it('reads usageAllowed=false as exhausted even with no windows at all', () => {
    store.agent('codex').usageAllowed = false;
    expect(store.headroom('codex', budget).state).toBe('exhausted');
  });
});

describe('staleness survives a sparse update', () => {
  it('keeps the observation time of a carried-over percent', () => {
    vi.useFakeTimers();
    const t0 = Date.parse('2026-09-21T12:00:00Z');
    vi.setSystemTime(t0);
    store.noteCodexSnapshot({ primary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: Math.floor(t0 / 1000) + 86_400 } }, { sparse: false });
    const first = store.windows('codex')[0].observedAt;
    vi.setSystemTime(t0 + 2 * 3600_000);
    // A rolling update that omits the percent must carry it AND its age.
    store.noteCodexSnapshot({ primary: { windowDurationMins: 10080 } }, { sparse: true });
    const w = store.windows('codex')[0];
    expect(w.usedPercent).toBe(40);
    expect(w.observedAt).toBe(first);
    expect(store.headroom('codex', budget).state).toBe('stale');
  });

  it('does not offer a stale window as use-it-or-lose-it surplus', () => {
    vi.useFakeTimers();
    const t0 = Date.parse('2026-09-21T12:00:00Z');
    vi.setSystemTime(t0);
    store.noteClaude({ rateLimitType: 'five_hour', utilization: 0.3, resetsAt: Math.floor(t0 / 1000) + 300 * 60 });
    expect(store.surplus('claude', budget)).not.toBeNull();
    vi.setSystemTime(t0 + (budget.staleAfterMins + 30) * 60_000);
    expect(store.surplus('claude', budget)).toBeNull();
  });
});

describe('a corrupt config is moved aside, never overwritten', () => {
  it('returns defaults, preserves the bad file, and hands back a private copy', () => {
    const bad = join(tmp, 'bad.config.json');
    writeFileSync(bad, '{ this is not json');
    const prev = process.env.POCKET_CONFIG;
    process.env.POCKET_CONFIG = bad;
    const cfg = loadConfig();
    process.env.POCKET_CONFIG = prev;
    expect(existsSync(bad)).toBe(false);
    expect(readdirSync(tmp).some((f) => f.startsWith('bad.config.json.corrupt-'))).toBe(true);
    // Mutating the returned config must not poison the defaults the next
    // load hands out -- the old code returned the shared DEFAULTS object.
    cfg.projects.push('/definitely/not/real');
    expect(loadConfig().projects).not.toContain('/definitely/not/real');
  });
});

describe('savings are all-or-nothing', () => {
  const cfg = loadConfig();
  const rec = (over: Partial<any> = {}) => ({
    at: Date.now(), sessionId: 's1', agent: 'claude' as const, model: 'haiku', role: 'execute',
    inTok: 10_000, outTok: 1_000, cacheReadTok: 0, cacheWriteTok: 0,
    costUsd: 0.001, costBasis: 'sdk' as const, ...over,
  });

  it('returns null when even one call in scope is unpriced', () => {
    const ledger = new CallLedger(join(tmp, 'ledger-unpriced'));
    ledger.record(rec()); ledger.record(rec()); ledger.record(rec());
    ledger.record(rec({ costUsd: null, costBasis: 'unknown' }));
    // Treating the unpriced call as free would flatter the saving by exactly
    // that call's cost.
    expect(ledger.savings({ sinceTs: 0, sessionId: 's1' }, cfg)).toBeNull();
  });
});
