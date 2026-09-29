import { type ChildProcessByStdio, spawn } from 'node:child_process';
import { shellArgv } from './platform.js';
import type { Readable } from 'node:stream';
import { realpathSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { loadProjectKnowledge, type ProjectKnowledge } from './projectFile.js';

/** "See the project you are building, from the phone" (docs/PREVIEW.md,
 *  roadmap 28). A project says how it runs in its `## preview` section of
 *  the project file:
 *
 *    ## preview
 *    npm run dev -- --port {port} --host 127.0.0.1
 *
 *  or `static: dist` for a built site with no process. Roost starts it on
 *  demand, one per project, and stops it after 20 idle minutes. The dev
 *  server is reached at its own address only; the phone reaches it through
 *  `/live/<pid>/…`, a same-origin proxy (live-proxy.ts) so nothing new has
 *  to be open on the tailnet.
 *
 *  Named `live`, not `preview` -- `preview.ts` already means the read-only
 *  recap of a past session. Two different ideas that happen to share a
 *  word in conversation must not share one in the code. */

export type LiveConfig = { kind: 'command'; command: string } | { kind: 'static'; dir: string };

/** The `## preview` section: `static: <dir>`, or a command line (bare, a
 *  markdown bullet, or backticked -- however a person or an agent-proposed
 *  edit happens to write it). Agent output is never treated as a command
 *  that runs on its own; this is read from the file the person keeps, the
 *  same rule `## gates` follows. */
export function parseLiveConfig(knowledge: ProjectKnowledge): LiveConfig | null {
  const body = knowledge.sections['preview'];
  if (!body) return null;
  const stat = body.match(/^\s*static:\s*(.+?)\s*$/im);
  if (stat) return { kind: 'static', dir: stat[1].replace(/^`|`$/g, '').trim() };
  const line = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('#'));
  if (!line) return null;
  const command = line
    .replace(/^[-*]\s*/, '')
    .replace(/^`(.*)`$/, '$1')
    .trim();
  return command ? { kind: 'command', command } : null;
}

/** The proxy path segment for a project: reversible, so no id table needs
 *  keeping in sync with `config.projects`, and it never leaks a path an
 *  index route already exposes. */
export function toPid(cwd: string): string {
  return Buffer.from(cwd, 'utf8').toString('base64url');
}
export function fromPid(pid: string): string | null {
  try {
    const cwd = Buffer.from(pid, 'base64url').toString('utf8');
    return cwd && toPid(cwd) === pid ? cwd : null;
  } catch {
    return null;
  }
}

export type LiveState = 'starting' | 'running' | 'stopped' | 'error';

export interface LiveInfo {
  configured: boolean;
  state: LiveState;
  kind?: LiveConfig['kind'];
  url?: string;
  error?: string;
  /** The command's own recent stdout/stderr, so a failed start says why
   *  instead of just "error". */
  output?: string[];
  startedAt?: number;
}

interface Entry {
  cwd: string;
  config: LiveConfig;
  state: LiveState;
  port?: number;
  child?: ChildProcessByStdio<null, Readable, Readable>;
  output: string[];
  error?: string;
  startedAt: number;
  lastActivityAt: number;
}

const START_TIMEOUT_MS = 30_000;
const IDLE_STOP_MS = 20 * 60_000;
const OUTPUT_LINES = 60;
const POLL_MS = 300;

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : null;
      srv.close(() => (port ? resolve(port) : reject(new Error('no port assigned'))));
    });
  });
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.connect({ host: '127.0.0.1', port });
      sock.once('connect', () => {
        sock.end();
        resolve();
      });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error('timed out waiting for the preview to answer on its port'));
        else setTimeout(tryOnce, POLL_MS);
      });
    };
    tryOnce();
  });
}

export class LiveManager {
  private byCwd = new Map<string, Entry>();

  status(cwd: string): LiveInfo {
    const entry = this.byCwd.get(cwd);
    if (!entry) {
      const config = parseLiveConfig(loadProjectKnowledge(cwd));
      return { configured: !!config, state: 'stopped', kind: config?.kind };
    }
    return {
      configured: true,
      state: entry.state,
      kind: entry.config.kind,
      url: entry.state === 'running' ? `/live/${toPid(cwd)}/` : undefined,
      error: entry.error,
      output: entry.state === 'error' ? entry.output.slice(-12) : undefined,
      startedAt: entry.startedAt,
    };
  }

  async start(cwd: string): Promise<LiveInfo> {
    const existing = this.byCwd.get(cwd);
    if (existing?.state === 'running' || existing?.state === 'starting') return this.status(cwd);

    const config = parseLiveConfig(loadProjectKnowledge(cwd));
    if (!config) return { configured: false, state: 'stopped' };

    if (config.kind === 'static') {
      this.byCwd.set(cwd, { cwd, config, state: 'running', output: [], startedAt: Date.now(), lastActivityAt: Date.now() });
      return this.status(cwd);
    }

    const port = await findFreePort();
    const command = config.command.replaceAll('{port}', String(port));
    const [sh, shArgs] = shellArgv(command);
    const child = spawn(sh, shArgs, {
      windowsHide: true,
      cwd,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const entry: Entry = { cwd, config, state: 'starting', port, child, output: [], startedAt: Date.now(), lastActivityAt: Date.now() };
    this.byCwd.set(cwd, entry);

    const collect = (buf: Buffer) => {
      entry.output.push(...buf.toString('utf8').split('\n').filter(Boolean));
      if (entry.output.length > OUTPUT_LINES) entry.output.splice(0, entry.output.length - OUTPUT_LINES);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('exit', (code, signal) => {
      if (entry.state === 'starting' || entry.state === 'running') {
        entry.state = 'error';
        entry.error = signal ? `stopped (${signal})` : `exited (code ${code})`;
      }
    });
    child.on('error', (err) => {
      entry.state = 'error';
      entry.error = String(err.message ?? err);
    });

    // Raced against the child exiting, so a command that fails immediately
    // is reported at once instead of after the full start timeout.
    const exited = new Promise<never>((_, reject) => {
      child.once('exit', (code, signal) => reject(new Error(signal ? `stopped (${signal})` : `exited (code ${code})`)));
    });
    exited.catch(() => {}); // consumed for real by the race below; this only silences "unhandled" when waitForPort wins
    try {
      await Promise.race([waitForPort(port, START_TIMEOUT_MS), exited]);
      if (entry.state === 'starting') entry.state = 'running';
    } catch (err: any) {
      if (entry.state === 'starting') {
        entry.state = 'error';
        entry.error = String(err?.message ?? err);
      }
    }
    return this.status(cwd);
  }

  stop(cwd: string): boolean {
    const entry = this.byCwd.get(cwd);
    if (!entry) return false;
    entry.state = 'stopped';
    if (entry.child) {
      entry.child.kill('SIGTERM');
      const child = entry.child;
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 4000).unref();
    }
    this.byCwd.delete(cwd);
    return true;
  }

  touch(cwd: string): void {
    const entry = this.byCwd.get(cwd);
    if (entry) entry.lastActivityAt = Date.now();
  }

  /** Where a request to `/live/<pid>/…` should go, or null when it must be
   *  refused -- includes the "is this project actually configured" check,
   *  so a stale or forged pid can never reach an arbitrary port. */
  target(pid: string): { kind: 'command'; port: number } | { kind: 'static'; root: string } | null {
    const cwd = fromPid(pid);
    if (!cwd) return null;
    const entry = this.byCwd.get(cwd);
    if (!entry || entry.state !== 'running') return null;
    this.touch(cwd);
    if (entry.config.kind === 'command') return entry.port ? { kind: 'command', port: entry.port } : null;
    // Resolved and re-checked at request time in the proxy (path traversal),
    // same posture as images.ts: never trust a join() alone.
    try {
      return { kind: 'static', root: realpathSync(join(cwd, entry.config.dir)) };
    } catch {
      return null;
    }
  }

  sweepIdle(): void {
    const now = Date.now();
    for (const [cwd, entry] of this.byCwd) {
      if (entry.state === 'running' && now - entry.lastActivityAt > IDLE_STOP_MS) this.stop(cwd);
    }
  }

  /** For tests and shutdown: stop everything running. */
  stopAll(): void {
    for (const cwd of [...this.byCwd.keys()]) this.stop(cwd);
  }
}
