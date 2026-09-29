import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkImagePath, imageRoots } from '../src/images.js';

// A project root OUTSIDE the temp folders, so "outside the roots" is testable.
const home = mkdtempSync(join(homedir(), '.roost-img-test-'));
const project = join(home, 'project');
const elsewhere = join(home, 'elsewhere');
let roots: string[];

let canLink = false;
beforeAll(() => {
  mkdirSync(project, { recursive: true });
  mkdirSync(elsewhere, { recursive: true });
  writeFileSync(join(project, 'shot.png'), 'png');
  writeFileSync(join(project, 'notes.txt'), 'secret');
  writeFileSync(join(project, 'logo.svg'), '<svg onload="alert(1)"/>');
  writeFileSync(join(elsewhere, 'private.png'), 'png');
  writeFileSync(join(elsewhere, 'id_rsa'), 'key');
  // Creating symlinks needs admin or developer mode on Windows.
  try {
    symlinkSync(join(elsewhere, 'id_rsa'), join(project, 'sneaky.png'));
    symlinkSync(join(elsewhere, 'private.png'), join(project, 'linked.png'));
    canLink = true;
  } catch { canLink = false; }
  const t = mkdtempSync(join(tmpdir(), 'roost-img-'));
  writeFileSync(join(t, 'sheet.png'), 'png');
  roots = imageRoots([project], join(home, 'data'));
  (globalThis as any).__tmpShot = join(t, 'sheet.png');
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

describe('the phone sees images, and only images, from where agents write them', () => {
  it('serves a png inside a project', () => {
    const r = checkImagePath(join(project, 'shot.png'), roots);
    expect(r.ok).toBe(true);
  });
  it('serves a png from the temp folder (where screenshots and sheets land)', () => {
    expect(checkImagePath((globalThis as any).__tmpShot, roots).ok).toBe(true);
  });
  it('refuses anything that is not a raster image, SVG included', () => {
    expect(checkImagePath(join(project, 'notes.txt'), roots)).toMatchObject({ ok: false, status: 403 });
    expect(checkImagePath(join(project, 'logo.svg'), roots)).toMatchObject({ ok: false, status: 403 });
  });
  it('refuses an image outside the roots', () => {
    expect(checkImagePath(join(elsewhere, 'private.png'), roots)).toMatchObject({ ok: false, status: 403 });
  });
  it('follows symlinks before deciding: a link named .png to a key, or to an outside image, is refused', (ctx) => {
    if (!canLink) ctx.skip();
    expect(checkImagePath(join(project, 'sneaky.png'), roots)).toMatchObject({ ok: false, status: 403 });
    expect(checkImagePath(join(project, 'linked.png'), roots)).toMatchObject({ ok: false, status: 403 });
  });
  it('refuses traversal and relative paths', () => {
    expect(checkImagePath(join(project, '..', 'elsewhere', 'private.png'), roots)).toMatchObject({ ok: false, status: 403 });
    expect(checkImagePath('shot.png', roots)).toMatchObject({ ok: false, status: 400 });
  });
  it('says a vanished temp image is gone, rather than failing blank', () => {
    const r = checkImagePath(join(project, 'deleted.png'), roots);
    expect(r).toMatchObject({ ok: false, status: 404 });
    if (!r.ok) expect(r.reason).toMatch(/gone/);
  });
});
