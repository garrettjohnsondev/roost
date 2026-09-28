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
    path = unquoteGitPath(path);
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

/** `git status --porcelain` quotes paths with special characters using C-style
 *  escapes ("caf\\303\\251.txt"). Stripping only the quotes handed back a path
 *  that does not exist. Decode the escapes into bytes, then UTF-8. */
function unquoteGitPath(p: string): string {
  if (!(p.startsWith('"') && p.endsWith('"'))) return p;
  const inner = p.slice(1, -1);
  const bytes: number[] = [];
  const simple: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 };
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c !== '\\') {
      bytes.push(...Buffer.from(c, 'utf8'));
      continue;
    }
    const n = inner[++i];
    if (n === undefined) break;
    if (/[0-7]/.test(n)) {
      let oct = n;
      while (oct.length < 3 && /[0-7]/.test(inner[i + 1] ?? '')) oct += inner[++i];
      bytes.push(parseInt(oct, 8));
    } else {
      bytes.push(simple[n] ?? n.charCodeAt(0));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

export interface ShippedEntry {
  hash: string;
  subject: string;
  /** ms since epoch */
  at: number;
  author: string;
  /** Crew named in the commit: Roost's own "Roost-Crew:" trailer, else a model
   *  named in "Co-Authored-By:". */
  crewNames: string[];
  coAuthors: string[];
}

/** The project's story, from git -- the one record of finished work that
 *  survives sessions closing (2026-09-27: the Map moves into each project and
 *  fills itself from what actually shipped, not from a ROADMAP.md). */
export async function getGitHistory(cwd: string, limit = 80): Promise<ShippedEntry[]> {
  const US = '\x1f';
  const RS = '\x1e';
  let out: string;
  try {
    out = await git(cwd, ['log', `-${Math.max(1, Math.min(500, limit))}`, `--format=%h${US}%s${US}%at${US}%an${US}%(trailers:key=Roost-Crew,valueonly,separator=|)${US}%(trailers:key=Co-Authored-By,valueonly,separator=|)${RS}`]);
  } catch {
    return []; // not a repo, or no commits yet
  }
  return out
    .split(RS)
    .map((r) => r.replace(/^\n+/, ''))
    .filter((r) => r.includes(US))
    .map((r) => {
      const [hash, subject, at, author, crew, co] = r.split(US);
      return {
        hash,
        subject,
        at: Number(at) * 1000,
        author,
        crewNames: (crew ?? '').split(/[|,]/).map((s) => s.trim()).filter(Boolean),
        coAuthors: (co ?? '').split('|').map((s) => s.replace(/<[^>]*>/, '').trim()).filter(Boolean),
      };
    });
}
