import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { dataDir } from './config.js';

const run = promisify(execFile);

/** Updates for people who installed Roost (agreed 2026-09-29): only
 *  versions the owner marks as ready -- git tags like v1.2 -- ever reach
 *  them, never every deploy. Read with git itself, so it works the same
 *  on a private or public repo, on any OS. */
export interface UpdateInfo {
  /** The newest release this install already has, or null. */
  current: string | null;
  /** The newest release on GitHub, or null. */
  latest: string | null;
  /** The release notes for `latest` (the tag's own message). */
  notes: string;
  available: boolean;
  checkedAt: number;
  error?: string;
}

/** The git checkout Roost was installed into: the folder holding the config
 *  and .roost-data -- not releases/current, which is a build copy. */
export const checkoutDir = () => dirname(dataDir());

const VERSION = /^v(\d+)\.(\d+)(?:\.(\d+))?$/;
export function compareVersions(a: string, b: string): number {
  const x = VERSION.exec(a), y = VERSION.exec(b);
  if (!x || !y) return 0;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i] ?? 0) - Number(y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
export function newestVersion(tags: string[]): string | null {
  const v = tags.map((t) => t.trim()).filter((t) => VERSION.test(t));
  return v.sort(compareVersions).at(-1) ?? null;
}

let cache: UpdateInfo | null = null;

export async function checkForUpdate(force = false, dir = checkoutDir()): Promise<UpdateInfo> {
  if (!force && cache && Date.now() - cache.checkedAt < 24 * 3600_000) return cache;
  const git = (...a: string[]) => run('git', a, { cwd: dir, timeout: 30_000 }).then((r) => r.stdout.trim());
  const info: UpdateInfo = { current: null, latest: null, notes: '', available: false, checkedAt: Date.now() };
  try {
    if (!existsSync(join(dir, '.git'))) throw new Error('not a git checkout');
    await git('fetch', '--tags', '--quiet', 'origin').catch(() => { /* offline: use what we have */ });
    const remote = (await git('ls-remote', '--tags', '--refs', 'origin').catch(() => ''))
      .split('\n').map((l) => l.split('refs/tags/')[1] ?? '').filter(Boolean);
    const local = (await git('tag', '--merged', 'HEAD')).split('\n');
    info.current = newestVersion(local);
    info.latest = newestVersion(remote.length ? remote : (await git('tag')).split('\n'));
    if (info.latest) {
      info.notes = await git('tag', '-l', '--format=%(contents)', info.latest).catch(() => '');
      // Available only when that release isn't already in this checkout --
      // the owner's own Mac is always ahead of its releases.
      const has = await git('merge-base', '--is-ancestor', info.latest, 'HEAD').then(() => true, () => false);
      info.available = !has;
    }
  } catch (err: any) {
    info.error = String(err?.message ?? err);
  }
  cache = info;
  return info;
}
