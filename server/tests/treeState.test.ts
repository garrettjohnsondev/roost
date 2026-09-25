import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { treeFingerprint } from '../src/treeState.js';

describe('did the project change? git says, however the files were written', () => {
  it('changes when a file is edited, created, or committed; stays put otherwise', async () => {
    const d = mkdtempSync(join(tmpdir(), 'roost-tree-'));
    const g = (...a: string[]) => execFileSync('git', a, { cwd: d, stdio: 'ignore' });
    g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
    writeFileSync(join(d, 'a.txt'), '1'); g('add', '.'); g('commit', '-qm', 'x');
    const a = await treeFingerprint(d);
    expect(await treeFingerprint(d)).toBe(a);
    writeFileSync(join(d, 'a.txt'), '2'); // an edit made by a script, not an edit tool
    const b = await treeFingerprint(d);
    expect(b).not.toBe(a);
    writeFileSync(join(d, 'new.txt'), 'n');
    const c = await treeFingerprint(d);
    expect(c).not.toBe(b);
    g('add', '.'); g('commit', '-qm', 'y');
    expect(await treeFingerprint(d)).not.toBe(c);
  });
  it('is null outside a repository', async () => {
    expect(await treeFingerprint(mkdtempSync(join(tmpdir(), 'roost-nogit-')))).toBeNull();
  });
});
