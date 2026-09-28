#!/usr/bin/env node
/**
 * Pixel-art redraw of the avatar pool, matching the crew sprites' style.
 *
 * Same 30 subjects, ids, labels and background colours as
 * web/public/avatars/pool.json (read, never written); output goes to
 * web/public/avatars-pixel/ with its own pool.json. tools/gen-avatars.mjs is
 * untouched -- its flat-vector STYLE sentence stays with the original pool.
 *
 * Same cost note as gen-avatars.mjs: images ride the image quota, the driving
 * turn (~12k text tokens) rides the weekly Codex window -- so batch, and skip
 * files that already exist (resumable).
 *
 *   node tools/gen-avatars-pixel.mjs [--batch 4] [--limit 30] [--only owl,fox] [--model X]
 *
 * Raws (1024px): .roost-data/avatar-raw-pixel/. Tiles: 128px, nearest-neighbour
 * (PIL) so the pixel blocks stay crisp -- sips would blur them.
 */
import { spawn, execFile } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Codex drains stdin before it starts work: stdin MUST be 'ignore', which
 *  execFile silently does not support -- hence spawn. See gen-avatars.mjs. */
function runCodex(args, { cwd, timeout }) {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`timed out after ${timeout}ms`)); }, timeout);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve({ stdout: out }) : reject(new Error(err.trim().slice(-600) || `codex exited ${code}`));
    });
  });
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = join(ROOT, 'web', 'public', 'avatars', 'pool.json');
const OUT = join(ROOT, 'web', 'public', 'avatars-pixel');
const RAW = join(ROOT, '.roost-data', 'avatar-raw-pixel');
const MANIFEST = join(OUT, 'pool.json');
const SIZE = 128;

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const BATCH = Number(arg('batch', 4));
const LIMIT = Number(arg('limit', 30));
const ONLY = arg('only', '') ? arg('only', '').split(',') : null;
const MODEL = arg('model', '');

const source = JSON.parse(readFileSync(SRC, 'utf8'));
// Things without faces: drawn as pixel OBJECTS, never given eyes.
const OBJECTS = new Set(['robot', 'lighthouse', 'origami-crane', 'compass-rose', 'paper-plane', 'acorn',
  'hot-air-balloon', 'cactus', 'satellite', 'mushroom', 'anchor', 'telescope', 'sundial', 'kite', 'beacon']);

// Adapted from the crew STYLE block in scripts/scenes/gen.mjs. Changing it
// orphans tiles already generated -- delete them to regenerate.
const STYLE = [
  'CRITICAL: save each image into the CURRENT WORKING DIRECTORY under the exact filename given.',
  'CRITICAL: this MUST be literal retro PIXEL ART -- like a 16-bit console game sprite -- NOT a smooth',
  'painterly illustration, NOT soft-shaded, NOT airbrushed, NOT a glossy vector/clipart icon.',
  '',
  'Style, changing only the subject and background colour:',
  '"Square pixel art avatar tile: a cute chunky {SUBJECT} sprite centered on a SOLID FLAT {COLOUR} background',
  'that fills the entire square frame edge to edge (no border, no frame, no vignette, no pattern).',
  'The subject fills about 70 percent of the tile, crisp dark one-pixel outline, LOW RESOLUTION with large',
  'VISIBLE SQUARE PIXEL BLOCKS and hard aliased edges (absolutely no smoothing, no soft gradients, no',
  'anti-aliasing, no airbrush shading -- flat blocks of colour only, like classic 16-bit game sprite art),',
  '{EYES} no text, no lettering, no drop shadow, no ground."',
].join('\n');

const planned = source.avatars.map((a) => ({ ...a, subject: a.label.toLowerCase() }));
mkdirSync(OUT, { recursive: true });
mkdirSync(RAW, { recursive: true });

const todo = planned
  .filter((p) => !ONLY || ONLY.includes(p.slug))
  .filter((p) => !existsSync(join(OUT, `${p.slug}.png`)))
  .slice(0, LIMIT);

async function toTile(p) {
  const raw = join(RAW, `raw-${p.slug}.png`);
  if (!existsSync(raw)) return false;
  await run('python3', ['-c', [
    'import sys; from PIL import Image',
    'im = Image.open(sys.argv[1]).convert("RGB"); w, h = im.size; s = min(w, h)',
    'im = im.crop(((w-s)//2, (h-s)//2, (w-s)//2+s, (h-s)//2+s))',
    'im.resize((int(sys.argv[3]),)*2, Image.NEAREST).save(sys.argv[2])',
  ].join('\n'), raw, join(OUT, `${p.slug}.png`), String(SIZE)]);
  return true;
}

console.log(`Generating ${todo.length} pixel avatar(s) in batches of ${BATCH}.`);
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  // A raw left by an earlier run that died before downscaling: just convert it.
  const need = [];
  for (const p of batch) if (!(await toTile(p))) need.push(p);
  if (!need.length) continue;
  const lines = need.map((p, n) => {
    const eyes = OBJECTS.has(p.slug)
      ? 'drawn as a pixel OBJECT with NO face and NO eyes,'
      : 'BIG FRIENDLY PIXEL EYES with a single white highlight pixel in each,';
    return `${n + 1}. SUBJECT = ${p.subject}; COLOUR = ${p.color}; EYES clause = "${eyes}" -> save as raw-${p.slug}.png`;
  }).join('\n');
  const prompt = [
    `Use your built-in image_gen tool to generate ${need.length} separate 1024x1024 square images.`,
    '', STYLE, '', lines, '',
    'Use the image_gen tool directly for each one. Do not write code or scripts.',
  ].join('\n');
  console.log(`\n[batch] ${need.map((b) => b.slug).join(', ')}`);
  try {
    const argv = ['exec', '-s', 'workspace-write', '--skip-git-repo-check', '-C', RAW];
    if (MODEL) argv.push('-m', MODEL);
    argv.push(prompt);
    const { stdout } = await runCodex(argv, { cwd: RAW, timeout: 20 * 60_000 });
    const used = /tokens used\s*\n?\s*([\d,]+)/i.exec(stdout)?.[1];
    if (used) console.log(`  turn cost: ${used} text tokens`);
  } catch (e) {
    console.log(`  batch failed: ${e.message}`);
  }
  for (const p of need) console.log(`  ${(await toTile(p)) ? 'ok' : 'MISSING'} ${p.slug}`);
}

const rows = planned
  .filter((p) => existsSync(join(OUT, `${p.slug}.png`)))
  .map(({ subject, ...a }) => ({ ...a, file: `/avatars-pixel/${a.slug}.png` }));
writeFileSync(MANIFEST, JSON.stringify({ ...source, avatars: rows }, null, 2) + '\n');
console.log(`\nManifest: ${rows.length} avatars -> ${MANIFEST}`);
