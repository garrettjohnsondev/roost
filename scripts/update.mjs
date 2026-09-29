#!/usr/bin/env node
// Install a tagged Roost release (the in-app Update button runs this).
//
//   node scripts/update.mjs v1.2
//
// Moves the checkout to that tag, installs dependencies, and hands off to
// the normal deploy (scripts/service.mjs install): build, check, promote,
// restart. If the checks fail, the running version stays and the checkout
// goes back to where it was. Works on macOS, Linux and Windows.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tag = process.argv[2];
const log = join(root, '.roost-data', 'update.log');
mkdirSync(dirname(log), { recursive: true });
const say = (s) => { const line = `${new Date().toISOString()} ${s}\n`; appendFileSync(log, line); process.stdout.write(line); };
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
const out = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }).trim();

if (!/^v\d+\.\d+(\.\d+)?$/.test(tag ?? '')) { say(`update: "${tag}" is not a version tag`); process.exit(2); }
const before = out('git', ['rev-parse', 'HEAD']);
say(`update: ${before.slice(0, 7)} → ${tag}`);
try {
  run('git', ['fetch', '--tags', '--quiet', 'origin']);
  run('git', ['checkout', '--quiet', tag]);
  run(npm, ['ci', '--no-audit', '--no-fund']);
  run(process.execPath, [join('scripts', 'service.mjs'), 'install']);
  say(`update: ${tag} installed`);
} catch (err) {
  say(`update: ${tag} failed (${err?.message ?? err}); going back to ${before.slice(0, 7)}`);
  try { run('git', ['checkout', '--quiet', before]); run(npm, ['ci', '--no-audit', '--no-fund']); } catch { /* the running release is untouched either way */ }
  process.exit(1);
}
