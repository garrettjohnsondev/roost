import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** A new project from the phone (roadmap #45): a folder, a first commit, and
 *  optionally a GitHub repo -- "That's huge to me". GitHub goes through the
 *  `gh` CLI the Mac is already signed in to; nothing here holds a token. */
export type Visibility = 'private' | 'public' | 'none';
export interface NewProjectResult { path: string; repoUrl: string | null; steps: string[] }

export function validName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name) && !name.includes('..');
}

export async function createProject(parent: string, name: string, visibility: Visibility, blurb = ''): Promise<NewProjectResult> {
  if (!validName(name)) throw new Error('Use letters, numbers, dots, dashes or underscores for the name.');
  if (!existsSync(parent)) throw new Error(`${parent} doesn't exist.`);
  const path = join(parent, name);
  if (existsSync(path)) throw new Error(`${path} already exists.`);
  const steps: string[] = [];
  mkdirSync(path);
  steps.push(`Made ${path}`);
  writeFileSync(join(path, 'README.md'), `# ${name}\n\n${blurb.trim() || 'Started from Roost.'}\n`);
  writeFileSync(join(path, '.gitignore'), 'node_modules/\n.DS_Store\n.env\n.env.*\ndist/\n');
  const git = (...a: string[]) => run('git', a, { cwd: path });
  await git('init', '-b', 'main');
  await git('add', '-A');
  // A fresh machine may have no git identity yet; commit as Roost then
  // rather than fail (CI, 2026-09-29).
  const named = await run('git', ['config', 'user.email'], { cwd: path }).then((r) => !!r.stdout.trim(), () => false);
  await git(...(named ? [] : ['-c', 'user.name=Roost', '-c', 'user.email=roost@localhost']), 'commit', '-m', 'First commit, from Roost');
  steps.push('First commit');
  let repoUrl: string | null = null;
  if (visibility !== 'none') {
    try {
      await run('gh', ['repo', 'create', name, `--${visibility}`, '--source', '.', '--remote', 'origin', '--push'], { cwd: path });
      const { stdout } = await run('gh', ['repo', 'view', '--json', 'url', '-q', '.url'], { cwd: path });
      repoUrl = stdout.trim() || null;
      steps.push(`GitHub repo (${visibility})${repoUrl ? `: ${repoUrl}` : ''}`);
    } catch (err: any) {
      // The folder and commit stand; only GitHub failed. Say so plainly.
      steps.push(`GitHub didn't work: ${String(err?.stderr || err?.message || err).trim().split('\n')[0]}`);
    }
  }
  return { path, repoUrl, steps };
}
