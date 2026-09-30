#!/usr/bin/env node
// Draw a crew member's dressed working frames when they level into a new
// outfit (2026-09-30), then ship them.
//
//   node scripts/outfit-art.mjs wren:3
//
// Runs gen.mjs outfitwork (Codex image_gen on the workhorse model), converts
// the drawings into web/public/crew, and deploys through the normal checked
// pipeline so the app serves them. Only possible where the original drawings
// live (.roost-data/sprite-raw) -- the owner's machine.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const log = join(root, '.roost-data', 'gen-logs', 'outfit-art.log');
mkdirSync(dirname(log), { recursive: true });
const say = (s) => appendFileSync(log, `${new Date().toISOString()} ${s}\n`);
const args = process.argv.slice(2).filter((a) => /^[a-z]+:[1-4]$/.test(a));
if (!args.length) process.exit(2);
const run = (cmd, a) => execFileSync(cmd, a, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 6 * 3600_000 });
try {
  for (const a of args) {
    const [name, tier] = a.split(':');
    if (!existsSync(join(root, '.roost-data', 'sprite-raw', 'outfits', name, `${name}-tier${tier}.png`))) { say(`${a}: no tier drawing to start from`); continue; }
    say(`${a}: drawing`);
    run(process.execPath, [join('scripts', 'scenes', 'gen.mjs'), 'outfitwork', a]);
    say(run('python3', [join('scripts', 'scenes', 'convert.py'), 'outfitwork', a]).trim().split('\n').filter((l) => /DRIFT|missing|empty/.test(l)).join(' | ') || `${a}: converted`);
  }
  run(process.execPath, [join('scripts', 'service.mjs'), 'install']);
  say(`${args.join(' ')}: shipped`);
} catch (e) {
  say(`${args.join(' ')}: failed ${String(e?.message ?? e).slice(0, 300)}`);
  process.exit(1);
}
