import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const tmp = mkdtempSync(join(tmpdir(), 'roost-verify-'));
process.env.ROOST_CONFIG = join(tmp, 'roost.config.json');
writeFileSync(process.env.ROOST_CONFIG, '{}');

const { gatesFrom, gateFingerprint, runGate, verifyTask, checkImages } = await import('../src/verify.js');
const { parseProjectFile } = await import('../src/projectFile.js');
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// ---- a tiny PNG encoder, so the image checks are tested on real files ----
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
function png(w: number, h: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const [r, g, b] = pixel(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// High byte of the LCG: its low byte has a period of 256 and deflates to nothing.
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >> 16) & 0xff; };

describe('gates come from the project file, not the agent', () => {
  it('parses bullets and backticks from ## gates', () => {
    const k = { sections: parseProjectFile('## gates\n- `npm test`\n* npm run lint\n\n# not a gate\n'), path: '', exists: true };
    expect(gatesFrom(k)).toEqual(['npm test', 'npm run lint']);
  });

  it('fingerprints the gate set so mid-task edits are caught', () => {
    expect(gateFingerprint(['a', 'b'])).not.toBe(gateFingerprint(['a', 'c']));
  });
});

describe('evidence is exit code and output, never a claim', () => {
  it('records a passing and a failing command faithfully', async () => {
    const ok = await runGate('node -e "console.log(\'fine\')"', tmp);
    expect(ok.exitCode).toBe(0);
    expect(ok.stdoutTail.trim()).toBe('fine');
    const bad = await runGate('node -e "console.error(\'boom\'); process.exit(3)"', tmp);
    expect(bad.exitCode).toBe(3);
    expect(bad.stderrTail).toContain('boom');
  });

  it('passes only when every gate exits 0', async () => {
    expect((await verifyTask({ cwd: tmp, checks: ['true', 'true'] })).passed).toBe(true);
    const r = await verifyTask({ cwd: tmp, checks: ['true', 'false'] });
    expect(r.passed).toBe(false);
    expect(r.summary).toContain('1/2 gates passed');
  });

  it('treats "nothing to check" as not verified', async () => {
    const r = await verifyTask({ cwd: tmp, checks: [] });
    expect(r.passed).toBe(false);
    expect(r.summary).toMatch(/no gates yet/);
    // not a pass, and not a failure: NOT VERIFIED (2026-09-24, it read FAILED)
    expect(r.unverified).toBe(true);
  });

  it('fails a run whose gate definitions changed since the task began', async () => {
    const r = await verifyTask({ cwd: tmp, checks: ['true'], fingerprintAtStart: gateFingerprint(['npm test']) });
    expect(r.tampered).toBe(true);
    expect(r.passed).toBe(false);
  });
});

describe('a screenshot has to look like one', () => {
  const dir = join(tmp, 'img');
  beforeAll(() => {
    mkdirSync(dir, { recursive: true });
    // A truly flat image deflates to ~150 bytes and dies on the size floor, so
    // the colour check needs something incompressible but low-colour: a random
    // two-colour checker.
    // (An LCG's low bit just alternates; take a high bit or the checker compresses to nothing.)
    writeFileSync(join(dir, 'flat.png'), png(256, 256, () => (rnd() & 0x40 ? [40, 40, 40] : [200, 200, 200])));
    writeFileSync(join(dir, 'solid.png'), png(64, 64, () => [40, 40, 40]));
    writeFileSync(join(dir, 'real.png'), png(128, 128, () => [rnd(), rnd(), rnd()]));
    writeFileSync(join(dir, 'real-copy.png'), png(64, 64, (x, y) => [(x * 7) & 0xff, (y * 5) & 0xff, ((x + y) * 3) & 0xff]));
    writeFileSync(join(dir, 'real-copy2.png'), png(64, 64, (x, y) => [(x * 7) & 0xff, (y * 5) & 0xff, ((x + y) * 3) & 0xff]));
    writeFileSync(join(dir, 'tiny.png'), Buffer.from('not really'));
  });

  it('rejects a low-colour frame on colour count and accepts a varied one', () => {
    const [flat, real] = checkImages([join(dir, 'flat.png'), join(dir, 'real.png')]);
    expect(flat.ok).toBe(false);
    expect(flat.reason).toMatch(/distinct colours/);
    expect(real.ok).toBe(true);
  });

  it('rejects a solid rectangle before even decoding it -- it is too small to be real', () => {
    const [solid] = checkImages([join(dir, 'solid.png')]);
    expect(solid.ok).toBe(false);
    expect(solid.reason).toMatch(/bytes/);
  });

  it('fails two pixel-identical frames in a set, both of them', () => {
    const [a, b] = checkImages([join(dir, 'real-copy.png'), join(dir, 'real-copy2.png')]);
    expect(a.ok).toBe(false);
    expect(b.reason).toMatch(/pixel-identical/);
  });

  it('never passes what it cannot decode or what is too small to be real', () => {
    const [tiny, missing] = checkImages([join(dir, 'tiny.png'), join(dir, 'nope.png')]);
    expect(tiny.ok).toBe(false);
    expect(missing.ok).toBe(false);
    expect(missing.reason).toMatch(/does not exist/);
  });
});
