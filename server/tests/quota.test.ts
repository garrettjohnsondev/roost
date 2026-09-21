import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'pocket-quota-'));
process.env.POCKET_CONFIG = join(tmp, 'pocket.config.json');
writeFileSync(process.env.POCKET_CONFIG, '{}');

const { QuotaStore, normalizePct } = await import('../src/quota.js');
const { loadConfig } = await import('../src/config.js');
const budget = loadConfig().budget;

let store: InstanceType<typeof QuotaStore>;
let n = 0;
beforeEach(() => {
  store = new QuotaStore(join(tmp, `d${n++}`));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const hoursFromNow = (h: number) => Math.floor((Date.now() + h * 3_600_000) / 1000);

describe('normalizePct', () => {
  it('accepts both 0-1 and 0-100 scales', () => {
    expect(normalizePct(0.83)).toBe(83);
    expect(normalizePct(83)).toBe(83);
    expect(normalizePct(null)).toBeNull();
    expect(normalizePct('nope')).toBeNull();
  });
});

describe('codex sparse updates', () => {
  // The live Pocket bug: `c.codex = codexSnapshotToUsage(snap)` replaced the whole
  // object, and account/rateLimits/updated is documented as a SPARSE rolling
  // update whose nulls must NOT clear previously observed values.
  it('a sparse push does not erase secondary or planType', () => {
    store.noteCodexSnapshot(
      { primary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: hoursFromNow(100) }, secondary: { usedPercent: 40, windowDurationMins: 300, resetsAt: hoursFromNow(2) }, planType: 'prolite' },
      { sparse: false },
    );
    store.noteCodexSnapshot({ primary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: hoursFromNow(100) }, secondary: null, planType: null }, { sparse: true });

    const keys = store.windows('codex').map((w) => w.key);
    expect(keys).toContain('codex:secondary');
    expect(store.agent('codex').planType).toBe('prolite');
    expect(store.agent('codex').windows['codex:primary'].usedPercent).toBe(12);
  });

  it('reads resetsAt as epoch SECONDS, not resets_in_seconds', () => {
    const at = hoursFromNow(3);
    store.noteCodexSnapshot({ primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: at } }, { sparse: false });
    expect(store.agent('codex').windows['codex:primary'].resetsAt).toBe(at * 1000);
  });
});

describe('headroom', () => {
  // THE six-week bug: agent-sync did `if (w.resetsAt && now > w.resetsAt) continue`,
  // so every expired window was skipped and an account with no live data read as
  // having room. Expired must purge to 'unknown', which is never headroom.
  it('an expired window purges to unknown — it is NOT room', () => {
    store.noteCodexSnapshot({ primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: hoursFromNow(-3) } }, { sparse: false });
    const h = store.headroom('codex', budget);
    expect(h.state).toBe('unknown');
    expect(store.windows('codex')).toHaveLength(0);
  });

  it('no data at all is unknown, not room', () => {
    expect(store.headroom('claude', budget).state).toBe('unknown');
  });

  it('ordinaryUsageAllowed=false means exhausted regardless of percentages', () => {
    store.noteCodexSnapshot({ primary: { usedPercent: 2, windowDurationMins: 10080, resetsAt: hoursFromNow(50) } }, { sparse: false });
    store.setCodexUsageAllowed(false);
    expect(store.headroom('codex', budget).state).toBe('exhausted');
  });

  it('ordinaryUsageAllowed=null never reads as allowed', () => {
    store.noteCodexSnapshot({ primary: { usedPercent: 2, windowDurationMins: 10080, resetsAt: hoursFromNow(50) } }, { sparse: false });
    store.setCodexUsageAllowed(null);
    expect(store.headroom('codex', budget).state).toBe('room'); // percentages still govern
    expect(store.agent('codex').usageAllowed).toBeNull();
  });

  it('maps thresholds to tight/gated/exhausted', () => {
    const at = (pct: number) => {
      const s = new QuotaStore(join(tmp, `t${pct}`));
      s.noteClaude({ rateLimitType: 'seven_day', utilization: pct, resetsAt: hoursFromNow(48), status: 'allowed' });
      return s.headroom('claude', budget).state;
    };
    expect(at(10)).toBe('room');
    expect(at(80)).toBe('tight');
    expect(at(92)).toBe('gated');
    expect(at(99)).toBe('exhausted');
  });

  it('keys Claude windows canonically so distinct windows never merge', () => {
    store.noteClaude({ rateLimitType: 'five_hour', utilization: 0.2, resetsAt: hoursFromNow(1) });
    store.noteClaude({ rateLimitType: 'seven_day', utilization: 0.9, resetsAt: hoursFromNow(80) });
    const keys = store.windows('claude').map((w) => w.key).sort();
    // Canonical names, not the event path's raw rateLimitType -- the usage
    // read describes these same two windows as session/weekly_all, and keying
    // on the raw type stored each limit twice.
    expect(keys).toEqual(['claude:session', 'claude:weekly_all']);
  });
});

describe('surplus (use-it-or-lose-it)', () => {
  it('flags a soon-resetting window with real headroom', () => {
    store.noteClaude({ rateLimitType: 'five_hour', utilization: 0.3, resetsAt: hoursFromNow(1) });
    const s = store.surplus('claude', budget);
    expect(s).not.toBeNull();
    expect(s!.headroomPct).toBe(70);
    expect(s!.minutesLeft).toBeLessThanOrEqual(60);
  });

  it('stays silent when a LONGER-horizon window is tight — the weekly guard', () => {
    store.noteClaude({ rateLimitType: 'five_hour', utilization: 0.3, resetsAt: hoursFromNow(1) });
    store.noteClaude({ rateLimitType: 'seven_day', utilization: 0.88, resetsAt: hoursFromNow(80) });
    expect(store.surplus('claude', budget)).toBeNull();
  });

  it('ignores windows that reset too far out to be use-it-or-lose-it', () => {
    store.noteClaude({ rateLimitType: 'seven_day', utilization: 0.1, resetsAt: hoursFromNow(80) });
    expect(store.surplus('claude', budget)).toBeNull();
  });

  it('ignores windows with nothing meaningful left', () => {
    store.noteClaude({ rateLimitType: 'five_hour', utilization: 0.95, resetsAt: hoursFromNow(1) });
    expect(store.surplus('claude', budget)).toBeNull();
  });
});

describe('claude structured usage read', () => {
  // Captured verbatim from a live SDK usage control request (Max plan). The
  // sibling keys are deliberately included: an earlier implementation iterated
  // rate_limits blindly and invented phantom "no data" windows out of `spend`,
  // `extra_usage`, `seven_day_breakdown` and a raft of null codename entries.
  const LIVE = {
    subscription_type: 'max',
    rate_limits_available: true,
    rate_limits: {
      cinder_cove: null,
      nimbus_quill: null,
      extra_usage: { is_enabled: false, monthly_limit: 10000, used_credits: 0, utilization: 0 },
      spend: { used: { amount_minor: 0 }, limit: { amount_minor: 10000 } },
      member_dashboard_available: false,
      seven_day_breakdown: { as_of: '2026-09-21T17:38:35Z', rows: [] },
      limits: [
        { kind: 'session', group: 'session', percent: 23, severity: 'normal', resets_at: '2026-09-21T21:30:00.400221+00:00', scope: null, is_active: true },
        { kind: 'weekly_all', group: 'weekly', percent: 3, severity: 'normal', resets_at: '2026-09-25T01:00:00.400240+00:00', scope: null, is_active: false },
        { kind: 'weekly_scoped', group: 'weekly', percent: 0, severity: 'normal', resets_at: '2026-09-25T01:00:00+00:00', scope: { model: { id: null, display_name: 'Fable' } }, is_active: false },
      ],
      model_scoped: [{ display_name: 'Fable', utilization: 0, resets_at: '2026-09-25T01:00:00+00:00' }],
    },
  };

  it('reads exactly the three real windows and no phantoms', () => {
    store.noteClaudeUsageRead(LIVE);
    const wins = store.windows('claude');
    expect(wins.map((w) => w.label).sort()).toEqual(['5-hour session', '7-day (Fable)', '7-day (all models)']);
    expect(wins.find((w) => w.label === '5-hour session')!.usedPercent).toBe(23);
    expect(wins.find((w) => w.label === '7-day (all models)')!.usedPercent).toBe(3);
  });

  it('takes percent as 0-100 without rescaling it', () => {
    store.noteClaudeUsageRead(LIVE);
    // 23 must not become 2300 or 0.23 — this path has no scale ambiguity.
    expect(store.windows('claude').find((w) => w.label === '5-hour session')!.usedPercent).toBe(23);
  });

  it('carries plan type and window durations', () => {
    store.noteClaudeUsageRead(LIVE);
    expect(store.agent('claude').planType).toBe('max');
    const wins = store.windows('claude');
    expect(wins.find((w) => w.label === '5-hour session')!.windowDurationMins).toBe(300);
    expect(wins.find((w) => w.label === '7-day (all models)')!.windowDurationMins).toBe(10080);
  });

  it('falls back to flat five_hour/seven_day keys when limits[] is absent', () => {
    store.noteClaudeUsageRead({ rate_limits: { five_hour: { utilization: 55, resets_at: '2026-09-25T01:00:00+00:00' }, spend: { used: 1 } } });
    const wins = store.windows('claude');
    expect(wins).toHaveLength(1);
    expect(wins[0].usedPercent).toBe(55);
  });
});

describe('claude window canonicalization', () => {
  // The exact eight rows observed in .pocket-data/quota-history.jsonl on
  // 2026-09-21: the streaming event path and the structured usage read each
  // described the same three limits in their own vocabulary.
  const events = [
    { rateLimitType: 'five_hour', utilization: 0.23, status: 'allowed' },
    { rateLimitType: 'seven_day', utilization: 0.03 },
    { rateLimitType: 'nimbus_quill', utilization: 0 },
  ];
  const usageRead = {
    rate_limits: {
      limits: [
        { kind: 'session', group: 'session', percent: 23, severity: 'normal' },
        { kind: 'weekly_all', group: 'weekly', percent: 4, severity: 'normal' },
        {
          kind: 'weekly_scoped', group: 'weekly', percent: 0, severity: 'normal',
          scope: { model: { display_name: 'Fable' } },
        },
      ],
    },
    rate_limits_available: true,
  };

  it('collapses both vocabularies onto one key per real limit', () => {
    for (const e of events) store.noteClaude(e);
    store.noteClaudeUsageRead(usageRead);
    const keys = store.windows('claude').map((w) => w.key).sort();
    // Three real limits, plus the unrecognized codename kept namespaced.
    expect(keys).toEqual([
      'claude:other:nimbus_quill',
      'claude:session',
      'claude:weekly_all',
      'claude:weekly_scoped:Fable',
    ]);
  });

  it('never stores five_hour and session as separate windows', () => {
    store.noteClaude({ rateLimitType: 'five_hour', utilization: 0.23 });
    store.noteClaudeUsageRead(usageRead);
    const sessions = store.windows('claude').filter((w) => w.windowDurationMins === 300);
    expect(sessions).toHaveLength(1);
  });

  it('lets the authoritative usage read win the 3%-vs-4% disagreement', () => {
    store.noteClaudeUsageRead(usageRead);
    store.noteClaude({ rateLimitType: 'seven_day', utilization: 0.03 });
    const weekly = store.windows('claude').find((w) => w.key === 'claude:weekly_all');
    expect(weekly?.usedPercent).toBe(4);
    expect(weekly?.source).toBe('sdk-usage');
  });

  it('keeps an unrecognized limit rather than over-reporting headroom', () => {
    store.noteClaude({ rateLimitType: 'brand_new_window', utilization: 0.97 });
    const w = store.windows('claude').find((x) => x.key === 'claude:other:brand_new_window');
    expect(w?.usedPercent).toBe(97);
    expect(w?.label).toMatch(/Unrecognized/);
  });
});

describe('flush on shutdown', () => {
  it('writes the latest observation synchronously', async () => {
    const dir = join(tmp, 'flush-test');
    const a = new QuotaStore(dir);
    a.noteClaudeUsageRead({
      rate_limits: { limits: [{ kind: 'session', group: 'session', percent: 55 }] },
      rate_limits_available: true,
    });
    a.flush();
    // A fresh store reading the same directory must see it -- previously the
    // unref'd 2s debounce meant exit dropped this entirely.
    const b = new QuotaStore(dir);
    expect(b.windows('claude').find((w) => w.key === 'claude:session')?.usedPercent).toBe(55);
  });
});
