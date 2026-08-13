import { query } from '@anthropic-ai/claude-agent-sdk';
import { JsonRpcProcess } from './jsonrpc.js';

export interface UsageWindow {
  label: string;
  usedPercent?: number;
  resetsAt?: number;
  status?: string;
}

export interface AgentUsage {
  windows: UsageWindow[];
  planType?: string;
  error?: string;
}

export interface UsageSnapshot {
  claude: AgentUsage;
  codex: AgentUsage;
  fetchedAt: number;
}

let cache: UsageSnapshot | null = null;

export function getCachedUsage(): UsageSnapshot | null {
  return cache;
}

function ensureCache(): UsageSnapshot {
  if (!cache) cache = { claude: { windows: [] }, codex: { windows: [] }, fetchedAt: Date.now() };
  return cache;
}

const CLAUDE_WINDOW_LABELS: Record<string, string> = {
  five_hour: '5-hour session',
  seven_day: '7-day (all models)',
  seven_day_opus: '7-day (Opus)',
  seven_day_sonnet: '7-day (Sonnet)',
  seven_day_overage_included: '7-day (overage)',
  overage: 'Overage',
};

function claudeInfoToWindow(info: any): { key: string; window: UsageWindow } {
  const key = info?.rateLimitType ?? 'unknown';
  return {
    key,
    window: {
      label: CLAUDE_WINDOW_LABELS[key] ?? key,
      resetsAt: info?.resetsAt ? info.resetsAt * 1000 : undefined,
      status: info?.status,
      usedPercent: typeof info?.utilization === 'number' ? Math.round(info.utilization * 100) : undefined,
    },
  };
}

function codexSnapshotToUsage(snap: any): AgentUsage {
  const windows: UsageWindow[] = [];
  const addWindow = (label: string, w: any) => {
    if (!w) return;
    windows.push({
      label: `${label} (${formatWindow(w.windowDurationMins)})`,
      usedPercent: typeof w.usedPercent === 'number' ? Math.round(w.usedPercent) : undefined,
      resetsAt: w.resetsAt ? w.resetsAt * 1000 : undefined,
    });
  };
  addWindow('Primary', snap?.primary);
  addWindow('Secondary', snap?.secondary);
  return { windows, planType: snap?.planType ?? undefined };
}

/** Passive update from a live Claude session's rate_limit_event — normal chatting keeps
 *  the usage panel fresh for free, no probe turn needed. */
export function noteClaudeRateLimit(info: any): void {
  const c = ensureCache();
  const { window } = claudeInfoToWindow(info);
  const existing = c.claude.windows.findIndex((w) => w.label === window.label);
  if (existing >= 0) c.claude.windows[existing] = window;
  else c.claude.windows.push(window);
  c.claude.error = undefined;
  c.fetchedAt = Date.now();
}

/** Passive update from a live Codex session's account/rateLimits/updated notification. */
export function noteCodexRateLimits(snap: any): void {
  if (!snap) return;
  const c = ensureCache();
  c.codex = codexSnapshotToUsage(snap);
  c.fetchedAt = Date.now();
}

/** Claude does not expose a numeric usage percentage via the SDK — only reset time
 *  and an allowed/warning/rejected status (the same signal /usage shows in the CLI).
 *  We spend the smallest possible turn (haiku, interrupted the instant the rate-limit
 *  event arrives) so a phone tap costs a fraction of a cent instead of a full reply. */
async function fetchClaudeUsage(cwd: string): Promise<AgentUsage> {
  const input = (async function* () {
    yield { type: 'user', message: { role: 'user', content: 'hi' }, parent_tool_use_id: null, session_id: '' };
    await new Promise(() => {}); // keep the generator open until we interrupt
  })();
  const q: any = query({ prompt: input as AsyncIterable<any>, options: { cwd, model: 'haiku' } as any });
  const seen = new Map<string, UsageWindow>();
  try {
    for await (const m of q) {
      if (m.type === 'rate_limit_event') {
        const { key, window } = claudeInfoToWindow(m.rate_limit_info ?? {});
        seen.set(key, window);
        void q.interrupt?.().catch(() => {});
      }
      if (m.type === 'result') break;
    }
  } catch (err: any) {
    if (seen.size === 0) return { windows: [], error: String(err?.message ?? err) };
  } finally {
    void q.interrupt?.().catch(() => {});
  }
  if (seen.size === 0) return { windows: [], error: 'No rate-limit data returned — is `claude` logged in?' };
  return { windows: [...seen.values()] };
}

async function fetchCodexUsage(cwd: string): Promise<AgentUsage> {
  const rpc = new JsonRpcProcess('codex', ['app-server'], cwd, {
    onRequest: async (method) => {
      throw new Error(`usage probe does not handle ${method}`);
    },
    onNotification: () => {},
    onExit: () => {},
  });
  try {
    await rpc.request('initialize', {
      clientInfo: { name: 'pocket', title: 'Pocket', version: '0.1.0' },
      capabilities: null,
    });
    rpc.notify('initialized');
    const res = await rpc.request('account/rateLimits/read', {});
    const snap = res?.rateLimits;
    if (!snap) return { windows: [], error: 'No rate-limit data returned — is `codex` logged in?' };
    return codexSnapshotToUsage(snap);
  } catch (err: any) {
    return { windows: [], error: String(err?.message ?? err) };
  } finally {
    rpc.kill();
  }
}

function formatWindow(mins: number | null | undefined): string {
  if (!mins) return 'window';
  if (mins % (24 * 60) === 0) return `${mins / (24 * 60)}d`;
  if (mins % 60 === 0) return `${mins / 60}h`;
  return `${mins}m`;
}

export async function refreshUsage(cwd: string): Promise<UsageSnapshot> {
  const [claude, codex] = await Promise.allSettled([fetchClaudeUsage(cwd), fetchCodexUsage(cwd)]);
  cache = {
    claude: claude.status === 'fulfilled' ? claude.value : { windows: [], error: String(claude.reason) },
    codex: codex.status === 'fulfilled' ? codex.value : { windows: [], error: String(codex.reason) },
    fetchedAt: Date.now(),
  };
  return cache;
}
