import { spawn, type ChildProcess } from 'node:child_process';
import { loginShellArgv } from './platform.js';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { plain } from './claudeAuth.js';

/** One Deploy button, any project (2026-09-25).
 *
 *  "In almost all cases the answer is yes." After a piece of work the crew asks
 *  whether to deploy, and the user says yes. The button makes that one tap --
 *  but "deploy" means something different in every project: Roost installs
 *  itself as a LaunchAgent, a Next.js site runs `vercel --prod`, a Worker runs
 *  `wrangler deploy`. So:
 *
 *   1. The first tap in a project with no recipe works out what deploy means
 *      there, from what is actually in the repo (a deploy script, a linked
 *      host's config file). What it found is shown with its evidence.
 *   2. The user confirms it once, or corrects it. If nothing in the repo points
 *      at a deploy target, it says so and offers to have the crew look --
 *      it never invents a command.
 *   3. The confirmed recipe is saved per project. Every tap after that runs it.
 *
 *  A recipe is a CHECK and a COMMAND. The check (the project's own tests or
 *  build) must exit 0 before the command runs -- the same "the gate decides,
 *  not the claim" rule as everywhere else. Evidence is the command, its output
 *  and its exit code; never a claim of success. */

export interface DeployRecipe {
  /** Runs in the project folder, through a login shell (so `vercel`, `fly` and
   *  friends are on PATH as they are in the user's terminal). */
  command: string;
  /** Must exit 0 first. null: the user chose to deploy without a check. */
  check: string | null;
  /** Where it came from: what detection found, or "the crew", or "you". */
  source: string;
  confirmedAt: number;
}

export interface DeploySuggestion {
  command: string;
  check: string | null;
  source: string;
  /** Files and settings that point at this answer, in words. */
  evidence: string[];
}

export type DeployPhase = 'check' | 'deploy' | 'passed' | 'failed' | 'gate-failed';

export interface DeployRun {
  phase: DeployPhase;
  command: string;
  check: string | null;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  /** The last lines of output, check and deploy together. */
  output: string;
}

// ---- detection ------------------------------------------------------------------

function readJson(p: string): any {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function readText(p: string): string {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

/** npm, pnpm, yarn or bun, by lockfile. */
export function packageRunner(cwd: string): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock'))) return 'bun';
  return 'npm';
}

const run = (pm: string, script: string) => (pm === 'npm' ? `npm run ${script}` : `${pm} run ${script}`);

/** The project's own check: tests, else a build, else a typecheck. npm's
 *  placeholder test script ("no test specified" && exit 1) is not a test. */
export function detectCheck(cwd: string): { check: string | null; why: string | null } {
  const pkg = readJson(join(cwd, 'package.json'));
  const scripts: Record<string, string> = pkg?.scripts ?? {};
  const pm = packageRunner(cwd);
  if (scripts.test && !/no test specified/i.test(scripts.test)) {
    const withTypes = scripts.typecheck ? `${run(pm, 'typecheck')} && ` : '';
    return { check: `${withTypes}${pm === 'npm' ? 'npm test' : `${pm} test`}`, why: `package.json has a test script${scripts.typecheck ? ' and a typecheck' : ''}` };
  }
  if (scripts.build) return { check: run(pm, 'build'), why: 'package.json has a build script' };
  if (scripts.typecheck) return { check: run(pm, 'typecheck'), why: 'package.json has a typecheck script' };
  if (existsSync(join(cwd, 'Cargo.toml'))) return { check: 'cargo test', why: 'a Rust project (Cargo.toml)' };
  if (existsSync(join(cwd, 'go.mod'))) return { check: 'go test ./...', why: 'a Go project (go.mod)' };
  if (existsSync(join(cwd, 'pyproject.toml')) && /pytest/.test(readText(join(cwd, 'pyproject.toml')))) return { check: 'pytest', why: 'pyproject.toml uses pytest' };
  return { check: null, why: null };
}

function gitRemotes(cwd: string): string {
  // .git/config names the remotes without running git.
  return readText(join(cwd, '.git', 'config'));
}

function workflowDeploysOnPush(cwd: string): string | null {
  const dir = join(cwd, '.github', 'workflows');
  try {
    for (const f of readdirSync(dir)) {
      if (!/\.ya?ml$/.test(f)) continue;
      const t = readText(join(dir, f));
      if (/on:[\s\S]*push/.test(t) && /deploy|pages|release|publish/i.test(t)) return f;
    }
  } catch {
    /* no workflows */
  }
  return null;
}

/** What deploy most likely means in this project, from the files in it. The
 *  first match wins; order runs from the most explicit statement of intent (a
 *  script the project itself calls "deploy") to the least (a CI workflow that
 *  runs on push). null: nothing in the repo points at a deploy target. */
export function detectDeploy(cwd: string): DeploySuggestion | null {
  const has = (p: string) => existsSync(join(cwd, p));
  const pkg = readJson(join(cwd, 'package.json'));
  const scripts: Record<string, string> = pkg?.scripts ?? {};
  const pm = packageRunner(cwd);
  const { check, why } = detectCheck(cwd);
  const withCheck = (s: Omit<DeploySuggestion, 'check'>): DeploySuggestion => ({
    ...s,
    check,
    evidence: why ? [...s.evidence, `check: ${why}`] : [...s.evidence, 'no tests or build script found to check with first'],
  });

  // Roost itself: its installer builds, smoke-tests and keeps a rollback.
  if (has('scripts/service.mjs') && /finish-deploy|install/.test(readText(join(cwd, 'scripts/service.mjs')))) {
    return withCheck({ command: 'node scripts/service.mjs install', source: 'Roost installer', evidence: ['scripts/service.mjs installs, smoke-tests and keeps the previous release for rollback'] });
  }
  for (const name of ['deploy', 'release', 'ship', 'publish']) {
    if (scripts[name] && !(name === 'publish' && !pkg?.private && pkg?.name)) {
      return withCheck({ command: run(pm, name), source: `package.json "${name}" script`, evidence: [`package.json scripts.${name}: ${scripts[name]}`] });
    }
  }
  if (has('vercel.json') || has('.vercel/project.json')) {
    return withCheck({ command: 'npx vercel --prod --yes', source: 'Vercel', evidence: [has('.vercel/project.json') ? '.vercel/project.json: this folder is linked to a Vercel project' : 'vercel.json'] });
  }
  if (has('netlify.toml') || has('.netlify/state.json')) {
    return withCheck({ command: 'npx netlify deploy --prod', source: 'Netlify', evidence: [has('.netlify/state.json') ? '.netlify/state.json: linked to a Netlify site' : 'netlify.toml'] });
  }
  if (has('fly.toml')) return withCheck({ command: 'fly deploy', source: 'Fly.io', evidence: ['fly.toml'] });
  if (has('wrangler.toml') || has('wrangler.jsonc') || has('wrangler.json')) {
    return withCheck({ command: 'npx wrangler deploy', source: 'Cloudflare', evidence: ['wrangler config'] });
  }
  if (has('firebase.json')) return withCheck({ command: 'npx firebase deploy', source: 'Firebase', evidence: ['firebase.json'] });
  if (has('render.yaml')) return withCheck({ command: 'git push', source: 'Render (deploys on push)', evidence: ['render.yaml: Render builds on every push'] });
  const remotes = gitRemotes(cwd);
  if (/\[remote "heroku"\]/.test(remotes)) {
    return withCheck({ command: 'git push heroku HEAD:main', source: 'Heroku', evidence: ['a git remote named heroku'] });
  }
  const wf = workflowDeploysOnPush(cwd);
  if (wf && /\[remote "origin"\]/.test(remotes)) {
    return withCheck({ command: 'git push', source: 'GitHub Actions (deploys on push)', evidence: [`.github/workflows/${wf} deploys when you push`] });
  }
  return null;
}

// ---- recipes, saved per project -------------------------------------------------

interface Stored {
  recipes: Record<string, DeployRecipe>;
  lastRuns: Record<string, DeployRun>;
}

const storePath = (dataDir: string) => join(dataDir, 'deploy.json');

function load(dataDir: string): Stored {
  const s = readJson(storePath(dataDir));
  return { recipes: s?.recipes ?? {}, lastRuns: s?.lastRuns ?? {} };
}

function save(dataDir: string, s: Stored): void {
  mkdirSync(dataDir, { recursive: true });
  const tmp = storePath(dataDir) + '.tmp';
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, storePath(dataDir));
}

export function getRecipe(dataDir: string, cwd: string): DeployRecipe | null {
  return load(dataDir).recipes[cwd] ?? null;
}

export function saveRecipe(dataDir: string, cwd: string, r: { command: string; check?: string | null; source?: string }): DeployRecipe {
  const command = String(r.command ?? '').trim();
  if (!command) throw new Error('a deploy command is required');
  const check = typeof r.check === 'string' && r.check.trim() ? r.check.trim() : null;
  const recipe: DeployRecipe = { command, check, source: String(r.source ?? 'you').slice(0, 80) || 'you', confirmedAt: Date.now() };
  const s = load(dataDir);
  s.recipes[cwd] = recipe;
  save(dataDir, s);
  return recipe;
}

export function forgetRecipe(dataDir: string, cwd: string): void {
  const s = load(dataDir);
  delete s.recipes[cwd];
  save(dataDir, s);
}

/** A crew member's proposal, from a ```roost-deploy fenced block:
 *    command: npx vercel --prod
 *    check: npm test
 *  Parsed, never run: it becomes a suggestion the user confirms. */
export function parseProposal(text: string): { command: string; check: string | null } | null {
  const command = text.match(/^\s*command:\s*(.+)$/m)?.[1].trim();
  if (!command) return null;
  const c = text.match(/^\s*check:\s*(.+)$/m)?.[1].trim();
  return { command, check: c && !/^(none|null|-)$/i.test(c) ? c : null };
}

// ---- running --------------------------------------------------------------------

const MAX_OUTPUT = 16_000;
const TIMEOUT_MS = 20 * 60_000;
const live = new Map<string, { run: DeployRun; child: ChildProcess | null }>();

export function lastRun(dataDir: string, cwd: string): DeployRun | null {
  return live.get(cwd)?.run ?? load(dataDir).lastRuns[cwd] ?? null;
}

export function isRunning(cwd: string): boolean {
  const r = live.get(cwd)?.run;
  return !!r && (r.phase === 'check' || r.phase === 'deploy');
}

function step(cwd: string, command: string, onOut: (s: string) => void): Promise<number> {
  return new Promise((resolve) => {
    const [shell, shellArgs] = loginShellArgv(command);
    const child = spawn(shell, shellArgs, { cwd, windowsHide: true, env: { ...process.env, CI: '1', FORCE_COLOR: '0' } });
    const entry = live.get(cwd);
    if (entry) entry.child = child;
    const timer = setTimeout(() => {
      onOut(`\n[stopped: still running after ${TIMEOUT_MS / 60_000} minutes]\n`);
      child.kill('SIGTERM');
    }, TIMEOUT_MS);
    child.stdout?.on('data', (d) => onOut(String(d)));
    child.stderr?.on('data', (d) => onOut(String(d)));
    child.on('error', (e) => onOut(`\n${e.message}\n`));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}

/** Run the check, then -- only if it exits 0 -- the command. Resolves with the
 *  finished run; poll lastRun() meanwhile. `onDone` is for a notification. */
export async function startDeploy(dataDir: string, cwd: string, recipe: DeployRecipe, onDone?: (r: DeployRun) => void): Promise<DeployRun> {
  if (isRunning(cwd)) throw new Error('a deploy is already running for this project');
  const r: DeployRun = { phase: recipe.check ? 'check' : 'deploy', command: recipe.command, check: recipe.check, startedAt: Date.now(), endedAt: null, exitCode: null, output: '' };
  live.set(cwd, { run: r, child: null });
  // Build tools colour their output; the phone showed the raw escape codes
  // ("[2mdist/ [22m…", 2026-09-27 audit). Plain text in, plain text shown.
  const out = (s: string) => {
    r.output = (r.output + plain(s)).slice(-MAX_OUTPUT);
  };
  const finish = (phase: DeployPhase, code: number) => {
    r.phase = phase;
    r.exitCode = code;
    r.endedAt = Date.now();
    try {
      const s = load(dataDir);
      s.lastRuns[cwd] = r;
      save(dataDir, s);
    } catch {
      /* the run happened either way */
    }
    onDone?.(r);
    return r;
  };
  if (recipe.check) {
    out(`$ ${recipe.check}\n`);
    const code = await step(cwd, recipe.check, out);
    if (code !== 0) {
      out(`\n[check exited ${code} — not deploying]\n`);
      return finish('gate-failed', code);
    }
    out(`\n[check passed]\n\n`);
    r.phase = 'deploy';
  }
  out(`$ ${recipe.command}\n`);
  const code = await step(cwd, recipe.command, out);
  return finish(code === 0 ? 'passed' : 'failed', code);
}

/** The prompt behind "Ask the crew to work it out". */
export function composeDeployAsk(cwd: string): string {
  return [
    `I want a one-tap Deploy button for this project (${cwd}). Work out what "deploy" means here — how this project's changes get pushed live or shipped — by reading the repo: package.json scripts, host config files (vercel.json, netlify.toml, fly.toml, wrangler config, firebase.json, Dockerfile, Procfile), git remotes, CI workflows and the README.`,
    `Don't run the deploy and don't change any files. If you find it, say in a sentence or two what you found and why, then end with exactly this block so Roost can offer it as a button:`,
    '```roost-deploy\ncommand: <the shell command that deploys, run from the project folder>\ncheck: <the command that must pass first — tests or build — or none>\n```',
    `If there is no deploy target set up yet, say so plainly and suggest the simplest way to set one up — don't invent a command.`,
  ].join('\n\n');
}
