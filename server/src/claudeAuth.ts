import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { dataDir, repoRoot } from './config.js';

/** Roost's own Claude sign-in.
 *
 *  Roost used the Mac's interactive `claude` login — the same one the terminal,
 *  VS Code and every other `claude` on the machine share and refresh. When that
 *  login stopped working, every Claude turn failed with an OAuth error and the
 *  only way back was a terminal on the Mac: the phone had no way to sign in.
 *
 *  So Roost can hold its OWN long-lived token (`claude setup-token`, one year),
 *  created only when the person starts it from the app, and signed in from the
 *  phone: Roost runs the CLI's sign-in on the Mac, shows the link on the phone,
 *  and takes back the code the person pastes. With no token, everything behaves
 *  exactly as before on the shared login.
 *
 *  The token never leaves the Mac: it is written 0600, passed to Claude sessions
 *  through their environment, and never returned by any endpoint or logged. */

const tokenPath = () => join(dataDir(), 'claude-oauth-token');
const TOKEN = /sk-ant-oat01-[A-Za-z0-9_-]+/;

export function loadToken(): string | null {
  try {
    if (!existsSync(tokenPath())) return null;
    const t = readFileSync(tokenPath(), 'utf8').trim();
    return TOKEN.test(t) ? t : null;
  } catch {
    return null;
  }
}

export function saveToken(token: string): void {
  if (!TOKEN.test(token)) throw new Error('not a Claude OAuth token');
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(tokenPath(), token.trim() + '\n', { mode: 0o600 });
  chmodSync(tokenPath(), 0o600); // an existing file keeps its old mode otherwise
  clearAuthFailure();
}

export function clearToken(): void {
  rmSync(tokenPath(), { force: true });
}

/** Options for a Claude SDK `query()`, with Roost's token applied when it has
 *  one. Every Claude session Roost starts goes through this; a doctrine test
 *  fails on any `query(` that does not, so a new feature cannot quietly fall
 *  back to the shared login. */
export function withClaudeAuth<T extends { env?: Record<string, string | undefined> }>(options: T): T {
  const token = loadToken();
  if (!token) return options;
  const base = options.env ?? (process.env as Record<string, string | undefined>);
  return { ...options, env: { ...base, CLAUDE_CODE_OAUTH_TOKEN: token } };
}

/** The SDK's `query`, with Roost's token applied — same arguments, same result.
 *  The only place in the server that calls `query` directly. */
export function authedQuery(args: Parameters<typeof query>[0]): ReturnType<typeof query> {
  return query({ ...args, options: withClaudeAuth((args.options ?? {}) as any) } as any);
}

// ---- telling an auth failure apart from any other failure ------------------

const AUTH = /oauth|authenticat|\b401\b|unauthori[sz]ed|invalid (api key|token|bearer)|please run \/login|not logged in|log ?in again|token (has )?expired|expired token|credentials? (are |were )?(missing|invalid|expired)|invalid_grant/i;

export function isAuthFailure(message: string | null | undefined): boolean {
  return !!message && AUTH.test(message);
}

let lastFailure: { at: number; message: string } | null = null;
export function noteAuthFailure(message: string): void {
  lastFailure = { at: Date.now(), message: message.slice(0, 300) };
}
export function clearAuthFailure(): void {
  lastFailure = null;
}

// ---- status ------------------------------------------------------------------

export interface ClaudeAuthStatus {
  /** Which sign-in Claude sessions will use. */
  using: 'roost-token' | 'mac-login' | 'none';
  /** The Mac's shared login, as `claude auth status` reports it. */
  macLogin: { loggedIn: boolean; email?: string; subscription?: string } | null;
  /** The most recent turn that failed for an auth reason, until a sign-in or
   *  a successful turn clears it. */
  lastFailure: { at: number; message: string } | null;
  /** Whether this Mac can run the phone sign-in at all. */
  canSignInFromPhone: boolean;
}

function macLogin(): Promise<ClaudeAuthStatus['macLogin']> {
  return new Promise((resolve) => {
    execFile('claude', ['auth', 'status'], { timeout: 10_000 }, (err, stdout) => {
      if (err && !stdout) return resolve(null);
      try {
        const j = JSON.parse(stdout);
        resolve({ loggedIn: !!j.loggedIn, email: j.email, subscription: j.subscriptionType });
      } catch {
        resolve(null);
      }
    });
  });
}

export async function authStatus(): Promise<ClaudeAuthStatus> {
  const mac = await macLogin();
  const token = !!loadToken();
  return {
    using: token ? 'roost-token' : mac?.loggedIn ? 'mac-login' : 'none',
    macLogin: mac,
    lastFailure,
    canSignInFromPhone: existsSync('/usr/bin/python3') || existsSync('/opt/homebrew/bin/python3'),
  };
}

// ---- reading the CLI's screen ------------------------------------------------

/** Terminal output to plain text: escape sequences out, line endings normal. */
export function plain(raw: string): string {
  return raw
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()][A-Za-z0-9]/g, '')
    .replace(/\x1b[=>]/g, '')
    .replace(/\r\n?/g, '\n');
}

/** Take a run of `ok` characters starting at `from`, rejoining it across line
 *  breaks when a terminal wrapped it. A following line counts as a continuation
 *  only if it is ONE unbroken run of those characters — the prose after a link
 *  or a token ("Paste code here", "Store this token") always has spaces, and the
 *  first version, which simply kept going, glued its first word on. */
function takeWrapped(text: string, from: number, ok: RegExp): string {
  const lines = text.slice(from).split('\n');
  const first = lines[0];
  let run = '';
  for (const ch of first) { if (ok.test(ch)) run += ch; else break; }
  if (run.length < first.trimEnd().length) return run;   // it ended on this line
  for (const raw of lines.slice(1)) {
    const l = raw.trim();
    if (!l || ![...l].every((ch) => ok.test(ch))) break;
    run += l;
  }
  return run;
}

const URL_CHAR = /[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]/;
const TOKEN_CHAR = /[A-Za-z0-9_-]/;

/** The MANUAL sign-in link — the one that ends on a page showing a code to paste
 *  — not the automatic one, which would need a browser on the Mac. */
export function findSignInUrl(raw: string): string | null {
  const text = plain(raw);
  const start = text.search(/https:\/\/\S*oauth\/authorize\?/);
  if (start < 0) return null;
  const url = takeWrapped(text, start, URL_CHAR);
  try {
    const u = new URL(url);
    return u.searchParams.has('code_challenge') ? u.toString() : null;
  } catch {
    return null;
  }
}

export function findToken(raw: string): string | null {
  const text = plain(raw);
  const start = text.search(/sk-ant-oat01-/);
  if (start < 0) return null;
  const token = takeWrapped(text, start, TOKEN_CHAR);
  return TOKEN.test(token) ? token : null;
}

// ---- the phone sign-in -------------------------------------------------------

interface Flow { id: string; child: ChildProcess; out: string; startedAt: number; timer: NodeJS.Timeout }
let flow: Flow | null = null;
const FLOW_TTL_MS = 10 * 60_000;

function endFlow(): void {
  if (!flow) return;
  clearTimeout(flow.timer);
  try { flow.child.kill('SIGTERM'); } catch { /* already gone */ }
  flow.out = '';              // the buffer can hold the token; drop it
  flow = null;
}

/** Start `claude setup-token` on the Mac and return the sign-in link for the
 *  phone. `BROWSER=/usr/bin/true` turns the CLI's "open a browser" into a no-op:
 *  it runs `$BROWSER <url>` when that is set. Without it the CLI opened a
 *  browser on the Mac, and a Mac already signed in to claude.ai completed the
 *  whole sign-in with nobody present. */
export function startSignIn(opts: { command?: string[] } = {}): Promise<{ flowId: string; url: string }> {
  endFlow();
  const bridge = join(repoRoot, 'server', 'scripts', 'pty-bridge.py');
  const command = opts.command ?? ['claude', 'setup-token'];
  const child = spawn('python3', [bridge, ...command], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: '/usr/bin/true', CLAUDE_CODE_OAUTH_TOKEN: '' },
  });
  const f: Flow = { id: randomUUID(), child, out: '', startedAt: Date.now(), timer: setTimeout(endFlow, FLOW_TTL_MS) };
  flow = f;
  child.stdout?.on('data', (d) => { f.out += d.toString(); });
  child.stderr?.on('data', (d) => { f.out += d.toString(); });
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      clearInterval(poll);
      endFlow();
      reject(new Error('the sign-in link did not appear'));
    }, 30_000);
    const poll = setInterval(() => {
      const url = findSignInUrl(f.out);
      if (url) {
        clearInterval(poll); clearTimeout(deadline);
        resolve({ flowId: f.id, url });
      } else if (f.child.exitCode != null) {
        clearInterval(poll); clearTimeout(deadline);
        endFlow();
        reject(new Error('the sign-in stopped before showing a link'));
      }
    }, 150);
  });
}

/** Hand the pasted code to the waiting CLI and keep the token it prints. */
export function finishSignIn(flowId: string, code: string): Promise<void> {
  const f = flow;
  if (!f || f.id !== flowId) return Promise.reject(new Error('that sign-in has expired — start again'));
  const clean = code.trim();
  if (!clean || /\s/.test(clean) || clean.length > 400) return Promise.reject(new Error('that does not look like a sign-in code'));
  f.child.stdin?.write(clean + '\r');
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      clearInterval(poll);
      const said = plain(f.out).split('\n').map((l) => l.trim()).filter(Boolean).slice(-3).join(' ');
      endFlow();
      reject(new Error(/invalid|error|failed/i.test(said) ? 'the code was not accepted — start again' : 'no token came back — start again'));
    }, 60_000);
    const poll = setInterval(() => {
      const token = findToken(f.out);
      if (token) {
        clearInterval(poll); clearTimeout(deadline);
        try {
          saveToken(token);
          resolve();
        } catch (e) {
          reject(e);
        } finally {
          endFlow();
        }
      } else if (f.child.exitCode != null) {
        clearInterval(poll); clearTimeout(deadline);
        endFlow();
        reject(new Error('the sign-in ended without a token — start again'));
      }
    }, 200);
  });
}

export function cancelSignIn(): void {
  endFlow();
}
