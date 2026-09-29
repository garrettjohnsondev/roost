import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkForUpdate, compareVersions, newestVersion } from '../src/updates.js';

const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' });

describe('updates reach people only as tagged versions', () => {
  it('orders versions numerically', () => {
    expect(compareVersions('v1.10', 'v1.9')).toBeGreaterThan(0);
    expect(newestVersion(['v1.0', 'v1.2.1', 'v1.2', 'nightly', ''])).toBe('v1.2.1');
    expect(newestVersion(['wip'])).toBeNull();
  });

  it('offers a newer tag on the origin, and not one already installed', async () => {
    const origin = mkdtempSync(join(tmpdir(), 'up-origin-'));
    sh(origin, 'init', '-q', '-b', 'main');
    sh(origin, 'config', 'user.email', 't@t'); sh(origin, 'config', 'user.name', 't');
    writeFileSync(join(origin, 'a'), '1'); sh(origin, 'add', '.'); sh(origin, 'commit', '-qm', 'one');
    sh(origin, 'tag', '-a', 'v1.0', '-m', 'First release');
    const clone = mkdtempSync(join(tmpdir(), 'up-clone-'));
    sh(clone, 'clone', '-q', origin, '.');
    let u = await checkForUpdate(true, clone);
    expect(u).toMatchObject({ current: 'v1.0', latest: 'v1.0', available: false });
    writeFileSync(join(origin, 'a'), '2'); sh(origin, 'commit', '-qam', 'two');
    sh(origin, 'tag', '-a', 'v1.1', '-m', 'Crew Kart, faster.');
    u = await checkForUpdate(true, clone);
    expect(u).toMatchObject({ current: 'v1.0', latest: 'v1.1', available: true });
    expect(u.notes).toMatch(/Crew Kart, faster/);
  });
});
