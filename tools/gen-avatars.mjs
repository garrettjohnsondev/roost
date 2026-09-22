#!/usr/bin/env node
/**
 * Generate the avatar pool with Codex's built-in `image_gen` tool.
 *
 * Run rarely, by a maintainer -- the output is COMMITTED and shipped. Users
 * picking an avatar must never trigger generation: it would spend their own
 * weekly window, take minutes, and require them to have Codex at all.
 *
 * Cost note: the images ride the unlimited image quota, but the turn driving
 * them does NOT -- roughly 12k text tokens per turn against the weekly Codex
 * window. Hence batching, the light model, and resumability.
 *
 *   node tools/gen-avatars.mjs [--batch 4] [--limit 12] [--model gpt-5.6-luna]
 */
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Codex drains stdin before it starts work, so an inherited or piped stdin
 *  makes it hang indefinitely. execFile IGNORES a `stdio` option -- it is not
 *  one of its supported keys -- so this must be spawn. Reintroducing that bug
 *  cost an 8-minute silent hang that produced nothing. */
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
const OUT = join(ROOT, 'web', 'public', 'avatars');
// 1024px originals are working files. They used to land in web/public too,
// where Vite copies EVERYTHING into dist: a 560 KB pool shipped as a 31 MB
// bundle on any machine that had run the generator.
const RAW = join(ROOT, '.pocket-data', 'avatar-raw');
const MANIFEST = join(OUT, 'pool.json');
const SIZE = 128;

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const BATCH = Number(arg('batch', 4));
const LIMIT = Number(arg('limit', 12));
// Default model, deliberately: the light model drifted to shaded cartoon when
// asked for flat vector. The text model writes the image prompt, so a stronger
// one holds the style clause better -- and style consistency across the pool
// matters more here than the token difference on a one-off build step.
const MODEL = arg('model', '');

const palette = JSON.parse(readFileSync(join(HERE, 'avatars', 'palette.json'), 'utf8'));
const subjects = JSON.parse(readFileSync(join(HERE, 'avatars', 'subjects.json'), 'utf8'));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Subject i gets palette colour i, so the pool never repeats a pairing and
 *  every avatar's chip colour is KNOWN rather than sampled back out of a PNG. */
const planned = subjects.map((subject, i) => {
  const colour = palette[i % palette.length];
  return { subject, slug: slug(subject), colour: colour.hex, colourName: colour.name };
});

mkdirSync(OUT, { recursive: true });
mkdirSync(RAW, { recursive: true });

const todo = planned.filter((p) => !existsSync(join(OUT, `${p.slug}.png`))).slice(0, LIMIT);
if (!todo.length) {
  console.log('Nothing to generate — every planned avatar already exists.');
  writeManifest();
  process.exit(0);
}
console.log(`Generating ${todo.length} avatar(s) in batches of ${BATCH} on ${MODEL}.`);

for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  const lines = batch
    .map((p, n) => `${n + 1}. a ${p.subject} on a solid ${p.colour} background -> save as raw-${p.slug}.png`)
    .join('\n');
  // The style sentence is passed through VERBATIM so every batch -- and every
  // later top-up run -- lands in the same art direction. Changing this string
  // orphans the avatars already generated.
  const prompt = [
    `Use your built-in image_gen tool to generate ${batch.length} separate 1024x1024 avatar images.`,
    '',
    'For EACH image, use exactly this style description, changing only the subject and background colour:',
    '"Minimal flat vector icon of a {SUBJECT}, centered, front-facing, simple geometric shapes,',
    'limited palette of 3-4 flat colours, no shading, no gradients, no drop shadows, no outline glow,',
    'no text or lettering, solid {COLOUR} background filling the entire frame, subject fills about',
    '70 percent of the frame, clean vector illustration in the style of a modern app icon."',
    '',
    lines,
    '',
    'Use the image_gen tool directly for each one. Do not write code or scripts.',
    'Do not add shading or gradients even if it would look nicer -- flatness is the point.',
  ].join('\n');

  console.log(`\n[batch ${i / BATCH + 1}] ${batch.map((b) => b.slug).join(', ')}`);
  try {
    const argv = ['exec', '-s', 'workspace-write', '--skip-git-repo-check', '-C', RAW];
    if (MODEL) argv.push('-m', MODEL);
    argv.push(prompt);
    const { stdout } = await runCodex(argv, { cwd: RAW, timeout: 20 * 60_000 });
    const used = /tokens used\s*\n?\s*([\d,]+)/i.exec(stdout)?.[1];
    if (used) console.log(`  turn cost: ${used} text tokens`);
  } catch (e) {
    console.log(`  batch failed: ${e.shortMessage ?? e.message}`);
    continue;
  }

  for (const p of batch) {
    const raw = join(RAW, `raw-${p.slug}.png`);
    if (!existsSync(raw)) { console.log(`  MISSING ${p.slug}`); continue; }
    await run('sips', ['-z', String(SIZE), String(SIZE), raw, '--out', join(OUT, `${p.slug}.png`)]);
    console.log(`  ok ${p.slug}`);
  }
}


writeManifest();

function writeManifest() {
  const rows = planned
    .filter((p) => existsSync(join(OUT, `${p.slug}.png`)))
    .map((p) => ({
      slug: p.slug,
      label: p.subject.replace(/\b\w/g, (c) => c.toUpperCase()),
      file: `/avatars/${p.slug}.png`,
      color: p.colour,
      colorName: p.colourName,
    }));
  writeFileSync(MANIFEST, JSON.stringify({ version: 1, avatars: rows, palette }, null, 2) + '\n');
  console.log(`\nManifest: ${rows.length} avatars -> ${MANIFEST}`);
}
