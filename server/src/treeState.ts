import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';

/** What the working tree looks like right now, as one hash: the commit, the
 *  uncommitted diff and the untracked files. Two readings differ exactly when
 *  something in the project changed between them -- however it changed.
 *
 *  2026-09-25: automatic checks keyed on the EDIT tool, and most edits are made
 *  by commands (a script, a sed, a heredoc), so a job that changed a dozen files
 *  looked like it changed none, and no check ever ran. Asking git is the one
 *  answer that does not depend on how the files were written. null: not a git
 *  repository, or git is unavailable -- the caller falls back to the tools. */
function git(args: string[], cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, timeout: 15_000 }, (err, out) => resolve(err ? null : String(out ?? '')));
  });
}

export async function treeFingerprint(cwd: string): Promise<string | null> {
  const head = await git(['rev-parse', 'HEAD'], cwd);
  if (head == null) return null;
  const status = (await git(['status', '--porcelain=v1', '-uall'], cwd)) ?? '';
  const diff = (await git(['diff', 'HEAD', '--no-color'], cwd)) ?? '';
  return createHash('sha1').update(head).update('\0').update(status).update('\0').update(diff).digest('hex');
}
