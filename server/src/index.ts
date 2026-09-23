import { priceConflicts } from './pricing.js';
import { callLedger } from './ledger.js';
import { estimateWeights } from './quotaWeights.js';
import { logDecision, readDecisions, summarizeDecisions } from './decisions.js';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { loadConfig, repoRoot, saveConfig } from './config.js';
import { quotaStore } from './quota.js';
import { modelRegistry, classify, auditRoutes } from './registry.js';
import { capabilitiesFrom, reviewerFor, REVIEW_STRENGTH_LABEL } from './capabilities.js';
import { generateAvatar, listCustom, avatarDir, AvatarGenError } from './avatars.js';
import { refreshRegistry, startRegistryRefresh } from './registryFetch.js';
import { getGitDiff, getGitStatus, getGitSummaries, gitCommit, gitPush } from './git.js';
import { getLiveModels, type ModelOption } from './models.js';
import { initNotify, sendNotification, sendNotificationAsync } from './notify.js';
import { getRecentProjects, listClaudeSessions, listCodexSessions } from './resumable.js';
import { getClaudePreview, getCodexPreview } from './preview.js';
import { SessionManager } from './sessions.js';
import { getCachedUsage, refreshUsage } from './usage.js';
import { allPersonas, saveOverrides, loadOverrides, resetCrewCache, type Persona, DISPATCHER } from './crew.js';
import { loadMe, saveMe } from './me.js';
import type { AgentKind, ClientMessage } from './protocol.js';

const config = loadConfig();
initNotify(config);
const manager = new SessionManager(config);
manager.restore();
// Both spellings: renaming the variable without accepting the old one would
// silently drop an exported token and leave the server open.
const token = process.env.ROOST_TOKEN ?? process.env.POCKET_TOKEN;

/** Mounted external volumes, boot disk excluded — used both as folder-browser
 *  shortcuts and to default new setups onto external storage (e.g. a project SSD)
 *  instead of the user's home folder. */
function listVolumeShortcuts(): Array<{ name: string; path: string }> {
  const shortcuts: Array<{ name: string; path: string }> = [];
  try {
    for (const v of readdirSync('/Volumes', { withFileTypes: true })) {
      if (!v.name.startsWith('.')) {
        const full = join('/Volumes', v.name);
        if (realpathSync(full) !== '/') shortcuts.push({ name: v.name, path: full });
      }
    }
  } catch {
    /* no /Volumes on this platform */
  }
  return shortcuts;
}

function primaryVolume(): string | null {
  return listVolumeShortcuts()[0]?.path ?? null;
}

const app = express();
app.use(express.json({ limit: '30mb' }));

function authorized(req: express.Request): boolean {
  if (!token) return true;
  const header = req.headers.authorization;
  return header === `Bearer ${token}` || req.query.token === token;
}

/** Browser-origin defence. A same-origin page sends no Origin or one whose
 *  host matches ours; a cross-site page -- or a DNS-rebound one -- cannot forge
 *  that. Non-browser clients send no Origin and pass. Without this, a server
 *  running without ROOST_TOKEN could be driven by any web page the phone
 *  happened to visit, and "driven" here means running agents in full-auto. */
function originAllowed(req: { headers: Record<string, any> }): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(String(origin)).host === String(req.headers.host ?? '');
  } catch {
    return false;
  }
}

app.use('/api', (req, res, next) => {
  if (!authorized(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (req.method !== 'GET' && !originAllowed(req)) {
    res.status(403).json({ error: 'cross-origin request refused' });
    return;
  }
  next();
});

app.get('/api/config', async (_req, res) => {
  const live = await getLiveModels(config.projects[0] ?? repoRoot);
  const fallback = (models: string[]): ModelOption[] => models.map((m) => ({ id: m, label: m }));

  // Deduplicate models by id to prevent duplicate pills
  const dedup = (models: ModelOption[]): ModelOption[] => {
    const seen = new Set<string>();
    return models.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  };

  res.json({
    projects: config.projects,
    primaryVolume: primaryVolume(),
    sessionIdleTimeoutHours: config.sessionIdleTimeoutHours,
    notifications: config.notifications,
    claude: {
      ...config.claude,
      models: dedup(live.claude.length ? live.claude : fallback(config.claude.models))
    },
    codex: {
      ...config.codex,
      models: dedup(live.codex.length ? live.codex : fallback(config.codex.models))
    },
  });
});

app.get('/api/sessions', (_req, res) => {
  res.json({ sessions: manager.list() });
});

// Directory browser for the add-project flow (tailnet-only, like everything else here).
// Defaults onto an external volume (e.g. a project SSD) rather than the home folder, since
// that's where new projects are more often kept.
app.get('/api/browse', (req, res) => {
  const requested = String(req.query.path ?? '') || primaryVolume() || homedir();
  try {
    const path = realpathSync(requested);
    const entries = readdirSync(path, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => {
        const full = join(path, e.name);
        return { name: e.name, path: full, isRepo: existsSync(join(full, '.git')) };
      })
      .sort((a, b) => (a.isRepo === b.isRepo ? a.name.localeCompare(b.name) : a.isRepo ? -1 : 1));
    const shortcuts = [{ name: 'Home', path: homedir() }, ...listVolumeShortcuts()];
    res.json({ path, parent: dirname(path) !== path ? dirname(path) : null, dirs: entries, shortcuts });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message ?? err) });
  }
});

app.post('/api/projects', (req, res) => {
  const { path } = req.body ?? {};
  try {
    const resolved = realpathSync(String(path ?? ''));
    if (!statSync(resolved).isDirectory()) throw new Error('not a directory');
    if (!config.projects.includes(resolved)) {
      // Persist first, then mutate: a failed save used to leave the project in
      // memory, so the retry "succeeded" against state that never reached disk.
      const next = [...config.projects, resolved];
      saveConfig({ ...config, projects: next });
      config.projects = next;
    }
    res.json({ projects: config.projects });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message ?? err) });
  }
});

app.delete('/api/projects', (req, res) => {
  const path = String(req.query.path ?? '');
  const next = config.projects.filter((p) => p !== path);
  try {
    saveConfig({ ...config, projects: next });
  } catch (err: any) {
    res.status(500).json({ error: `could not save config: ${err?.message ?? err}` });
    return;
  }
  config.projects = next;
  res.json({ projects: config.projects });
});

app.get('/api/resumable', async (req, res) => {
  const agent = String(req.query.agent ?? '');
  const cwd = String(req.query.cwd ?? '');
  if ((agent !== 'claude' && agent !== 'codex') || !config.projects.includes(cwd)) {
    res.status(400).json({ error: 'agent must be claude|codex and cwd a configured project' });
    return;
  }
  try {
    // Both branches must be awaited — listCodexSessions returns a Promise (it's declared
    // async even though its body happens to be synchronous), and a bare ternary here
    // previously only awaited the Claude arm. The unresolved Promise then got JSON.stringify'd
    // as `{}` (Promises have no own enumerable properties) instead of the real array,
    // which crashed the client the moment it tried to .slice() a plain object.
    const sessions = agent === 'claude' ? await listClaudeSessions(cwd) : await listCodexSessions(cwd);
    res.json({ sessions });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

// Read-only recap of a past session — last few messages and touched files, pulled straight
// from the on-disk transcript. No agent process involved, so it costs nothing to check.
app.get('/api/preview', async (req, res) => {
  const agent = String(req.query.agent ?? '');
  const cwd = String(req.query.cwd ?? '');
  const id = String(req.query.id ?? '');
  if ((agent !== 'claude' && agent !== 'codex') || !config.projects.includes(cwd) || !id) {
    res.status(400).json({ error: 'agent must be claude|codex, cwd a configured project, and id required' });
    return;
  }
  try {
    const preview = agent === 'claude' ? await getClaudePreview(cwd, id) : getCodexPreview(cwd, id);
    res.json({ preview });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

app.post('/api/sessions', (req, res) => {
  const { agent, cwd, model, resume, title } = req.body ?? {};
  if (agent !== 'claude' && agent !== 'codex') {
    res.status(400).json({ error: 'agent must be "claude" or "codex"' });
    return;
  }
  if (typeof cwd !== 'string' || !config.projects.includes(cwd)) {
    res.status(400).json({ error: 'cwd must be one of the configured projects' });
    return;
  }
  // On resume, an explicit model continues to override; otherwise leave it unset so the
  // engine picks back up with whatever the original session was using, instead of forcing
  // today's default model onto yesterday's conversation.
  let session;
  try {
    session = manager.create(agent as AgentKind, cwd, { model: model || undefined, resume });
  } catch (err: any) {
    // A one-writer refusal is a 409 with the reason, not a 500.
    res.status(typeof err?.status === 'number' ? err.status : 500).json({ error: String(err?.message ?? err) });
    return;
  }
  if (resume && typeof title === 'string' && title) session.title = title;
  res.json({ session: session.meta() });
});

app.get('/api/recent', async (_req, res) => {
  try {
    res.json({ projects: await getRecentProjects(config.projects) });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

function guardProject(req: express.Request, res: express.Response): string | null {
  const cwd = String((req.method === 'GET' ? req.query.cwd : req.body?.cwd) ?? '');
  if (!config.projects.includes(cwd)) {
    res.status(400).json({ error: 'cwd must be a configured project' });
    return null;
  }
  return cwd;
}

app.get('/api/git/summaries', async (_req, res) => {
  try {
    res.json({ summaries: await getGitSummaries(config.projects) });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

app.get('/api/git', async (req, res) => {
  const cwd = guardProject(req, res);
  if (!cwd) return;
  try {
    res.json({ git: await getGitStatus(cwd) });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

app.get('/api/git/diff', async (req, res) => {
  const cwd = guardProject(req, res);
  if (!cwd) return;
  try {
    res.json({ diff: await getGitDiff(cwd, String(req.query.path ?? '')) });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

app.post('/api/git/commit', async (req, res) => {
  const cwd = guardProject(req, res);
  if (!cwd) return;
  const message = String(req.body?.message ?? '').trim();
  if (!message) {
    res.status(400).json({ error: 'commit message required' });
    return;
  }
  try {
    res.json({ output: await gitCommit(cwd, message) });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.stderr || err?.message || err) });
  }
});

app.post('/api/git/push', async (req, res) => {
  const cwd = guardProject(req, res);
  if (!cwd) return;
  try {
    res.json({ output: await gitPush(cwd) });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

app.post('/api/notifications', (req, res) => {
  const { topic, url } = req.body ?? {};
  if (typeof topic === 'string') config.notifications.topic = topic.trim();
  if (typeof url === 'string' && url.trim()) config.notifications.url = url.trim();
  saveConfig(config);
  res.json({ notifications: config.notifications });
});

app.post('/api/notifications/test', async (_req, res) => {
  if (!config.notifications.topic) {
    res.status(400).json({ error: 'notifications are not enabled' });
    return;
  }
  // Report what happened, not what was attempted: "sent" used to mean "asked".
  const r = await sendNotificationAsync(`test:${Date.now()}`, 'Roost test', 'Notifications are working.');
  if (!r.ok) {
    res.status(502).json({ error: r.error ?? 'notification was not accepted' });
    return;
  }
  res.json({ sent: true });
});

/** The operator's record: what the harness decided in the last day. */
app.get('/api/decisions', (req, res) => {
  const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 500));
  const rows = readDecisions(limit);
  const since = Date.now() - 24 * 3600_000;
  res.json({ summary: summarizeDecisions(rows, since), recent: rows.slice(-50) });
});

app.get('/api/usage', (_req, res) => {
  res.json({ usage: getCachedUsage() });
});

/** The crew roster: who each model is, what colour they wear. Defaults plus any
 *  user overrides, so the UI can render the editor against one list. */
// Custom avatars live in the data dir, not the bundle.
// Same auth as /api: this directory is written by the generator on request.
app.use('/avatars/custom', (req, res, next) => (authorized(req) ? next() : res.status(401).end()), express.static(avatarDir()));

app.get('/api/avatars', (_req, res) => {
  res.json({ custom: listCustom().map((c) => ({ ...c, url: `/avatars/custom/${c.file}` })) });
});

app.post('/api/avatars/generate', async (req, res) => {
  try {
    const file = await generateAvatar(String(req.body?.subject ?? ''), String(req.body?.color ?? ''));
    res.json({ ok: true, file, url: `/avatars/custom/${file}` });
  } catch (e: any) {
    // A bad request is the caller's fault; anything else is ours.
    const bad = e instanceof AvatarGenError;
    res.status(bad ? 400 : 500).json({ error: String(e?.message ?? e) });
  }
});

app.get('/api/models', (_req, res) => {
  const reg = modelRegistry();
  const models = reg.all().map((m) => ({ ...m, suggested: classify(m) }));
  const caps = capabilitiesFrom(reg.all(), (a) => reg.presence(a));
  res.json({
    fetchedAt: reg.fetchedAt(),
    models,
    // Configured routes that point at something deleted, superseded, or at an
    // effort level the model does not actually have.
    issues: auditRoutes(config.autoRoute as any, reg.all()),
    // What this user can actually do. A vendor absent here is one they are not
    // signed in to -- the UI must hide those features rather than grey them out
    // and imply the harness is broken.
    capabilities: { ...caps, reviewLabel: REVIEW_STRENGTH_LABEL[caps.reviewStrength] },
  });
});

app.get('/api/review-plan', (req, res) => {
  const agent = req.query.agent === 'codex' ? 'codex' : 'claude';
  const choice = reviewerFor({ agent, model: String(req.query.model ?? '') }, modelRegistry().all(), (a) => modelRegistry().presence(a));
  res.json({ ...choice, label: REVIEW_STRENGTH_LABEL[choice.strength] });
});

/** Measured window weights: percent of each window per million tokens, per
 *  model, fitted from the quota history against the ledger. null until there
 *  are enough single-model samples -- never a guess. */
app.get('/api/weights', (_req, res) => {
  const calls = callLedger()
    .since(0)
    .map((r) => ({ at: r.at, agent: r.agent, model: r.model, inTok: r.inTok, outTok: r.outTok, cacheReadTok: r.cacheReadTok, cacheWriteTok: r.cacheWriteTok }));
  res.json({ estimates: estimateWeights(quotaStore().history(), calls) });
});

/** Assign a live-roster model to a tier -- the one-tap answer to "a new model
 *  appeared" and to a route the audit found broken. Persists first, then
 *  updates the live config. Open sessions keep the routes they started with. */
app.post('/api/models/assign', (req, res) => {
  const { agent, tier, model } = req.body ?? {};
  if (agent !== 'claude' && agent !== 'codex') {
    res.status(400).json({ error: 'agent must be claude or codex' });
    return;
  }
  if (tier !== 'light' && tier !== 'standard' && tier !== 'heavy') {
    res.status(400).json({ error: 'tier must be light, standard or heavy' });
    return;
  }
  // Narrowed after the runtime checks above; req.body is `any`.
  const a = agent as AgentKind;
  const t = tier as 'light' | 'standard' | 'heavy';
  const card = modelRegistry().get(a, String(model ?? ''));
  if (!card) {
    res.status(400).json({ error: `${model} is not in the live ${a} roster` });
    return;
  }
  if (card.supersededBy) {
    res.status(400).json({ error: `${card.id} is superseded by ${card.supersededBy}` });
    return;
  }
  const next = { ...config.autoRoute, [a]: { ...config.autoRoute[a], [t]: { ...config.autoRoute[a][t], model: card.id } } };
  try {
    saveConfig({ ...config, autoRoute: next });
  } catch (err: any) {
    res.status(500).json({ error: `could not save config: ${err?.message ?? err}` });
    return;
  }
  config.autoRoute = next;
  logDecision({ kind: 'gate', rule: 'model-assign', agent: a, tier: t, model: card.id });
  res.json({ ok: true, autoRoute: config.autoRoute, note: 'Applies to new sessions; open sessions keep the routes they started with.' });
});

app.post('/api/models/refresh', async (_req, res) => {
  try {
    const changes = await refreshRegistry(config.projects[0] ?? process.cwd());
    res.json({ ok: true, changes });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.get('/api/me', (_req, res) => {
  res.json({ me: loadMe() });
});

app.post('/api/me', (req, res) => {
  try {
    res.json({ me: saveMe(req.body?.me ?? {}) });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

app.get('/api/crew', (_req, res) => {
  // The dispatcher is a role, not a routed model, so allPersonas() never lists it —
  // and the home screen's crew strip would have been missing the one it greets you with.
  res.json({ crew: allPersonas(), overrides: loadOverrides(), dispatcher: DISPATCHER });
});

app.post('/api/crew', (req, res) => {
  const rows = req.body?.overrides;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'overrides[] required' });
  const clean: Persona[] = [];
  for (const r of rows) {
    if (!r || typeof r.name !== 'string' || typeof r.match !== 'string') continue;
    if (!/^#[0-9a-fA-F]{6}$/.test(String(r.color ?? ''))) continue;
    clean.push({
      match: r.match,
      suite: r.suite === 'codex' ? 'codex' : r.suite === 'claude' ? 'claude' : undefined,
      name: r.name.slice(0, 40),
      tier: r.tier === 'flagship' ? 'flagship' : 'worker',
      color: r.color,
      avatar: typeof r.avatar === 'string' ? r.avatar.slice(0, 200) : undefined,
    });
  }
  saveOverrides(clean);
  resetCrewCache();
  res.json({ ok: true, crew: allPersonas() });
});

app.post('/api/usage/refresh', async (_req, res) => {
  try {
    res.json({ usage: await refreshUsage(config.projects[0] ?? repoRoot) });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

app.delete('/api/sessions/:id', (req, res) => {
  res.json({ closed: manager.close(req.params.id) });
});

// Serve the built web app when present (production mode).
const webDist = join(repoRoot, 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile(join(webDist, 'index.html')));
}

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws: WebSocket, req) => {
  const url = new URL(req.url ?? '/ws', 'http://localhost');
  if (token && url.searchParams.get('token') !== token) {
    ws.close(4001, 'unauthorized');
    return;
  }
  if (!originAllowed(req)) {
    ws.close(4003, 'cross-origin refused');
    return;
  }
  const sessionId = url.searchParams.get('session');
  const session = sessionId ? manager.get(sessionId) : undefined;
  if (!session) {
    ws.close(4004, 'unknown session');
    return;
  }
  session.attach(ws);
  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    // Shape check before anything downstream trusts it.
    if (!msg || typeof msg !== 'object' || typeof (msg as any).type !== 'string') return;
    void session.handleClientMessage(msg).catch((err) => {
      session.reportError(String(err?.message ?? err));
    });
  });
});

// A dead-but-attached socket suppressed approval and "done" push
// notifications, because a session with any socket assumes someone is
// watching. Ping every 30 s and drop whatever does not answer.
const alive = new WeakSet<WebSocket>();
wss.on('connection', (ws: WebSocket) => {
  alive.add(ws);
  ws.on('pong', () => alive.add(ws));
});
const keepalive = setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) {
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    ws.ping();
  }
}, 30_000);
keepalive.unref();

// Warm the model cache so the first phone load is instant.
void getLiveModels(config.projects[0] ?? repoRoot);

function printTailscaleUrl(port: number) {
  const candidates = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];
  const tryNext = (i: number) => {
    if (i >= candidates.length) {
      console.log('[roost] tailscale CLI not found — find your Mac\'s address in the Tailscale menu bar app');
      return;
    }
    execFile(candidates[i], ['ip', '-4'], (err, stdout) => {
      const ip = stdout?.trim().split('\n')[0] ?? '';
      if (!err && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) console.log(`[roost] on your phone, open:  http://${ip}:${port}`);
      else tryNext(i + 1);
    });
  };
  tryNext(0);
}

// A pending quota save is unref'd, so without this the most recent
// observation is lost on every exit -- and load() purges on restart, so the
// fuel gauge came back blank exactly when you'd open the app to look at it.
let flushed = false;
const flushState = () => {
  if (flushed) return;
  flushed = true;
  // Session state has its own unref'd 2 s debounce; without this it was lost
  // on every Ctrl-C while the quota store was dutifully flushed.
  try {
    manager.saveNow();
  } catch {
    /* shutdown is best effort */
  }
  try {
    quotaStore().flush();
  } catch {
    /* shutdown is best effort */
  }
};
process.on('beforeExit', flushState);
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    flushState();
    process.exit(0);
  });
}

httpServer.listen(config.port, '0.0.0.0', () => {
  console.log(`[roost] listening on http://localhost:${config.port}`);
  console.log(`[roost] projects: ${config.projects.join(', ')}`);
  if (!token) console.log('[roost] no ROOST_TOKEN set — keep this server tailnet-only');
  // A stale override outranking a published rate is a wrong number wearing an
  // authoritative label. It still wins — it is the person's file — but it says so.
  {
    const c = priceConflicts();
    for (const r of c.rows) {
      console.log(`[roost] price override /${r.match}/ from ${c.from} sets ${r.model} to $${r.override.input}/$${r.override.output}, published is $${r.table.input}/$${r.table.output}`);
    }
  }
  printTailscaleUrl(config.port);
  // Zero-token on both sides, so this costs nothing but keeps the roster live.
  startRegistryRefresh(config.projects[0] ?? process.cwd());
});
