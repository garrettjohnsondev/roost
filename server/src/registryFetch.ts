import { query } from '@anthropic-ai/claude-agent-sdk';
import { JsonRpcProcess } from './jsonrpc.js';
import { sendNotification } from './notify.js';
import { describeDrift, loadAliases, noteResolution, saveAliases } from './aliasDrift.js';
import {
  modelRegistry, fromCodexModelList, fromClaudeModelInfo,
  type ModelCard, type RegistryChange,
} from './registry.js';

/** Both fetches are ZERO TOKEN.
 *
 *  `model/list` is a local JSON-RPC call to codex app-server; it never reaches
 *  a model. `supportedModels()` is an SDK control request, the same class of
 *  call as the usage read -- no turn, no prompt, no billing. So the roster can
 *  be refreshed on a timer without spending any part of a window on it. */

export async function fetchCodexModels(cwd: string): Promise<ModelCard[]> {
  const rpc = new JsonRpcProcess('codex', ['app-server'], cwd, {
    onRequest: async () => null,
    onNotification: () => {},
    onExit: () => {},
  });
  try {
    await rpc.request('initialize', {
      clientInfo: { name: 'roost', title: 'Roost', version: '0.1.0' },
      capabilities: null,
    }, 20_000);
    rpc.notify('initialized');
    const res: any = await rpc.request('model/list', {}, 20_000);
    return fromCodexModelList(res?.data ?? []);
  } finally {
    rpc.kill();
  }
}

export async function fetchClaudeModels(cwd: string): Promise<ModelCard[]> {
  const probe: any = query({
    prompt: (async function* () {})(),
    options: { cwd, model: 'haiku', canUseTool: async () => ({ behavior: 'deny', message: 'registry probe' }) } as any,
  });
  try {
    if (typeof probe?.supportedModels !== 'function') return [];
    const rows = await probe.supportedModels();
    return fromClaudeModelInfo(rows ?? []);
  } finally {
    void probe?.interrupt?.().catch(() => {});
  }
}

/** One line a human can act on. */
export function describeChange(c: RegistryChange): string {
  switch (c.kind) {
    case 'added':
      return `New ${c.agent} model: ${c.displayName} (${c.id}) — suggested tier: ${c.suggested.tier ?? 'needs review'} (${c.suggested.why})`;
    case 'vanished':
      return `${c.agent} model ${c.id} is gone from the roster`;
    case 'superseded':
      return `${c.agent} ${c.id} is superseded by ${c.by}`;
    case 'resolved-moved':
      return `${c.agent} '${c.id}' now resolves to ${c.to} (was ${c.from}) — a new release`;
    case 'efforts-changed': {
      const bits = [c.added.length ? `+${c.added.join(',')}` : '', c.removed.length ? `-${c.removed.join(',')}` : ''].filter(Boolean);
      return `${c.agent} ${c.id} effort levels changed: ${bits.join(' ')}`;
    }
    case 'default-moved':
      return `${c.agent} default model moved to ${c.to}${c.from ? ` (was ${c.from})` : ''}`;
  }
}

/** A change worth waking someone's phone for. Effort-rung churn is not. */
function isNoteworthy(c: RegistryChange): boolean {
  return c.kind === 'added' || c.kind === 'superseded' || c.kind === 'resolved-moved' || c.kind === 'vanished';
}

export async function refreshRegistry(cwd: string): Promise<RegistryChange[]> {
  const reg = modelRegistry();
  const changes: RegistryChange[] = [];

  // Independently, so one vendor being down never erases the other's roster.
  const results = await Promise.allSettled([fetchCodexModels(cwd), fetchClaudeModels(cwd)]);
  const agents = ['codex', 'claude'] as const;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.length) {
      changes.push(...reg.update(agents[i], r.value));
      reg.noteFetch(agents[i], true);
    } else {
      // A failed or empty fetch is the absence signal §6 relies on. Keeping the
      // cached roster is right (a blip must not erase it); claiming the vendor
      // is present because a roster is cached was not.
      const why = r.status === 'rejected' ? String(r.reason?.message ?? r.reason) : 'empty roster';
      reg.noteFetch(agents[i], false, why);
      console.log(`[roost] ${agents[i]} model refresh failed: ${why}`);
    }
  });

  for (const c of changes) console.log(`[roost] ${describeChange(c)}`);

  // Alias drift, from the roster rather than from a chat turn.
  //
  // The session hook catches this too, but only once you next use an agent —
  // which is the wrong moment. The registry already knows: on 2026-09-22 the
  // roster's `opus[1m]` went from resolving to claude-opus-5 to claude-opus-5-5
  // with no id changing, and that is the only visible trace of a Claude release.
  // Checking it here means the announcement lands when the model changes, not
  // when you happen to open a session.
  {
    const store = loadAliases();
    const drifts: string[] = [];
    for (const card of reg.all()) {
      if (!card.resolvedId) continue;
      const d = noteResolution(store, { agent: card.agent, alias: card.id, resolved: card.resolvedId, at: Date.now() });
      if (d) drifts.push(describeDrift(d));
    }
    saveAliases(store);
    for (const line of drifts) console.log(`[roost] ${line}`);
    if (drifts.length) {
      sendNotification('alias-drift', drifts.length === 1 ? 'A model changed underneath an alias' : `${drifts.length} models changed`, drifts.join('\n'), { minIntervalMs: 60 * 60_000 });
    }
  }

  const loud = changes.filter(isNoteworthy);
  if (loud.length) {
    sendNotification(
      'model-registry',
      loud.length === 1 ? 'Model roster changed' : `${loud.length} model changes`,
      loud.map(describeChange).join('\n'),
      { minIntervalMs: 60 * 60_000 },
    );
  }
  return changes;
}

/** Refresh at startup and on a timer. Free, so cadence is a comfort choice. */
export function startRegistryRefresh(cwd: string, everyMs = 6 * 60 * 60_000): () => void {
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    refreshRegistry(cwd).catch((e) => console.log(`[roost] model refresh error: ${e?.message ?? e}`));
  };
  tick();
  const t = setInterval(tick, everyMs);
  t.unref?.();
  return () => { stopped = true; clearInterval(t); };
}
