import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, validName } from '../src/newProject.js';

describe('a new project from the phone', () => {
  it('makes the folder, a README and a first commit (no GitHub when asked for none)', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'np-'));
    const r = await createProject(parent, 'yayo-bay', 'none', 'A beach game.');
    expect(existsSync(join(r.path, '.git'))).toBe(true);
    expect(readFileSync(join(r.path, 'README.md'), 'utf8')).toMatch(/# yayo-bay\n\nA beach game\./);
    expect(execFileSync('git', ['log', '--oneline'], { cwd: r.path, encoding: 'utf8' })).toMatch(/First commit/);
    expect(r.repoUrl).toBeNull();
  });
  it('refuses odd names and existing folders', async () => {
    expect(validName('../x')).toBe(false);
    expect(validName('my app')).toBe(false);
    const parent = mkdtempSync(join(tmpdir(), 'np-'));
    await createProject(parent, 'a', 'none');
    await expect(createProject(parent, 'a', 'none')).rejects.toThrow(/already exists/);
  });
});
