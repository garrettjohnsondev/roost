import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getGitDiff, getGitStatus, gitCommit } from '../src/git.js';

let repo: string;
const sh = (args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'pocket-git-'));
  execFileSync('git', ['init', '-b', 'main', repo]);
  sh(['config', 'user.email', 'test@pocket.local']);
  sh(['config', 'user.name', 'Pocket Test']);
});

describe('git backend', () => {
  it('reports a non-repo directory gracefully', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'pocket-plain-'));
    const status = await getGitStatus(plain);
    expect(status.isRepo).toBe(false);
  });

  it('shows untracked files with a diff even before the first commit', async () => {
    writeFileSync(join(repo, 'hello.txt'), 'hello world\n');
    const status = await getGitStatus(repo);
    expect(status.isRepo).toBe(true);
    expect(status.hasCommits).toBe(false);
    expect(status.branch).toBe('main');
    expect(status.files).toEqual([{ path: 'hello.txt', status: '??', untracked: true }]);

    const diff = await getGitDiff(repo, 'hello.txt');
    expect(diff).toContain('+hello world');
  });

  it('commits everything and leaves a clean tree', async () => {
    const out = await gitCommit(repo, 'first commit from pocket');
    expect(out).toContain('first commit from pocket');
    const status = await getGitStatus(repo);
    expect(status.hasCommits).toBe(true);
    expect(status.files).toHaveLength(0);
  });

  it('reports modifications with line counts and a real diff', async () => {
    writeFileSync(join(repo, 'hello.txt'), 'goodbye world\nsecond line\n');
    const status = await getGitStatus(repo);
    expect(status.files).toHaveLength(1);
    expect(status.files[0]).toMatchObject({ path: 'hello.txt', untracked: false, additions: 2, deletions: 1 });

    const diff = await getGitDiff(repo, 'hello.txt');
    expect(diff).toContain('-hello world');
    expect(diff).toContain('+goodbye world');
  });

  it('handles paths with spaces', async () => {
    writeFileSync(join(repo, 'my notes.md'), 'notes\n');
    const status = await getGitStatus(repo);
    const file = status.files.find((f) => f.path === 'my notes.md');
    expect(file).toBeDefined();
    expect(file!.untracked).toBe(true);
    await gitCommit(repo, 'add notes');
    expect((await getGitStatus(repo)).files).toHaveLength(0);
  });
});
