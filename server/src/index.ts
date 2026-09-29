import { priceConflicts } from './pricing.js';
import { callLedger } from './ledger.js';
import { estimateWeights } from './quotaWeights.js';
import { logDecision, readDecisions, summarizeDecisions } from './decisions.js';
import { execFile, spawn } from 'node:child_process';
import { baseName, tailscaleCandidates, volumeShortcuts } from './platform.js';
import { createServer } from 'node:http';
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { dataDir, loadConfig, repoRoot, saveConfig } from './config.js';
import { checkImagePath, imageRoots } from './images.js';
import { LiveManager, fromPid, toPid } from './live.js';
import { isLivePath, proxyRequest, proxyUpgrade, serveStatic, splitLivePath } from './liveProxy.js';
import { modelForPersona, prettyModel } from './mentions.js';
import { quotaStore } from './quota.js';
import { modelRegistry, classify, auditRoutes } from './registry.js';
import { capabilitiesFrom, reviewerFor, REVIEW_STRENGTH_LABEL } from './capabilities.js';
import { generateAvatar, listCustom, avatarDir, AvatarGenError } from './avatars.js';
import { refreshRegistry, startRegistryRefresh } from './registryFetch.js';
import { getGitDiff, getGitHistory, getGitStatus, getGitSummaries, gitCommit, gitPush } from './git.js';
import { getLiveModels, type ModelOption } from './models.js';
import { initNotify, sendNotification, sendNotificationAsync } from './notify.js';
import { getRecentProjects, listClaudeSessions, listCodexSessions } from './resumable.js';
import { getClaudePreview, getCodexPreview } from './preview.js';
import { SessionManager, setJobShippedHook } from './sessions.js';
import { getCachedUsage, refreshUsage } from './usage.js';
import { allPersonas, personaFor, saveOverrides, loadOverrides, resetCrewCache, type Persona, DISPATCHER } from './crew.js';
import { loadMe, saveMe } from './me.js';
import { authStatus, cancelSignIn, clearToken, finishSignIn, startSignIn } from './claudeAuth.js';
import { noteLogLine, registerRescue, webRoot } from './rescue.js';
import { readRoadmap } from './roadmap.js';
import { composeDeployAsk, detectDeploy, forgetRecipe, getRecipe, isRunning, lastRun, saveRecipe, startDeploy } from './deploy.js';
import { companionsFrom, readLedgerRows, readLife, sinceSummary } from './companions.js';
import type { AgentKind, ClientMessage } from './protocol.js';
import { Games } from './games.js';
import { Economy, crateOnSale } from './economy.js';
import { CRATES, ITEMS, PAINTS, CERTS, RARITY_NAME, SLOTS, itemById } from './catalog.js';
import { readOnDeck } from './onDeck.js';
import { visit } from './visits.js';
import { checkForUpdate, checkoutDir } from './updates.js';
import { createProject } from './newProject.js';
import { projectUsage, scanUsage } from './projectUsage.js';
import { PLANS, advise, isPlan, planRoutes, planWords } from './subscription.js';

// Every log line gets a time. The log had none, so on the day every session
// crashed there was no way to say when anything happened.
for (const level of ['log', 'warn', 'error'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    const at = new Date().toISOString();
    // Warnings and errors also go to the rescue page, which is how the phone
    // sees what went wrong without the Mac's log file.
    if (level !== 'log') noteLogLine(`${at} ${args.map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`);
    original(at, ...args);
  };
}

// Every agent Roost spawns inherits this, so a deploy run from inside a
// session can tell it is about to restart the server it lives under.
process.env.ROOST_HOSTED = '1';

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
  return volumeShortcuts();
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

// A new project from the phone (#45): folder, first commit, optional GitHub repo.
app.post('/api/projects/new', async (req, res) => {
  const { name, visibility, blurb } = req.body ?? {};
  const parent = String(req.body?.parent || '') || (config.projects[0] ? dirname(config.projects[0]) : primaryVolume() ?? homedir());
  const vis = visibility === 'public' || visibility === 'private' ? visibility : 'none';
  try {
    const r = await createProject(parent, String(name ?? ''), vis, String(blurb ?? ''));
    const next = [...config.projects, r.path];
    saveConfig({ ...config, projects: next });
    config.projects = next;
    res.json({ ...r, projects: config.projects });
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

// A local image, for the in-app viewer (images.ts says what is allowed and why).
app.get('/api/image', (req, res) => {
  const check = checkImagePath(String(req.query.path ?? ''), imageRoots(config.projects, dataDir()));
  if (!check.ok) {
    res.status(check.status).json({ error: check.reason });
    return;
  }
  res.setHeader('Content-Type', check.type);
  res.setHeader('Cache-Control', 'no-store'); // agents overwrite screenshots in place
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(check.path);
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

// Your plan (#44): the ladder Pip hands work down, explained and advised.
app.get('/api/plan', (_req, res) => {
  const plan = config.plan ?? null;
  let weekly = null;
  try {
    const u: any = getCachedUsage();
    weekly = u?.claude?.windows?.find((w: any) => w.key === 'claude:weekly_all') ?? null;
  } catch { /* no reading */ }
  res.json({
    plan,
    plans: PLANS.map((p) => ({ plan: p, words: planWords(p) })),
    advice: advise(plan ?? '100', weekly),
  });
});
app.post('/api/plan', (req, res) => {
  const plan = req.body?.plan;
  if (!isPlan(plan)) return void res.status(400).json({ error: 'plan must be 20, 100 or 200' });
  const autoRoute = planRoutes(plan);
  try {
    saveConfig({ ...config, plan, autoRoute });
  } catch (err: any) {
    return void res.status(500).json({ error: `could not save config: ${err?.message ?? err}` });
  }
  config.plan = plan;
  config.autoRoute = autoRoute;
  manager.applyRoutes(autoRoute);
  logDecision({ kind: 'gate', rule: 'plan', plan } as any);
  res.json({ ok: true, plan, words: planWords(plan) });
});

// What's on deck per project (#46).
app.get('/api/ondeck', (_req, res) => { res.json({ onDeck: readOnDeck() }); });

// Per-project usage this week, from the vendors' own logs (#47). The first
// call waits for a scan; after that it answers from the cache and refreshes
// in the background.
let usageScanned = false;
app.get('/api/usage/projects', async (_req, res) => {
  const scan = scanUsage().then(() => { usageScanned = true; }).catch(() => {});
  if (!usageScanned) await scan;
  const u: any = getCachedUsage();
  const weekly = (agent: 'claude' | 'codex') => {
    const w = u?.[agent]?.windows?.find((x: any) => x.windowDurationMins === 10080 && typeof x.usedPercent === 'number' && !/scoped/.test(x.key));
    return typeof w?.usedPercent === 'number' ? w.usedPercent : null;
  };
  const wk = { claude: weekly('claude'), codex: weekly('codex') };
  res.json({
    projects: projectUsage(config.projects).map((p) => {
      const crew = Object.entries(p.byModel)
        .map(([model, tokens]) => ({ p: personaFor(/^gpt|codex|^o\d/i.test(model) ? 'codex' : 'claude', model), tokens }))
        .reduce<Record<string, { name: string; color: string; sprite?: string; tokens: number }>>((acc, { p: per, tokens }) => {
          const k = per.name;
          acc[k] = acc[k] ?? { name: per.name, color: per.color, sprite: (per as any).sprite, tokens: 0 };
          acc[k].tokens += tokens;
          return acc;
        }, {});
      return {
        cwd: p.cwd,
        tokens: p.tokens,
        byAgent: p.byAgent,
        // Share of your whole week on that vendor, as a percent of the limit.
        weekPct: {
          claude: p.share.claude != null && wk.claude != null ? Math.round(p.share.claude * wk.claude) : null,
          codex: p.share.codex != null && wk.codex != null ? Math.round(p.share.codex * wk.codex) : null,
        },
        crew: Object.values(crew).sort((a, b) => b.tokens - a.tokens),
      };
    }),
  });
});

// The fun layer (#49): check in, keep a streak.
app.post('/api/visit', (req, res) => {
  const day = String(req.body?.day ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return void res.status(400).json({ error: 'day must be yyyy-mm-dd' });
  res.json(visit(day));
});

// Updates (2026-09-29): tagged releases only, checked once a day.
app.get('/api/update', async (req, res) => { res.json(await checkForUpdate(req.query.force === '1')); });
app.post('/api/update/apply', async (_req, res) => {
  const u = await checkForUpdate(true);
  if (!u.available || !u.latest) return void res.status(400).json({ error: 'No update to install.' });
  // Detached: the deploy restarts this very server.
  const child = spawn(process.execPath, [join(checkoutDir(), 'scripts', 'update.mjs'), u.latest], { cwd: checkoutDir(), detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  res.json({ ok: true, installing: u.latest });
});

// The arcade (#55): saves, bests and achievements, kept on the Mac.
const games = new Games();
// Coins, keys, crates and the wardrobe (games wave 1).
const economy = new Economy();
setJobShippedHook((crew) => economy.job(crew));
const ecoView = () => {
  const s = economy.state();
  return {
    ...s,
    looks: economy.looks(),
    shop: CRATES.map((c) => ({ ...c, onSale: crateOnSale(c) })),
    freeReady: s.freeDay !== dayKeyLocal(),
  };
};
const dayKeyLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
app.get('/api/economy/catalog', (_req, res) => { res.json({ items: ITEMS, crates: CRATES, paints: PAINTS, certs: CERTS, rarityName: RARITY_NAME, slots: SLOTS }); });
app.get('/api/economy', (_req, res) => { res.json(ecoView()); });
app.get('/api/economy/looks', (_req, res) => { res.json({ looks: economy.looks() }); });
const ecoAction = (fn: (body: any) => unknown) => (req: express.Request, res: express.Response) => {
  try { res.json({ result: fn(req.body ?? {}), state: ecoView() }); } catch (err: any) { res.status(400).json({ error: String(err?.message ?? err) }); }
};
app.post('/api/economy/buy', ecoAction((b) => economy.buy(String(b.crate))));
app.post('/api/economy/free', ecoAction(() => economy.claimFree()));
app.post('/api/economy/open', ecoAction((b) => { const o = economy.open(String(b.uid)); return { ...o, item: itemById(o.itemId) }; }));
app.post('/api/economy/tradeup', ecoAction((b) => { const o = economy.tradeUp(b.uids ?? []); return { ...o, item: itemById(o.itemId) }; }));
app.post('/api/economy/equip', ecoAction((b) => economy.equip(String(b.crew), b.slot, b.uid ?? null)));
app.post('/api/economy/ghost', ecoAction((b) => economy.ghost(String(b.gameId), String(b.crew))));
app.get('/api/games', (_req, res) => { res.json(games.all()); });
app.put('/api/games/:id/save', (req, res) => {
  res.status(games.save(req.params.id, req.body?.state ?? null) ? 200 : 400).json({ ok: true });
});
app.post('/api/games/:id/score', (req, res) => {
  const score = Number(req.body?.score);
  const r = games.score(req.params.id, score, !!req.body?.lowerIsBetter);
  if (!r) return void res.status(400).json({ error: 'bad score' });
  // Every run pays (games wave 1), a best pays more, and the day's challenge
  // is checked against it.
  const earned = economy.run(req.params.id, { best: r.isBest });
  const challenge = economy.challengeResult(req.params.id, score);
  res.json({ ...r, earned, challenge });
});
app.post('/api/games/achievement', (req, res) => {
  const id = String(req.body?.id ?? '');
  const earned = games.achieve(id);
  const coins = earned ? economy.achievement(id.split(':')[0], id) : 0;
  res.json({ earned, coins });
});

// The project's history as crew-shaped entries: the Map, per project (2026-09-27).
app.get('/api/git/history', async (req, res) => {
  const cwd = guardProject(req, res);
  if (!cwd) return;
  try {
    const entries = await getGitHistory(cwd, Number(req.query.limit) || 80);
    res.json({
      entries: entries.map((e) => {
        const byName = e.crewNames.map((n) => allPersonas().find((p) => p.name === n)).filter(Boolean);
        const byModel = byName.length ? [] : e.coAuthors.filter((c) => /claude|gpt|codex/i.test(c)).map((c) => personaFor(/claude/i.test(c) ? 'claude' : 'codex', c));
        const crew = [...byName, ...byModel].filter((p, i, a) => p && p.name !== 'Crew' && a.findIndex((q) => q!.name === p.name) === i)
          .map((p) => ({ name: p!.name, color: p!.color, sprite: (p as any).sprite, agent: (p as any).suite ?? 'claude' }));
        return { hash: e.hash, subject: e.subject, at: e.at, author: e.author, crew };
      }),
    });
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

// One Deploy button, any project (deploy.ts). The first tap finds what deploy
// means here; the user confirms it once; every tap after runs it, gated.
app.get('/api/deploy', (req, res) => {
  const cwd = guardProject(req, res);
  if (!cwd) return;
  const recipe = getRecipe(dataDir(), cwd);
  res.json({ recipe, suggestion: recipe ? null : detectDeploy(cwd), run: lastRun(dataDir(), cwd), ask: composeDeployAsk(cwd) });
});

app.post('/api/deploy/recipe', (req, res) => {
  const cwd = guardProject(req, res);
  if (!cwd) return;
  try {
    if (req.body?.forget) {
      forgetRecipe(dataDir(), cwd);
      res.json({ recipe: null, suggestion: detectDeploy(cwd) });
      return;
    }
    res.json({ recipe: saveRecipe(dataDir(), cwd, req.body ?? {}) });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message ?? err) });
  }
});

app.post('/api/deploy/run', (req, res) => {
  const cwd = guardProject(req, res);
  if (!cwd) return;
  const recipe = getRecipe(dataDir(), cwd);
  if (!recipe) {
    res.status(400).json({ error: 'no deploy recipe confirmed for this project yet' });
    return;
  }
  if (isRunning(cwd)) {
    res.status(409).json({ error: 'a deploy is already running for this project' });
    return;
  }
  const name = baseName(cwd);
  void startDeploy(dataDir(), cwd, recipe, (r) => {
    const words = r.phase === 'passed' ? 'deployed' : r.phase === 'gate-failed' ? 'not deployed: the check failed' : `deploy failed (exit ${r.exitCode})`;
    sendNotification(`deploy:${cwd}`, `${name}: ${words}`, r.output.trim().split('\n').slice(-3).join('\n'));
  }).catch(() => {});
  res.json({ run: lastRun(dataDir(), cwd) });
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

/** The map (docs/board/Roadmap.dc.html): a project's ROADMAP.md, read — never
 *  typed for the screen — plus what the harness did in the last day. */
/** The crew as companions (item 40): mood, energy, stats and milestones, all
 *  read from the ledger, the life log and live state -- nothing invented.
 *  `since` (epoch ms): also say what they did while you were away. */
app.get('/api/crew/life', (req, res) => {
  const now = Date.now();
  const personas = [...allPersonas(), DISPATCHER];
  const names = [...new Set(personas.map((p) => p.name))];
  const suiteOf = new Map(personas.map((p) => [p.name, p.suite ?? 'claude'] as const));
  const working = new Set(manager.list().filter((s) => s.state === 'working' && s.crew?.name).map((s) => s.crew!.name));
  const ledger = readLedgerRows();
  const life = readLife();
  const companions = companionsFrom({
    names, ledger, life, now, working,
    profile: (name) => {
      const p = personas.find((x) => x.name === name);
      return { suite: p ? (p.suite ?? (p.name === DISPATCHER.name ? null : 'claude')) : null, tier: p?.tier ?? null };
    },
    usedPercent: (name) => {
      const vendor = suiteOf.get(name) ?? 'claude';
      return { vendor, percent: quotaStore().headroom(vendor, config.budget).worstPercent };
    },
  });
  const since = Number(req.query.since);
  res.json({ companions, away: Number.isFinite(since) && since > 0 ? sinceSummary({ ledger, life, since, now }) : null });
});

app.get('/api/roadmap/projects', (_req, res) => {
  // Only projects that have a map: a chip for a project with no ROADMAP.md
  // would open onto nothing.
  res.json({ projects: config.projects.filter((p) => existsSync(join(p, 'ROADMAP.md'))) });
});

app.get('/api/roadmap', (req, res) => {
  const cwd = String(req.query.cwd ?? '');
  if (!config.projects.includes(cwd)) {
    res.status(400).json({ error: 'cwd must be one of the configured projects' });
    return;
  }
  const since = Date.now() - 24 * 3600_000;
  res.json({ roadmap: readRoadmap(cwd), decisionsToday: summarizeDecisions(readDecisions(2000), since).total });
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

// ---- Claude sign-in, from the phone -----------------------------------------
// The token itself never crosses this API in either direction except as the
// one-time code the person pastes; nothing here returns it.
app.get('/api/auth/claude', async (_req, res) => {
  res.json(await authStatus());
});

app.post('/api/auth/claude/start', async (_req, res) => {
  try {
    res.json(await startSignIn());
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

app.post('/api/auth/claude/finish', async (req, res) => {
  const { flowId, code } = req.body ?? {};
  if (typeof flowId !== 'string' || typeof code !== 'string') return res.status(400).json({ error: 'flowId and code are required' });
  try {
    await finishSignIn(flowId, code);
    res.json({ ok: true, status: await authStatus() });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message ?? err) });
  }
});

app.post('/api/auth/claude/cancel', (_req, res) => {
  cancelSignIn();
  res.json({ ok: true });
});

/** Forget Roost's own token and go back to the Mac's shared login. */
app.delete('/api/auth/claude/token', async (_req, res) => {
  clearToken();
  res.json({ ok: true, status: await authStatus() });
});

// The phone reports its own crashes here, so the Mac's log is not silent when
// the app breaks in the browser — the whole of 2026-09-24's outage was invisible
// from the Mac for exactly that reason.
app.post('/api/client-error', (req, res) => {
  const b = req.body ?? {};
  const s = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').slice(0, n);
  console.error(`[roost] phone ${s(b.kind, 40)} at ${s(b.url, 120)}: ${s(b.message, 300)} | ${s(b.stack, 400)}`);
  res.json({ ok: true });
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
  // The model each member runs on, named with its version, for the @ pop-up.
  const cards = modelRegistry().all();
  const models: Record<string, string> = {};
  for (const p of allPersonas()) {
    const suite = p.suite ?? 'claude';
    const { model } = modelForPersona(p, suite, cards, config.autoRoute[suite]);
    const card = cards.find((c) => c.agent === suite && c.id === model);
    models[p.name] = prettyModel(card?.resolvedId ?? model);
  }
  res.json({ crew: allPersonas(), overrides: loadOverrides(), dispatcher: DISPATCHER, models });
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

// ---------- Live preview (docs/PREVIEW.md, roadmap 28) ----------
// "I can code all day in Roost, but I eventually want to see an actual live
// version — and I may not be on my computer or on the same network."
const liveManager = new LiveManager();

function requireProject(cwd: unknown, res: express.Response): string | null {
  if (typeof cwd !== 'string' || !config.projects.includes(cwd)) {
    res.status(400).json({ error: 'cwd must be one of the configured projects' });
    return null;
  }
  return cwd;
}

app.get('/api/live/status', (req, res) => {
  const cwd = requireProject(req.query.cwd, res);
  if (!cwd) return;
  res.json(liveManager.status(cwd));
});

app.post('/api/live/start', async (req, res) => {
  const cwd = requireProject(req.body?.cwd, res);
  if (!cwd) return;
  try {
    res.json(await liveManager.start(cwd));
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

app.post('/api/live/stop', (req, res) => {
  const cwd = requireProject(req.body?.cwd, res);
  if (!cwd) return;
  res.json({ stopped: liveManager.stop(cwd) });
});

// The proxy itself: same-origin, so the phone needs nothing new on the
// tailnet. Mounted before the SPA catch-all below, which would otherwise
// swallow every /live/* request as "just another client route".
app.use('/live/:pid', (req, res) => {
  const target = liveManager.target(req.params.pid);
  if (!target) {
    res.status(404).send('This preview is not running. Start it from the session it belongs to.');
    return;
  }
  const rest = req.originalUrl.slice(`/live/${req.params.pid}`.length) || '/';
  if (target.kind === 'command') {
    // The dev server itself carries the /live/<pid>/ prefix in its asset
    // URLs (it is started with a matching --base), so the request is
    // forwarded exactly as it arrived.
    (req as any).url = req.originalUrl;
    proxyRequest(req, res, target.port);
  } else {
    serveStatic(target.root, rest, res);
  }
});

const LIVE_SWEEP_INTERVAL_MS = 5 * 60_000;
const liveSweep = setInterval(() => liveManager.sweepIdle(), LIVE_SWEEP_INTERVAL_MS);
liveSweep.unref();

// The rescue page first: it must not depend on the front end below it.
registerRescue(app, { sessions: () => manager.list().map(({ id, title, agent, cwd, state }) => ({ id, title, agent, cwd, state })) });

// Serve the web app (production mode) — the current RELEASE, i.e. the last
// build that passed the smoke check, not whatever was built most recently.
const webDist = webRoot();
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile(join(webDist, 'index.html')));
}

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

// The upgrade half of the live proxy: hot reload is a websocket, and
// http.request has no equivalent for a handshake. `ws`'s own listener above
// only acts on the /ws path and leaves every other upgrade alone, so this is
// safe to register alongside it.
httpServer.on('upgrade', (req, socket, head) => {
  if (!isLivePath(req.url)) return;
  const { pid } = splitLivePath(req.url!);
  const target = liveManager.target(pid);
  if (!target || target.kind !== 'command') {
    socket.destroy();
    return;
  }
  proxyUpgrade(req, socket, head, target.port);
});

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
      // A message that died in flight must say so. It used to surface as a
      // bare error the person could not connect to the thing they had typed.
      const why = String(err?.message ?? err);
      session.reportError((msg as any).type === 'user_message'
        ? `Your message was not delivered (${why}). It is not in the conversation — please send it again.`
        : why);
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
// The Claude gauge went dark for 31 hours (2026-09-24): its reading only
// arrived from a live session's rate-limit events, and nothing else asked.
// Every route in that time said "no move on missing data" -- the router was
// not conservative, it was blind. The probe is a zero-token control request,
// so it is asked on a schedule: once soon after boot, then every 20 minutes.
const USAGE_REFRESH_MS = 20 * 60_000;
const usageTimer = setInterval(() => {
  void refreshUsage(config.projects[0] ?? repoRoot).catch(() => {});
}, USAGE_REFRESH_MS);
usageTimer.unref();
setTimeout(() => void refreshUsage(config.projects[0] ?? repoRoot).catch(() => {}), 5_000).unref();

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
  const candidates = tailscaleCandidates();
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
