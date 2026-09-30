#!/usr/bin/env node
// Keep the AI software current, so nobody runs on old models (2026-09-29).
//
//   node scripts/agents-update.mjs          check and update what's behind
//   node scripts/agents-update.mjs --check  just report
//
// Roost never keeps its own model list: it asks Claude and Codex which models
// they have, and they answer from the software on this computer. So new models
// arrive when that software updates:
//   - Claude: the Agent SDK in Roost's own node_modules (it carries Claude
//     Code inside). Updated with --no-save, so the checkout stays clean for
//     Roost's own updates; after one, the normal deploy rebuilds, checks and
//     restarts -- and if those checks fail, the SDK goes back to the locked one.
//   - Codex: the `codex` program, updated the way it was installed (npm global
//     or Homebrew). Anything else is only reported.
// The result goes to .roost-data/agents-update.json for the app to show.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const win = process.platform === 'win32';
const npm = win ? 'npm.cmd' : 'npm';
const checkOnly = process.argv.includes('--check');
const quiet = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120_000, shell: win };
const out = (cmd, args, opts = {}) => { try { return execFileSync(cmd, args, { ...quiet, ...opts }).trim(); } catch { return null; } };
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', timeout: 600_000, shell: win });

const newer = (a, b) => {
  const x = String(a ?? '').split('.').map(Number), y = String(b ?? '').split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
  return false;
};

const report = { checkedAt: Date.now(), claude: {}, codex: {}, updated: [] };

// ---- Claude (the Agent SDK) ---------------------------------------------------
const sdkPkg = join(root, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json');
const sdkHave = existsSync(sdkPkg) ? JSON.parse(readFileSync(sdkPkg, 'utf8')).version : null;
const sdkLatest = out(npm, ['view', '@anthropic-ai/claude-agent-sdk', 'version']);
report.claude = { have: sdkHave, latest: sdkLatest };
let sdkChanged = false;
if (sdkHave && sdkLatest && newer(sdkLatest, sdkHave) && !checkOnly) {
  try {
    run(npm, ['install', '--no-save', '--no-audit', '--no-fund', '-w', 'server', `@anthropic-ai/claude-agent-sdk@${sdkLatest}`]);
    sdkChanged = true;
    report.updated.push(`Claude ${sdkHave} → ${sdkLatest}`);
  } catch (e) {
    report.claude.error = String(e?.message ?? e).slice(0, 200);
  }
}

// ---- Codex --------------------------------------------------------------------
const codexHave = (out('codex', ['--version']) ?? '').match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
const codexLatest = out(npm, ['view', '@openai/codex', 'version']);
let how = 'unknown';
if (codexHave) {
  const where = out(win ? 'where' : 'which', ['codex'])?.split(/\r?\n/)[0] ?? '';
  let real = where;
  try { real = realpathSync(where); } catch { /* keep the path */ }
  if (/Caskroom|Cellar/i.test(real)) how = 'brew';
  else if ((out(npm, ['ls', '-g', '--depth=0', '@openai/codex']) ?? '').includes('@openai/codex')) how = 'npm';
}
report.codex = { have: codexHave, latest: codexLatest, how };
if (codexHave && codexLatest && newer(codexLatest, codexHave) && !checkOnly) {
  try {
    if (how === 'npm') run(npm, ['install', '-g', '--no-audit', '--no-fund', `@openai/codex@${codexLatest}`]);
    else if (how === 'brew') { out('brew', ['update', '--quiet'], { timeout: 300_000 }); run('brew', ['upgrade', '--cask', 'codex']); }
    else throw new Error('installed some other way; update it the way you installed it');
    const now = (out('codex', ['--version']) ?? '').match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
    if (now && now !== codexHave) report.updated.push(`Codex ${codexHave} → ${now}`);
    report.codex.have = now ?? codexHave;
  } catch (e) {
    report.codex.error = String(e?.message ?? e).slice(0, 200);
  }
}

mkdirSync(join(root, '.roost-data'), { recursive: true });
writeFileSync(join(root, '.roost-data', 'agents-update.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));

// A new SDK is only picked up by a restart: the normal deploy builds, checks and
// restarts (it waits for the crew to finish talking). Failed checks put the
// locked SDK back, so a bad release never sticks.
if (sdkChanged) {
  try {
    run(process.execPath, [join('scripts', 'service.mjs'), 'install']);
  } catch {
    try { run(npm, ['ci', '--no-audit', '--no-fund']); } catch { /* the running release is untouched */ }
    report.updated = report.updated.filter((u) => !u.startsWith('Claude'));
    report.claude.error = 'the new Claude software failed Roost\'s checks; staying on the tested one';
    writeFileSync(join(root, '.roost-data', 'agents-update.json'), JSON.stringify(report, null, 2));
  }
}
