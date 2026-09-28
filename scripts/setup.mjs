#!/usr/bin/env node
// Roost setup (roadmap #56): one command on Mac, Windows or Linux. It checks
// what Roost needs, builds it, starts it in the background so it survives a
// reboot, and ends on a QR code your phone can scan.
//
//   node scripts/setup.mjs            # everything
//   node scripts/setup.mjs --check    # just say what's missing
//
// It never signs in for you and never changes anything outside this folder
// except the background service (LaunchAgent / systemd user unit / logon task).
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const OS = platform(); // 'darwin' | 'win32' | 'linux'
const checkOnly = process.argv.includes('--check');
const PORT = 8790;

const ok = (s) => console.log(`  ✓ ${s}`);
const no = (s) => console.log(`  ✗ ${s}`);
const say = (s) => console.log(s);
const has = (cmd) => spawnSync(OS === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }).status === 0;
const out = (cmd) => { try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const run = (cmd, opts = {}) => execSync(cmd, { cwd: root, stdio: 'inherit', ...opts });

const problems = [];

say('\nRoost setup\n');
say('1. The basics');
const major = Number(process.versions.node.split('.')[0]);
if (major >= 20) ok(`Node ${process.versions.node}`);
else { no(`Node ${process.versions.node} is too old — install Node 20 or newer from https://nodejs.org`); problems.push('node'); }
if (has('git')) ok('git'); else { no('git is missing — https://git-scm.com/downloads'); problems.push('git'); }

say('\n2. The agents Roost drives (you need at least one)');
const claude = has('claude');
const codex = has('codex');
if (claude) ok(`Claude Code ${out('claude --version').split('\n')[0]}`);
else no('Claude Code not found — install: npm install -g @anthropic-ai/claude-code, then run `claude` once to sign in');
if (codex) {
  const status = out('codex login status');
  ok(`Codex ${out('codex --version').split('\n')[0]}${status ? ` (${status.split('\n')[0]})` : ''}`);
} else no('Codex not found (optional) — install: npm install -g @openai/codex, then `codex login`');
if (!claude && !codex) problems.push('agents');

say('\n3. Reaching Roost from your phone (Tailscale)');
let host = null;
// The Mac app ships its CLI inside the app bundle, off the PATH.
const tsBin = has('tailscale') ? 'tailscale'
  : OS === 'darwin' && existsSync('/Applications/Tailscale.app/Contents/MacOS/Tailscale') ? '"/Applications/Tailscale.app/Contents/MacOS/Tailscale"'
  : OS === 'win32' && existsSync('C:\\Program Files\\Tailscale\\tailscale.exe') ? '"C:\\Program Files\\Tailscale\\tailscale.exe"'
  : 'tailscale';
const tsJson = out(`${tsBin} status --json`);
if (tsJson) {
  try {
    const t = JSON.parse(tsJson);
    host = String(t.Self?.DNSName ?? '').replace(/\.$/, '') || null;
    if (t.BackendState !== 'Running') host = null;
  } catch { /* not running */ }
}
if (host) ok(`Tailscale is on: this computer is ${host}`);
else {
  no('Tailscale isn\'t running on this computer.');
  say('     Tailscale is a free private network just for your own devices — it lets');
  say('     your phone reach this computer from anywhere, and nobody else can.');
  say(`     1) Install it here: https://tailscale.com/download${OS === 'darwin' ? '/mac' : OS === 'win32' ? '/windows' : '/linux'}`);
  say('     2) Sign in (Google, Apple, GitHub or Microsoft all work).');
  say('     3) Install the Tailscale app on your phone and sign in with the SAME account.');
  say('     Then run this setup again.');
  problems.push('tailscale');
}

if (checkOnly) {
  say(problems.length ? `\nStill needed: ${problems.join(', ')}` : '\nEverything is ready.');
  process.exit(problems.length ? 1 : 0);
}
if (problems.includes('node') || problems.includes('git')) {
  say('\nFix the basics above, then run this again.');
  process.exit(1);
}

say('\n4. Building Roost (a minute or two the first time)');
if (!existsSync(join(root, 'node_modules'))) run('npm install');
run('npm run build');
ok('built');

say('\n5. Starting Roost in the background');
const entry = join(root, 'server', 'dist', 'index.js');
if (OS === 'darwin') {
  run('node scripts/service.mjs install');
  ok('running as a LaunchAgent (starts when you log in)');
} else if (OS === 'linux') {
  const unitDir = join(homedir(), '.config', 'systemd', 'user');
  mkdirSync(unitDir, { recursive: true });
  writeFileSync(join(unitDir, 'roost.service'), [
    '[Unit]', 'Description=Roost', 'After=network-online.target', '',
    '[Service]', `WorkingDirectory=${root}`, `ExecStart=${process.execPath} ${entry}`, 'Restart=always', 'RestartSec=5',
    `Environment=PATH=${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`, '',
    '[Install]', 'WantedBy=default.target', '',
  ].join('\n'));
  run('systemctl --user daemon-reload');
  run('systemctl --user enable --now roost.service');
  out(`loginctl enable-linger ${process.env.USER ?? ''}`);
  ok('running as a systemd user service (starts at boot)');
} else if (OS === 'win32') {
  // A logon task runs node hidden in the background; /F replaces an old one.
  const cmd = `"${process.execPath}" "${entry}"`;
  run(`schtasks /Create /F /SC ONLOGON /RL LIMITED /TN Roost /TR "cmd /c cd /d \\"${root}\\" && ${cmd.replace(/"/g, '\\"')}"`, { shell: 'cmd.exe' });
  run('schtasks /Run /TN Roost', { shell: 'cmd.exe' });
  ok('running as a logon task named Roost (starts when you sign in)');
} else {
  no(`${OS} isn't supported yet — start it yourself with: npm start`);
}

say('\n6. Open it on your phone');
const url = `http://${host ?? 'localhost'}:${PORT}`;
say(`   ${url}`);
if (host) {
  const qr = spawnSync(OS === 'win32' ? 'npx.cmd' : 'npx', ['-y', 'qrcode-terminal', url, '--small'], { stdio: 'inherit' });
  if (qr.status !== 0) say('   (Scan skipped — type the address above into your phone\'s browser.)');
  say('\n   On iPhone: open it in Safari, tap Share, then "Add to Home Screen".');
  say('   On Android: open it in Chrome, tap the menu, then "Add to Home screen".');
} else {
  say('   (Once Tailscale is on, run setup again for the phone address and QR code.)');
}
say('\nRoost is ready. Your crew is waiting.\n');
