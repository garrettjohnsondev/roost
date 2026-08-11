import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { loadConfig, repoRoot, saveConfig } from './config.js';
import { getLiveModels, type ModelOption } from './models.js';
import { getRecentProjects, listClaudeSessions, listCodexSessions } from './resumable.js';
import { getClaudePreview, getCodexPreview } from './preview.js';
import { SessionManager } from './sessions.js';
import { getCachedUsage, refreshUsage } from './usage.js';
import type { AgentKind, ClientMessage } from './protocol.js';

const config = loadConfig();
const manager = new SessionManager(config);
const token = process.env.POCKET_TOKEN;

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

app.use('/api', (req, res, next) => {
  if (!authorized(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
});

app.get('/api/config', async (_req, res) => {
  const live = await getLiveModels(config.projects[0] ?? repoRoot);
  const fallback = (models: string[]): ModelOption[] => models.map((m) => ({ id: m, label: m }));
  res.json({
    projects: config.projects,
    primaryVolume: primaryVolume(),
    sessionIdleTimeoutHours: config.sessionIdleTimeoutHours,
    claude: { ...config.claude, models: live.claude.length ? live.claude : fallback(config.claude.models) },
    codex: { ...config.codex, models: live.codex.length ? live.codex : fallback(config.codex.models) },
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
      config.projects.push(resolved);
      saveConfig(config);
    }
    res.json({ projects: config.projects });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message ?? err) });
  }
});

app.delete('/api/projects', (req, res) => {
  const path = String(req.query.path ?? '');
  config.projects = config.projects.filter((p) => p !== path);
  saveConfig(config);
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
  const session = manager.create(agent as AgentKind, cwd, { model: model || undefined, resume });
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

app.get('/api/usage', (_req, res) => {
  res.json({ usage: getCachedUsage() });
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
    void session.handleClientMessage(msg).catch((err) => {
      session.reportError(String(err?.message ?? err));
    });
  });
});

// Warm the model cache so the first phone load is instant.
void getLiveModels(config.projects[0] ?? repoRoot);

function printTailscaleUrl(port: number) {
  const candidates = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];
  const tryNext = (i: number) => {
    if (i >= candidates.length) {
      console.log('[pocket] tailscale CLI not found — find your Mac\'s address in the Tailscale menu bar app');
      return;
    }
    execFile(candidates[i], ['ip', '-4'], (err, stdout) => {
      const ip = stdout?.trim().split('\n')[0] ?? '';
      if (!err && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) console.log(`[pocket] on your phone, open:  http://${ip}:${port}`);
      else tryNext(i + 1);
    });
  };
  tryNext(0);
}

httpServer.listen(config.port, '0.0.0.0', () => {
  console.log(`[pocket] listening on http://localhost:${config.port}`);
  console.log(`[pocket] projects: ${config.projects.join(', ')}`);
  if (!token) console.log('[pocket] no POCKET_TOKEN set — keep this server tailnet-only');
  printTailscaleUrl(config.port);
});
