import { query } from '@anthropic-ai/claude-agent-sdk';
import { JsonRpcProcess } from './jsonrpc.js';
import { loadConfig } from './config.js';
import { quotaStore, type QuotaWindow } from './quota.js';
import type { AgentKind } from './protocol.js';

/** Wire shape for /api/usage. Kept backward-compatible with the existing
 *  UsagePanel (windows[] / planType / error) and extended with the fields the
 *  fuel gauge needs — every one of which may be null, because "unknown" is a
 *  real state that must never render as headroom. */
export interface UsageWindow {
  key: string;
  label: string;
  usedPercent: number | null;
  resetsAt: number | null;
  windowDurationMins: number | null;
  status?: string;
  observedAt: number;
  source: string;
}

export interface AgentUsage {
  windows: UsageWindow[];
  planType?: string;
  usageAllowed: boolean | null;
  error?: string;
  headroom?: string;
}

export interface UsageSnapshot {
  claude: AgentUsage;
  codex: AgentUsage;
  fetchedAt: number;
}

const toWire = (w: QuotaWindow): UsageWindow => ({
  key: w.key,
  label: w.label,
  usedPercent: w.usedPercent,
  resetsAt: w.resetsAt,
  windowDurationMins: w.windowDurationMins,
  status: w.status,
  observedAt: w.observedAt,
  source: w.source,
});

function view(agent: AgentKind): AgentUsage {
  const store = quotaStore();
  const bucket = store.agent(agent);
  const budget = loadConfig().budget;
  return {
    windows: store.windows(agent).map(toWire),
    planType: bucket.planType,
    usageAllowed: bucket.usageAllowed,
    error: bucket.error,
    headroom: store.headroom(agent, budget).state,
  };
}

export function getCachedUsage(): UsageSnapshot {
  return { claude: view('claude'), codex: view('codex'), fetchedAt: Date.now() };
}

/** Passive updates from live sessions — normal chatting keeps the gauge fresh
 *  for free. Both delegate to QuotaStore, which keys Claude windows by
 *  rateLimitType (not display label) and MERGES Codex snapshots rather than
 *  replacing them, per the documented sparse-rolling-update contract. */
export function noteClaudeRateLimit(info: any): void {
  quotaStore().noteClaude(info);
}

export function noteCodexRateLimits(snap: any): void {
  quotaStore().noteCodexSnapshot(snap, { sparse: true });
}

/** The SDK exposes structured /usage as a control request — numeric utilization
 *  per window, ISO resets, subscription type — for ZERO tokens. This is exactly
 *  the data agent-sync tried to scrape out of the CLI's TUI. The method name is
 *  explicitly marked unstable, so it is feature-detected and the token-spending
 *  haiku probe remains the permanent fallback. */
async function fetchClaudeUsage(cwd: string): Promise<{ ok: boolean; error?: string; via: string }> {
  const store = quotaStore();

  try {
    const probe: any = query({
      prompt: (async function* () {})(),
      options: { cwd, model: 'haiku', canUseTool: async () => ({ behavior: 'deny', message: 'usage probe' }) } as any,
    });
    const fn = probe?.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
    if (typeof fn === 'function') {
      const resp = await fn.call(probe, { skipBehaviors: true });
      void probe.interrupt?.().catch(() => {});
      if (resp?.rate_limits) {
        store.noteClaudeUsageRead(resp);
        store.setError('claude', undefined);
        return { ok: true, via: 'sdk-usage' };
      }
    } else {
      void probe.interrupt?.().catch(() => {});
    }
  } catch {
    /* fall through to the probe below */
  }

  // Fallback: spend the smallest possible turn and interrupt the instant the
  // rate-limit event lands.
  try {
    const input = (async function* () {
      yield { type: 'user', message: { role: 'user', content: 'hi' }, parent_tool_use_id: null, session_id: '' };
      await new Promise(() => {});
    })();
    const q: any = query({ prompt: input as AsyncIterable<any>, options: { cwd, model: 'haiku' } as any });
    let saw = false;
    try {
      for await (const m of q) {
        if (m.type === 'rate_limit_event') {
          store.noteClaude(m.rate_limit_info ?? {});
          saw = true;
          void q.interrupt?.().catch(() => {});
        }
        if (m.type === 'result') break;
      }
    } finally {
      void q.interrupt?.().catch(() => {});
    }
    if (!saw) {
      const err = 'No rate-limit data returned — is `claude` logged in?';
      store.setError('claude', err);
      return { ok: false, error: err, via: 'haiku-probe' };
    }
    store.setError('claude', undefined);
    return { ok: true, via: 'haiku-probe' };
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    store.setError('claude', msg);
    return { ok: false, error: msg, via: 'haiku-probe' };
  }
}

async function fetchCodexUsage(cwd: string): Promise<{ ok: boolean; error?: string }> {
  const store = quotaStore();
  // MCP servers are irrelevant to this probe and can add multi-second startup
  // delays (or hard errors) when one is unreachable — skip them entirely.
  const rpc = new JsonRpcProcess('codex', ['app-server', '-c', 'mcp_servers={}'], cwd, {
    onRequest: async (method) => {
      throw new Error(`usage probe does not handle ${method}`);
    },
    onNotification: () => {},
    onExit: () => {},
  });
  try {
    await rpc.request('initialize', { clientInfo: { name: 'pocket', title: 'Pocket', version: '0.1.0' }, capabilities: null });
    rpc.notify('initialized');
    const res = await rpc.request('account/rateLimits/read', {});
    const snap = res?.rateLimits;
    if (!snap) {
      const err = 'No rate-limit data returned — is `codex` logged in?';
      store.setError('codex', err);
      return { ok: false, error: err };
    }
    // A full read may legitimately clear fields a sparse push must not.
    store.noteCodexSnapshot(snap, { sparse: false });
    // Documented: "Null means unavailable; clients must not infer recovery from
    // percentages or reset times." So null stays null and never reads as yes.
    store.setCodexUsageAllowed(typeof res.ordinaryUsageAllowed === 'boolean' ? res.ordinaryUsageAllowed : null);
    store.setError('codex', undefined);
    return { ok: true };
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    store.setError('codex', msg);
    return { ok: false, error: msg };
  } finally {
    rpc.kill();
  }
}

export async function refreshUsage(cwd: string): Promise<UsageSnapshot> {
  await Promise.allSettled([fetchClaudeUsage(cwd), fetchCodexUsage(cwd)]);
  return getCachedUsage();
}
