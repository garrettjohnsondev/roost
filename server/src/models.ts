import { query } from '@anthropic-ai/claude-agent-sdk';
import { JsonRpcProcess } from './jsonrpc.js';
import { AsyncQueue } from './util.js';

export interface ModelOption {
  id: string;
  label: string;
  efforts?: string[];
  /** Canonical wire id this option resolves to (e.g. 'opus' -> 'claude-opus-5'). */
  resolvedModel?: string;
}

interface ModelCache {
  claude: ModelOption[];
  codex: ModelOption[];
  fetchedAt: number;
}

const TTL_MS = 60 * 60 * 1000;
let cache: ModelCache | null = null;
let inflight: Promise<ModelCache> | null = null;

async function fetchClaudeModels(cwd: string): Promise<ModelOption[]> {
  const input = new AsyncQueue<any>();
  const q: any = query({
    prompt: input as AsyncIterable<any>,
    options: {
      cwd,
      // Probe session: never sends a message, so keep it inert and cheap.
      canUseTool: async () => ({ behavior: 'deny', message: 'model probe' }),
    } as any,
  });
  try {
    const models: any[] = await q.supportedModels();
    return models.map((m) => ({
      id: m.value,
      label: m.displayName || m.value,
      efforts: m.supportedEffortLevels,
      resolvedModel: m.resolvedModel,
    }));
  } finally {
    input.close();
    void q.interrupt?.().catch(() => {});
  }
}

async function fetchCodexModels(cwd: string): Promise<ModelOption[]> {
  const rpc = new JsonRpcProcess('codex', ['app-server'], cwd, {
    onRequest: async (method) => {
      throw new Error(`model probe does not handle ${method}`);
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
    const res = await rpc.request('model/list', { includeHidden: false });
    return (res?.data ?? [])
      .filter((m: any) => !m.hidden)
      .map((m: any) => ({
        id: m.model || m.id,
        label: m.displayName || m.model || m.id,
        efforts: (m.supportedReasoningEfforts ?? [])
          .map((o: any) => (typeof o === 'string' ? o : o?.effort ?? o?.reasoningEffort))
          .filter(Boolean),
      }));
  } finally {
    rpc.kill();
  }
}

/** Live model lists from both agents, cached for an hour. Failures resolve to []
 *  so the caller can fall back to the static config lists. */
export function getLiveModels(cwd: string): Promise<ModelCache> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = (async () => {
    const [claude, codex] = await Promise.allSettled([fetchClaudeModels(cwd), fetchCodexModels(cwd)]);
    if (claude.status === 'rejected') console.warn('[pocket] claude model list failed:', String(claude.reason));
    if (codex.status === 'rejected') console.warn('[pocket] codex model list failed:', String(codex.reason));
    cache = {
      claude: claude.status === 'fulfilled' ? claude.value : [],
      codex: codex.status === 'fulfilled' ? codex.value : [],
      fetchedAt: Date.now(),
    };
    inflight = null;
    return cache;
  })();
  return inflight;
}
