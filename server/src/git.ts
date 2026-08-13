import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { truncate } from './util.js';

const run = promisify(execFile);

async function git(cwd: string, args: string[], timeoutMs = 15_000): Promise<string> {
  const { stdout } = await run('git', ['-C', cwd, ...args], {
    timeout: timeoutMs,
    // Never let git sit waiting for credentials on a headless server.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

export interface GitFile {
  path: string;
  /** Two-letter porcelain XY code, e.g. " M", "A ", "??". */
  status: string;
  additions?: number;
  deletions?: number;
  untracked: boolean;
}

export interface GitStatusResult {
  isRepo: boolean;
  branch?: string;
  ahead?: number;
  behind?: number;
  hasCommits: boolean;
  files: GitFile[];
}

export async function getGitStatus(cwd: string): Promise<GitStatusResult> {
  try {
    await git(cwd, ['rev-parse', '--git-dir']);
  } catch {
    return { isRepo: false, hasCommits: false, files: [] };
  }
  let hasCommits = true;
  try {
    await git(cwd, ['rev-parse', 'HEAD']);
  } catch {
    hasCommits = false;
  }

  const statusOut = await git(cwd, ['status', '--porcelain=v1', '-b']);
  const lines = statusOut.split('\n').filter(Boolean);

  let branch: string | undefined;
  let ahead: number | undefined;
  let behind: number | undefined;
  const files: GitFile[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      // "## main...origin/main [ahead 2, behind 1]" | "## main" | "## No commits yet on main"
      const header = line.slice(3);
      branch = header.replace(/^No commits yet on /, '').split('...')[0].split(' ')[0];
      ahead = Number(header.match(/ahead (\d+)/)?.[1] ?? 0) || undefined;
      behind = Number(header.match(/behind (\d+)/)?.[1] ?? 0) || undefined;
      continue;
    }
    const status = line.slice(0, 2);
    let path = line.slice(3);
    if (status.startsWith('R') || status.startsWith('C')) path = path.split(' -> ')[1] ?? path;
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
    files.push({ path, status, untracked: status === '??' });
  }

  // Line counts for tracked changes (worktree+index vs HEAD).
  if (hasCommits && files.some((f) => !f.untracked)) {
    try {
      const numstat = await git(cwd, ['diff', 'HEAD', '--numstat']);
      const counts = new Map<string, { additions: number; deletions: number }>();
      for (const line of numstat.split('\n').filter(Boolean)) {
        const [add, del, ...rest] = line.split('\t');
        counts.set(rest.join('\t'), { additions: Number(add) || 0, deletions: Number(del) || 0 });
      }
      for (const f of files) {
        const c = counts.get(f.path);
        if (c) Object.assign(f, c);
      }
    } catch {
      /* counts are decorative */
    }
  }

  return { isRepo: true, branch, ahead, behind, hasCommits, files };
}

const DIFF_CAP = 200_000;

export async function getGitDiff(cwd: string, path: string): Promise<string> {
  const status = await getGitStatus(cwd);
  const file = status.files.find((f) => f.path === path);
  if (file?.untracked) {
    // `git diff --no-index` exits 1 when the files differ — that's success here.
    try {
      return truncate(await git(cwd, ['diff', '--no-index', '--', '/dev/null', path]), DIFF_CAP);
    } catch (err: any) {
      if (typeof err?.stdout === 'string' && err.stdout) return truncate(err.stdout, DIFF_CAP);
      throw err;
    }
  }
  const base = status.hasCommits ? ['diff', 'HEAD', '--', path] : ['diff', '--cached', '--', path];
  return truncate(await git(cwd, base), DIFF_CAP);
}

export async function gitCommit(cwd: string, message: string): Promise<string> {
  await git(cwd, ['add', '-A']);
  const out = await git(cwd, ['commit', '-m', message]);
  return truncate(out, 2000);
}

export interface GitSummary {
  files: number;
  ahead: number;
}

let summariesCache: { at: number; data: Record<string, GitSummary> } | null = null;
const SUMMARIES_TTL_MS = 30_000;

/** Light dirty-state overview for the home screen's per-project badges. */
export async function getGitSummaries(cwds: string[]): Promise<Record<string, GitSummary>> {
  if (summariesCache && Date.now() - summariesCache.at < SUMMARIES_TTL_MS) return summariesCache.data;
  const data: Record<string, GitSummary> = {};
  await Promise.all(
    cwds.map(async (cwd) => {
      try {
        const status = await getGitStatus(cwd);
        if (status.isRepo) data[cwd] = { files: status.files.length, ahead: status.ahead ?? 0 };
      } catch {
        /* non-repo or git hiccup — no badge */
      }
    }),
  );
  summariesCache = { at: Date.now(), data };
  return data;
}

export async function gitPush(cwd: string): Promise<string> {
  try {
    // Push output (branch tracking info etc.) goes to stderr on success.
    const { stdout, stderr } = await run('git', ['-C', cwd, 'push'], {
      timeout: 60_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      maxBuffer: 1024 * 1024,
    });
    return truncate((stdout + '\n' + stderr).trim(), 2000);
  } catch (err: any) {
    throw new Error(truncate(String(err?.stderr || err?.message || err), 500));
  }
}
