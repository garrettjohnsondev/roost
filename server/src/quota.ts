import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir, type BudgetConfig } from './config.js';
import type { AgentKind } from './protocol.js';

export type WindowKey = string; // 'claude:five_hour' | 'codex:primary' | ...

export interface QuotaWindow {
  key: WindowKey;
  agent: AgentKind;
  label: string;
  /** null means UNKNOWN. It never means zero, and it never means headroom. */
  usedPercent: number | null;
  windowDurationMins: number | null;
  /** ms epoch */
  resetsAt: number | null;
  status?: 'allowed' | 'allowed_warning' | 'rejected';
  source: 'sdk-usage' | 'sdk-event' | 'codex-read' | 'codex-push' | 'manual';
  observedAt: number;
}

export interface AgentQuota {
  windows: Record<WindowKey, QuotaWindow>;
  planType?: string;
  /** Codex GetAccountRateLimitsResponse.ordinaryUsageAllowed. Its own docs say
   *  "Null means unavailable; clients must not infer recovery from percentages
   *  or reset times." So null must never read as yes. */
  usageAllowed: boolean | null;
  error?: string;
  lastFullReadAt?: number;
}

export type HeadroomState = 'room' | 'tight' | 'gated' | 'exhausted' | 'unknown' | 'stale';

export interface Headroom {
  state: HeadroomState;
  worstPercent: number | null;
  worstWindow?: QuotaWindow;
  ageMins: number | null;
  reason: string;
}

/** A use-it-or-lose-it window: resetting soon with real headroom left, and no
 *  longer-horizon window under pressure. */
export interface Surplus {
  agent: AgentKind;
  window: QuotaWindow;
  headroomPct: number;
  minutesLeft: number;
  reason: string;
}

const USAGE_AUTHORITY_MS = 10 * 60_000;

/** Siblings of the window keys that carry a `utilization` but are not
 *  rate-limit windows. Iterated blindly, extra_usage became a phantom window. */
const NOT_WINDOWS = new Set(['extra_usage', 'spend', 'seven_day_breakdown', 'model_scoped', 'member_dashboard_available']);

const CLAUDE_WINDOW_LABELS: Record<string, string> = {
  five_hour: '5-hour session',
  seven_day: '7-day (all models)',
  seven_day_opus: '7-day (Opus)',
  seven_day_sonnet: '7-day (Sonnet)',
  seven_day_oauth_apps: '7-day (apps)',
  seven_day_overage_included: '7-day (with extra usage)',
  overage: 'Overage',
};

/** Claude reports the SAME limits under two vocabularies. The streaming
 *  `rate_limit_event` keys on `rateLimitType` (five_hour, seven_day,
 *  seven_day_<model>, plus raw model codenames like `nimbus_quill`); the
 *  structured usage read keys on `kind` (session, weekly_all, weekly_scoped).
 *  Stored verbatim, three real windows became seven — and the two seven-day
 *  rows disagreed (3% vs 4%), so `headroom()` gated on whichever landed last.
 *  One limit must be one key, whichever path observed it. */
export function canonicalClaudeKey(
  kind: unknown,
  scopedModel?: string | null,
): { key: WindowKey; label: string; durationMins: number | null } {
  const k = String(kind ?? 'unknown');
  if (scopedModel) {
    return { key: `claude:weekly_scoped:${scopedModel}`, label: `7-day (${scopedModel})`, durationMins: 10080 };
  }
  if (k === 'five_hour' || k === 'session') {
    return { key: 'claude:session', label: '5-hour session', durationMins: 300 };
  }
  if (k === 'seven_day' || k === 'weekly_all') {
    return { key: 'claude:weekly_all', label: '7-day (all models)', durationMins: 10080 };
  }
  const m = /^seven_day_(.+)$/.exec(k);
  if (m) {
    // The label map first, then words: "Overage_included" leaked onto the
    // phone as a raw key (item 36). The KEY keeps its old spelling so stored
    // readings still line up.
    const name = m[1].replace(/^./, (c) => c.toUpperCase());
    const label = CLAUDE_WINDOW_LABELS[k] ?? `7-day (${m[1].replace(/_/g, ' ')})`;
    return { key: `claude:weekly_scoped:${name}`, label, durationMins: 10080 };
  }
  // An unrecognized kind carrying a real percentage is still a real limit, and
  // dropping it would over-report headroom. Keep it, but namespaced and
  // labelled as unrecognized so it can never be mistaken for a known window.
  return { key: `claude:other:${k}`, label: `Unrecognized limit (${k})`, durationMins: null };
}

export function formatWindow(mins: number | null | undefined): string {
  if (!mins) return 'window';
  if (mins % (24 * 60) === 0) return `${mins / (24 * 60)}d`;
  if (mins % 60 === 0) return `${mins / 60}h`;
  return `${mins}m`;
}

/** The SDK does not document whether utilization is 0-1 or 0-100, and the
 *  structured usage response IS documented 0-100. Accept both; anything <= 1 is
 *  treated as a fraction. Warned once so a real 1%-used window is noticed. */
let ambiguousPctWarned = false;
export function normalizePct(v: unknown): number | null {
  if (typeof v !== 'number' || Number.isNaN(v)) return null;
  if (v > 1) return Math.min(100, Math.round(v));
  if (v > 0 && !ambiguousPctWarned) {
    ambiguousPctWarned = true;
    console.warn(`[roost] rate-limit utilization ${v} is <= 1 — treating as a fraction (=> ${Math.round(v * 100)}%). If windows read too low, the scale changed.`);
  }
  return Math.min(100, Math.round(v * 100));
}

/** For fields the SDK DOCUMENTS as 0-100 (the structured usage read's
 *  `percent`, and its flat-key `utilization`). normalizePct's fraction
 *  heuristic turned an honest 1% into 100% -- exactly the value a window shows
 *  right after a reset -- and the authority guard then protected the wrong
 *  number for ten minutes. A documented scale needs a clamp, not a guess. */
export function clampPct(v: unknown): number | null {
  if (typeof v !== 'number' || Number.isNaN(v)) return null;
  return Math.min(100, Math.max(0, Math.round(v)));
}

function emptyAgent(): AgentQuota {
  return { windows: {}, usageAllowed: null };
}

export class QuotaStore {
  private claude: AgentQuota = emptyAgent();
  private codex: AgentQuota = emptyAgent();
  private saveTimer: NodeJS.Timeout | null = null;
  private historyBuf: string[] = [];

  constructor(private readonly dir = dataDir()) {
    this.load();
  }

  private file() {
    return join(this.dir, 'windows.json');
  }
  private historyFile() {
    return join(this.dir, 'quota-history.jsonl');
  }

  agent(kind: AgentKind): AgentQuota {
    return kind === 'claude' ? this.claude : this.codex;
  }

  // ---------- ingestion ----------

  /** From a live session's SDK rate_limit_event. Keyed on rateLimitType, NOT on
   *  the display label — label collisions silently merged distinct windows. */
  noteClaude(info: any): void {
    const { key, label, durationMins } = canonicalClaudeKey(info?.rateLimitType);
    // The usage read's `percent` is unambiguously 0-100; this event's
    // `utilization` is a 0-1/0-100 guess. Never let the guess overwrite a
    // recent authoritative read of the same window.
    const prev = this.claude.windows[key];
    // A denial is the one thing the streaming event knows first. It must never
    // be held back behind a ten-minute-old "allowed" from the usage read.
    const denied = info?.status === 'rejected';
    if (!denied && prev?.source === 'sdk-usage' && Date.now() - prev.observedAt < USAGE_AUTHORITY_MS) return;
    this.upsert('claude', key, {
      label,
      usedPercent: normalizePct(info?.utilization),
      windowDurationMins: durationMins,
      resetsAt: typeof info?.resetsAt === 'number' ? info.resetsAt * 1000 : null,
      status: info?.status,
      source: 'sdk-event',
    });
  }

  /** From the SDK's structured usage control request.
   *
   *  The authoritative payload is `rate_limits.limits[]`, each entry shaped
   *  { kind, group, percent, severity, resets_at, scope, is_active } — `percent`
   *  is already 0-100, so this path has none of the 0-1/0-100 ambiguity that
   *  makes the rate_limit_event `utilization` field a guess. The sibling keys
   *  (spend, extra_usage, seven_day_breakdown, member_dashboard_available, and a
   *  raft of null codename entries) are NOT windows and must not be iterated
   *  blindly — doing so invented phantom "no data" rows. */
  noteClaudeUsageRead(resp: any): void {
    const limits = resp?.rate_limits;
    const rows: any[] = Array.isArray(limits?.limits) ? limits.limits : [];

    for (const row of rows) {
      if (!row || typeof row.percent !== 'number') continue;
      const { key, label, durationMins } = canonicalClaudeKey(row.kind, row.scope?.model?.display_name);
      this.upsert('claude', key, {
        label,
        usedPercent: clampPct(row.percent),
        windowDurationMins:
          row.group === 'session' ? 300 : row.group === 'weekly' ? 10080 : durationMins,
        resetsAt: row.resets_at ? Date.parse(row.resets_at) || null : null,
        status: row.severity === 'normal' ? 'allowed' : row.severity ? 'allowed_warning' : undefined,
        source: 'sdk-usage',
      });
    }

    // Fallback for SDK shapes that predate limits[]: the flat five_hour /
    // seven_day* keys. Only objects carrying a utilization are windows.
    if (!rows.length && limits && typeof limits === 'object') {
      for (const [type, w] of Object.entries<any>(limits)) {
        if (!w || typeof w !== 'object' || typeof w.utilization !== 'number') continue;
        if (NOT_WINDOWS.has(type)) continue;
        const canon = canonicalClaudeKey(type);
        this.upsert('claude', canon.key, {
          label: canon.label,
          usedPercent: clampPct(w.utilization),
          windowDurationMins: canon.durationMins,
          resetsAt: w.resets_at ? Date.parse(w.resets_at) || null : null,
          source: 'sdk-usage',
        });
      }
    }

    if (resp?.subscription_type) this.claude.planType = String(resp.subscription_type);
    this.claude.usageAllowed = resp?.rate_limits_available === true ? true : null;
    this.claude.lastFullReadAt = Date.now();
    this.claude.error = undefined;
    this.persist();
  }

  /** Codex snapshot. `account/rateLimits/updated` is documented as a SPARSE
   *  rolling update whose null fields must NOT clear previously observed values,
   *  so a sparse push merges and only a full read may clear. */
  noteCodexSnapshot(snap: any, opts: { sparse: boolean }): void {
    if (!snap) return;
    const put = (slot: 'primary' | 'secondary', w: any) => {
      if (!w) {
        if (!opts.sparse) delete this.codex.windows[`codex:${slot}`];
        return;
      }
      this.upsert('codex', `codex:${slot}`, {
        label: `${slot === 'primary' ? 'Primary' : 'Secondary'} (${formatWindow(w.windowDurationMins)})`,
        // Codex documents usedPercent as 0-100 (RateLimitWindow in its own
        // generated schema). The fraction guess read an honest 1% -- a window
        // just after its weekly reset -- as 100%, and Codex sat "used up" and
        // benched for two days (2026-09-26 → 28). A documented scale is clamped.
        usedPercent: clampPct(w.usedPercent),
        windowDurationMins: typeof w.windowDurationMins === 'number' ? w.windowDurationMins : null,
        resetsAt: typeof w.resetsAt === 'number' ? w.resetsAt * 1000 : null,
        source: opts.sparse ? 'codex-push' : 'codex-read',
      });
    };
    put('primary', snap.primary);
    put('secondary', snap.secondary);
    if (snap.planType != null) this.codex.planType = String(snap.planType);
    if (!opts.sparse) this.codex.lastFullReadAt = Date.now();
    this.codex.error = undefined;
    this.persist();
  }

  setCodexUsageAllowed(v: boolean | null): void {
    this.codex.usageAllowed = v;
    this.persist();
  }

  setError(agent: AgentKind, error: string | undefined): void {
    this.agent(agent).error = error;
    this.persist();
  }

  private upsert(agent: AgentKind, key: WindowKey, patch: Partial<QuotaWindow> & { label: string; source: QuotaWindow['source'] }): void {
    const bucket = this.agent(agent);
    const prev = bucket.windows[key];
    const next: QuotaWindow = {
      key,
      agent,
      label: patch.label,
      // A sparse update that omits a value must not erase what we already knew.
      usedPercent: patch.usedPercent ?? prev?.usedPercent ?? null,
      windowDurationMins: patch.windowDurationMins ?? prev?.windowDurationMins ?? null,
      resetsAt: patch.resetsAt ?? prev?.resetsAt ?? null,
      status: patch.status ?? prev?.status,
      source: patch.source,
      // A sparse update that carried the percent over from the previous
      // observation must not re-stamp it as fresh: that hid staleness, and a
      // stale percent then read as live headroom.
      observedAt: patch.usedPercent != null ? Date.now() : (prev?.observedAt ?? Date.now()),
    };
    bucket.windows[key] = next;
    if (next.usedPercent != null && next.usedPercent !== prev?.usedPercent) {
      this.appendHistory({ at: next.observedAt, agent, key, usedPercent: next.usedPercent });
    }
    this.persist();
  }

  // ---------- reading ----------

  /** Expired windows are PURGED, not skipped. agent-sync skipped them
   *  (`if (resetsAt && now > resetsAt) continue`), which made a stale window read
   *  as "no pressure" and left quota gating inert for six weeks. */
  private live(agent: AgentKind): QuotaWindow[] {
    const bucket = this.agent(agent);
    const now = Date.now();
    for (const [key, w] of Object.entries(bucket.windows)) {
      if (w.resetsAt && now > w.resetsAt) delete bucket.windows[key];
    }
    return Object.values(bucket.windows);
  }

  windows(agent: AgentKind): QuotaWindow[] {
    return this.live(agent).sort((a, b) => (b.usedPercent ?? -1) - (a.usedPercent ?? -1));
  }

  headroom(agent: AgentKind, budget: BudgetConfig): Headroom {
    const bucket = this.agent(agent);
    const wins = this.live(agent);
    const known = wins.filter((w) => w.usedPercent != null);
    // Age is read from the windows that carry a number. A window that never
    // reports a percent (e.g. "Unrecognized limit") sat at its first sighting
    // for days and made fresh Claude readings look 5 days stale, which sent
    // builds to Codex for no reason (2026-09-29).
    const aged = known.length ? known : wins;
    const oldest = aged.length ? Math.min(...aged.map((w) => w.observedAt)) : null;
    const ageMins = oldest == null ? null : Math.round((Date.now() - oldest) / 60000);

    // An explicit denial outranks everything, including having no percentages
    // at all: a provider saying "no" with no number attached is still a "no".
    // These used to sit below the no-percentages early return, so a denial
    // with no percent read as 'unknown'.
    if (bucket.usageAllowed === false) {
      return { state: 'exhausted', worstPercent: known[0]?.usedPercent ?? null, ageMins, reason: 'provider reports ordinary usage not allowed' };
    }
    const rejected = wins.find((w) => w.status === 'rejected');
    if (rejected) {
      return { state: 'exhausted', worstPercent: rejected.usedPercent, worstWindow: rejected, ageMins, reason: `${rejected.label} rejected by provider` };
    }
    if (!known.length) {
      return { state: 'unknown', worstPercent: null, ageMins, reason: wins.length ? 'no usage percentages reported' : 'no live quota data' };
    }

    const worst = known.reduce((a, b) => ((a.usedPercent ?? 0) >= (b.usedPercent ?? 0) ? a : b));
    const pct = worst.usedPercent!;

    if (pct >= budget.hardStopPct) {
      return { state: 'exhausted', worstPercent: pct, worstWindow: worst, ageMins, reason: `${worst.label} at ${pct}%` };
    }
    if (ageMins != null && ageMins > budget.staleAfterMins) {
      return { state: 'stale', worstPercent: pct, worstWindow: worst, ageMins, reason: `last observed ${ageMins}m ago` };
    }
    if (pct >= budget.gateAtPct) return { state: 'gated', worstPercent: pct, worstWindow: worst, ageMins, reason: `${worst.label} at ${pct}%` };
    if (pct >= budget.reprioritizeAtPct) return { state: 'tight', worstPercent: pct, worstWindow: worst, ageMins, reason: `${worst.label} at ${pct}%` };
    return { state: 'room', worstPercent: pct, worstWindow: worst, ageMins, reason: `${worst.label} at ${pct}%` };
  }

  /** Use-it-or-lose-it. A window resetting soon with real unused headroom is
   *  free capacity that vanishes — but only if no LONGER-horizon window is under
   *  pressure, otherwise "spending" it just eats next week's budget. */
  surplus(agent: AgentKind, budget: BudgetConfig): Surplus | null {
    // A stale percent is not use-it-or-lose-it headroom; it is a guess about a
    // window we have not seen lately. Same freshness rule headroom() applies.
    const freshBefore = Date.now() - budget.staleAfterMins * 60_000;
    const wins = this.live(agent).filter((w) => w.usedPercent != null && w.resetsAt && w.observedAt >= freshBefore);
    let best: Surplus | null = null;
    for (const w of wins) {
      // Weekly windows only (2026-09-24). A 5-hour session window resets
      // every few hours whatever you do; nagging about it, without the weekly
      // picture, was noise. What is worth acting on is a WEEK of quota about
      // to vanish unused.
      if ((w.windowDurationMins ?? 0) < 7 * 24 * 60) continue;
      const minutesLeft = Math.round((w.resetsAt! - Date.now()) / 60000);
      if (minutesLeft <= 0 || minutesLeft > budget.surplusWithinMins) continue;
      const headroomPct = 100 - w.usedPercent!;
      if (headroomPct < budget.surplusHeadroomPct) continue;

      const longerTight = wins.some(
        (o) =>
          o.key !== w.key &&
          (o.windowDurationMins ?? 0) > (w.windowDurationMins ?? 0) &&
          o.usedPercent != null &&
          o.usedPercent >= budget.reprioritizeAtPct,
      );
      if (longerTight) continue;

      const cand: Surplus = {
        agent,
        window: w,
        headroomPct,
        minutesLeft,
        reason: `${headroomPct}% of ${w.label} is unused and resets in ${formatWindow(minutesLeft)}`,
      };
      if (!best || cand.headroomPct > best.headroomPct) best = cand;
    }
    return best;
  }

  /** %/hour from observed samples inside the current window. null when there
   *  isn't enough signal — never a fabricated zero. */
  burnPctPerHour(agent: AgentKind, key: WindowKey): number | null {
    const samples = this.readHistory().filter((h) => h.agent === agent && h.key === key);
    if (samples.length < 2) return null;
    const spanMs = samples[samples.length - 1].at - samples[0].at;
    if (spanMs < 10 * 60_000) return null;
    const n = samples.length;
    const meanX = samples.reduce((s, p) => s + p.at, 0) / n;
    const meanY = samples.reduce((s, p) => s + p.usedPercent, 0) / n;
    let num = 0;
    let den = 0;
    for (const p of samples) {
      num += (p.at - meanX) * (p.usedPercent - meanY);
      den += (p.at - meanX) ** 2;
    }
    if (den === 0) return null;
    const perMs = num / den;
    const perHour = perMs * 3_600_000;
    return perHour > 0 ? +perHour.toFixed(2) : null;
  }

  projectedExhaustionAt(agent: AgentKind, key: WindowKey): number | null {
    const slope = this.burnPctPerHour(agent, key);
    const w = this.agent(agent).windows[key];
    if (!slope || !w || w.usedPercent == null) return null;
    const hoursLeft = (100 - w.usedPercent) / slope;
    return Date.now() + hoursLeft * 3_600_000;
  }

  // ---------- persistence ----------

  private appendHistory(row: { at: number; agent: AgentKind; key: string; usedPercent: number }): void {
    this.historyBuf.push(JSON.stringify(row));
    try {
      mkdirSync(this.dir, { recursive: true });
      appendFileSync(this.historyFile(), this.historyBuf.join('\n') + '\n');
      this.historyBuf = [];
    } catch {
      /* best effort; keep buffering */
    }
  }

  /** Every recorded observation, oldest first. Fitted against the ledger by
   *  quotaWeights.ts. */
  history(): Array<{ at: number; agent: AgentKind; key: string; usedPercent: number }> {
    return this.readHistory();
  }

  private readHistory(): Array<{ at: number; agent: AgentKind; key: string; usedPercent: number }> {
    try {
      if (!existsSync(this.historyFile())) return [];
      return readFileSync(this.historyFile(), 'utf8')
        .split('\n')
        .filter(Boolean)
        .slice(-20_000)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean) as any[];
    } catch {
      return [];
    }
  }

  private persist(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.writeNow(), 2000);
    // unref'd so a pending save never holds the process open -- which is
    // exactly why shutdown MUST call flush(). Without it the last observation
    // before exit was silently dropped, and since load() purges on restart,
    // Claude quota came back up as `unknown` every single time.
    this.saveTimer.unref?.();
  }

  /** Write pending state synchronously. Call on shutdown. */
  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.writeNow();
  }

  private writeNow(): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      const tmp = this.file() + '.tmp';
      writeFileSync(tmp, JSON.stringify({ version: 1, claude: this.claude, codex: this.codex }, null, 2));
      renameSync(tmp, this.file());
    } catch {
      /* persistence is best effort */
    }
  }

  private load(): void {
    try {
      if (!existsSync(this.file())) return;
      const parsed = JSON.parse(readFileSync(this.file(), 'utf8'));
      if (parsed?.claude) this.claude = { ...emptyAgent(), ...parsed.claude };
      if (parsed?.codex) this.codex = { ...emptyAgent(), ...parsed.codex };
      // Purge anything that reset while we were down, so a restart can never
      // resurrect a six-week-old window as apparent headroom.
      this.live('claude');
      this.live('codex');
    } catch {
      /* start empty */
    }
  }
}

let singleton: QuotaStore | null = null;
export function quotaStore(): QuotaStore {
  if (!singleton) singleton = new QuotaStore();
  return singleton;
}
export function __resetQuotaStoreForTests(): void {
  singleton = null;
}
