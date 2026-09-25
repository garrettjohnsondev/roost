#!/usr/bin/env node
// Manage Roost as a macOS LaunchAgent: auto-starts at login, restarts on crash.
//   npm run service:install | service:uninstall | service:status
//   node scripts/service.mjs rollback | restart
//
// `install` is the ONLY way a build goes live, and it is gated end to end:
//   build -> smoke the candidate (new front end against the live server) ->
//   promote it to the current release -> restart -> smoke the live app ->
//   if that fails, roll back to the previous release and restart again.
// 2026-09-24: a build that crashed every session went live with nothing between
// it and the phone, and nothing on the phone could undo it.

import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, rmSync, writeFileSync, renameSync, readFileSync } from 'node:fs';
import { promote, rollback, readMeta, restoreServer, serveCandidate } from './releases.mjs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const LABEL = 'com.roost.server';
/** The pre-rename label. Booted out on install, or the old service keeps
 *  running on the same port and the new one silently fails to bind. */
const OLD_LABEL = 'com.pocket.server';
const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const logPath = join(homedir(), 'Library', 'Logs', 'roost.log');
const oldLogPath = join(homedir(), 'Library', 'Logs', 'pocket.log');
const nodeBin = process.execPath;
const uid = process.getuid();
const serverEntry = join(repoRoot, 'server', 'dist', 'index.js');

const sh = (cmd, opts = {}) => execSync(cmd, { stdio: 'pipe', encoding: 'utf8', ...opts }).trim();
const shQuiet = (cmd) => {
  try {
    return sh(cmd);
  } catch {
    return '';
  }
};

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${serverEntry}</string>
  </array>
  <key>WorkingDirectory</key><string>${repoRoot}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${dirname(nodeBin)}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>${homedir()}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${logPath}</string>
  <key>StandardErrorPath</key><string>${logPath}</string>
</dict>
</plist>
`;


const loaded = () => !!shQuiet(`launchctl print gui/${uid}/${LABEL}`);

/** (Re)start the service. Throws if launchd will not take it.
 *
 *  Already loaded with the same plist: `kickstart -k`, which restarts the
 *  server in place and leaves the job LOADED. 2026-09-24: this used to always
 *  bootout + bootstrap. A deploy run by an agent inside Roost is a descendant
 *  of the server, so the bootout killed the deploy before it reached the
 *  bootstrap — nothing loaded, nothing for launchd to restart, the app down
 *  until someone came back to the Mac. Only a changed or missing plist takes
 *  the bootout path now, and that path runs in a detached process (see
 *  `finish-deploy`) so it outlives the server it replaces. */
function start() {
    mkdirSync(dirname(plistPath), { recursive: true });
    const unchanged = existsSync(plistPath) && readFileSync(plistPath, 'utf8') === plist;
    if (unchanged && loaded()) {
      sh(`launchctl kickstart -k gui/${uid}/${LABEL}`);
      return;
    }
    writeFileSync(plistPath, plist);
    shQuiet(`launchctl bootout gui/${uid}/${LABEL}`); // remove any previous copy
    shQuiet(`launchctl bootout gui/${uid}/${OLD_LABEL}`); // and the pre-rename one

    // launchd sometimes hasn't fully released the old label by the time bootout returns —
    // an immediate bootstrap can then fail with "Bootstrap failed: 5: Input/output error".
    // Retry with a growing delay instead of leaving the service down on a lost race.
    const attempts = [300, 1000, 2000, 4000, 8000];
    let lastErr;
    let started = false;
    for (const delayMs of attempts) {
      execSync(`sleep ${delayMs / 1000}`);
      try {
        sh(`launchctl bootstrap gui/${uid} ${plistPath}`);
        started = true;
        break;
      } catch (err) {
        lastErr = err;
        if (loaded()) { started = true; break; } // "already loaded" is success
        shQuiet(`launchctl bootout gui/${uid}/${LABEL}`);
      }
    }
    if (!started) {
      console.error(`Failed to start ${LABEL} after ${attempts.length} attempts.`);
      console.error(lastErr?.stderr?.toString?.() ?? String(lastErr));
      throw new Error('launchd refused to start the service');
    }
}

const livePort = (() => {
  for (const f of ['roost.config.json', 'pocket.config.json']) {
    try { return JSON.parse(readFileSync(join(repoRoot, f), 'utf8')).port ?? 8790; } catch { /* next */ }
  }
  return 8790;
})();

async function isUp(port, ms = 2000) {
  try { await fetch(`http://127.0.0.1:${port}/api/config`, { signal: AbortSignal.timeout(ms) }); return true; } catch { return false; }
}
async function waitUp(port, seconds) {
  for (let i = 0; i < seconds * 2; i++) { if (await isUp(port, 1000)) return true; execSync('sleep 0.5'); }
  return false;
}
/** Run the smoke check in a child process. Async on purpose: the candidate
 *  server lives in THIS process, and a blocking execSync froze the event loop
 *  that serves it — the check saw no server and skipped (the first gated
 *  deploy, 2026-09-24). ROOST_SMOKE_REQUIRED makes a skip a failure: a gate
 *  that could not look has not passed. */
function smoke(url) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/smoke.mjs'], {
      cwd: repoRoot, stdio: 'inherit', env: { ...process.env, ROOST_SMOKE_URL: url, ROOST_SMOKE_REQUIRED: '1' },
    });
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}
const run = (cmd) => execSync(cmd, { cwd: repoRoot, stdio: 'inherit' });

const command = process.argv[2];

switch (command) {
  case 'install': {
    // Carry the pre-rename log across so existing history is not stranded.
    try {
      if (!existsSync(logPath) && existsSync(oldLogPath)) renameSync(oldLogPath, logPath);
    } catch { /* a missing log must never block an install */ }

    console.log('1/5  building');
    try { run('npm run build'); } catch { restoreServer(); console.error('build failed — NOT deploying; the live app is untouched'); process.exit(1); }

    console.log('2/5  checking the candidate before it goes anywhere');
    if (await isUp(livePort)) {
      const candidate = await serveCandidate({ port: livePort + 1, livePort });
      const ok = await smoke(`http://127.0.0.1:${livePort + 1}`);
      candidate.close();
      if (!ok) { restoreServer(); console.error('the candidate failed the smoke check — NOT deploying; the live app is untouched'); process.exit(1); }
    } else {
      console.log('     no live server to check against — first install, checking after start instead');
    }

    console.log('3/5  promoting it to the current release');
    const meta = promote();
    console.log(`     ${meta.commit} — ${meta.subject}`);

    // Steps 4–5 restart the server this script may be running under (a deploy
    // run by an agent inside Roost is the server's descendant). They run in a
    // detached process with its own session, so killing the server cannot kill
    // them halfway — which is how the service ended up unloaded, 2026-09-24.
    // We wait and relay its output; if we are killed, it carries on alone.
    const deployLog = join(repoRoot, '.roost-data', 'releases', 'deploy.log');
    writeFileSync(deployLog, '');
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'finish-deploy'], {
      cwd: repoRoot, detached: true, stdio: ['ignore', openSync(deployLog, 'a'), openSync(deployLog, 'a')],
    });
    if (process.env.ROOST_HOSTED) {
      // Run from a session INSIDE Roost: the restart below kills this very
      // shell, and waiting on it only makes the session look busy while it is
      // dead (three times in a row, 2026-09-24). Hand off and leave now.
      child.unref();
      console.log('     this session runs inside Roost, which the restart will end — finishing in the background.');
      console.log(`     result: ${deployLog}, or /rescue on the phone, or \`npm run service:releases\`.`);
      process.exit(0);
    }
    let shown = 0;
    const relay = () => { const t = readFileSync(deployLog, 'utf8'); process.stdout.write(t.slice(shown)); shown = t.length; };
    const tick = setInterval(relay, 500);
    const code = await new Promise((resolve) => child.on('exit', resolve));
    clearInterval(tick); relay();
    process.exit(code ?? 1);
  }
  case 'finish-deploy': {
    const meta = readMeta('current');
    console.log('4/5  restarting');
    try { start(); } catch (e) { console.error(String(e.message ?? e)); process.exit(1); }

    console.log('5/5  checking the live app');
    const healthy = (await waitUp(livePort, 30)) && (await smoke(`http://127.0.0.1:${livePort}`));
    if (!healthy) {
      console.error('the live app failed its check after restart — rolling back');
      try {
        const r = rollback();
        start();
        console.error(`rolled back to ${r.now.commit} (${r.now.subject}); the failed build is kept as "previous"`);
      } catch (e) {
        console.error(`could not roll back: ${e.message ?? e}`);
      }
      process.exit(1);
    }
    console.log(`Installed and started ${LABEL} — ${meta?.commit}.`);
    console.log(`It now starts automatically at login and restarts if it crashes.`);
    console.log(`Logs: tail -f ${logPath}`);
    break;
  }
  case 'rollback': {
    // Also run by the rescue page, detached, from inside the server it restarts.
    try {
      const r = rollback();
      shQuiet(`launchctl kickstart -k gui/${uid}/${LABEL}`);
      console.log(`Rolled back to ${r.now.commit} (${r.now.subject}). The build it replaced is kept as "previous".`);
    } catch (e) {
      console.error(String(e.message ?? e));
      process.exit(1);
    }
    break;
  }
  case 'restart': {
    shQuiet(`launchctl kickstart -k gui/${uid}/${LABEL}`);
    console.log(`Restarted ${LABEL}.`);
    break;
  }
  case 'releases': {
    console.log('current: ', JSON.stringify(readMeta('current')));
    console.log('previous:', JSON.stringify(readMeta('previous')));
    break;
  }
  case 'uninstall': {
    shQuiet(`launchctl bootout gui/${uid}/${LABEL}`);
    rmSync(plistPath, { force: true });
    console.log(`Stopped and removed ${LABEL}.`);
    break;
  }
  case 'status': {
    const out = shQuiet(`launchctl print gui/${uid}/${LABEL}`);
    if (!out) {
      console.log('Not installed. Run: npm run service:install');
    } else {
      const state = out.match(/state = .*/)?.[0] ?? '';
      const pid = out.match(/pid = .*/)?.[0] ?? '';
      console.log(`${LABEL}: ${state} ${pid ? `(${pid})` : ''}`);
      console.log(`Recent log:\n${shQuiet(`tail -6 ${logPath}`)}`);
    }
    break;
  }
  default:
    console.log('Usage: node scripts/service.mjs <install|uninstall|status|rollback|restart|releases>');
    process.exit(1);
}
