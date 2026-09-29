#!/usr/bin/env node
// Manage Roost as a background service: auto-starts at login, restarts on crash.
//   macOS: a LaunchAgent.  Linux: a systemd --user unit.  Windows: a logon
//   Scheduled Task running a hidden node supervisor (docs/WINDOWS.md).
//   npm run service:install | service:uninstall | service:status
//   node scripts/service.mjs rollback | restart
//
// `install` is the ONLY way a build goes live, and it is gated end to end:
//   build -> smoke the candidate (new front end against the live server) ->
//   promote it to the current release -> restart -> smoke the live app ->
//   if that fails, roll back to the previous release and restart again.
// 2026-09-24: a build that crashed every session went live with nothing between
// it and the phone, and nothing on the phone could undo it.

import { execSync, execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, rmSync, writeFileSync, renameSync, readFileSync, appendFileSync } from 'node:fs';
import { servicePaths, systemdUnit, windowsLauncher, schtasksCreateArgs, TASK_NAME, UNIT_NAME } from './platform.mjs';
import { promote, rollback, readMeta, restoreServer, serveCandidate } from './releases.mjs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const LABEL = 'com.roost.server';
/** The pre-rename label. Booted out on install, or the old service keeps
 *  running on the same port and the new one silently fails to bind. */
const OLD_LABEL = 'com.pocket.server';
const OS = process.platform;
const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const paths = servicePaths(OS, process.env, homedir());
const logPath = paths.log;
const oldLogPath = join(homedir(), 'Library', 'Logs', 'pocket.log');
const nodeBin = process.execPath;
const uid = process.getuid?.() ?? 0; // no getuid on Windows
const serverEntry = join(repoRoot, 'server', 'dist', 'index.js');

const sh = (cmd, opts = {}) => execSync(cmd, { stdio: 'pipe', encoding: 'utf8', ...opts }).trim();
const shQuiet = (cmd) => {
  try {
    return sh(cmd);
  } catch {
    return '';
  }
};
/** argv form, no shell: paths with spaces need no quoting on any OS. */
const exe = (file, args) => execFileSync(file, args, { stdio: 'pipe', encoding: 'utf8', windowsHide: true }).trim();
const exeQuiet = (file, args) => { try { return exe(file, args); } catch { return ''; } };
/** Blocking sleep without `sleep`, which Windows does not have. */
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const tailLog = (n) => { try { return readFileSync(logPath, 'utf8').trimEnd().split(/\r?\n/).slice(-n).join('\n'); } catch { return ''; } };

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


// ---- Linux: systemd --user --------------------------------------------------
const systemctl = (...a) => exe('systemctl', ['--user', ...a]);
const unitText = () => systemdUnit({ nodeBin, serverEntry, repoRoot, log: logPath, home: homedir() });
function linuxStart() {
  mkdirSync(dirname(paths.unit), { recursive: true });
  mkdirSync(paths.dir, { recursive: true });
  const unchanged = existsSync(paths.unit) && readFileSync(paths.unit, 'utf8') === unitText();
  if (!unchanged) { writeFileSync(paths.unit, unitText()); systemctl('daemon-reload'); systemctl('enable', UNIT_NAME); }
  // KillMode=process in the unit: this restarts the server, not a deploy it spawned.
  systemctl('restart', UNIT_NAME);
  // Keep running after logout / start at boot; harmless if not allowed.
  exeQuiet('loginctl', ['enable-linger', process.env.USER ?? '']);
}

// ---- Windows: logon task + hidden node supervisor ---------------------------
const readPids = () => { try { return JSON.parse(readFileSync(paths.pids, 'utf8')); } catch { return {}; } };
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };
const winLauncherText = () => windowsLauncher({ nodeBin, serviceScript: fileURLToPath(import.meta.url), repoRoot });
function winStart() {
  mkdirSync(paths.dir, { recursive: true });
  const unchanged = existsSync(paths.launcher) && readFileSync(paths.launcher, 'utf8') === winLauncherText();
  const { supervisor, server } = readPids();
  if (unchanged && alive(supervisor)) {
    // Kill the server only (no /T): the supervisor starts it again, and a
    // deploy this server spawned is not in the blast radius.
    if (alive(server)) exeQuiet('taskkill', ['/PID', String(server), '/F']);
    return;
  }
  writeFileSync(paths.launcher, winLauncherText());
  exe('schtasks', schtasksCreateArgs(paths.launcher));
  if (alive(supervisor)) exeQuiet('taskkill', ['/PID', String(supervisor), '/F']);
  if (alive(server)) exeQuiet('taskkill', ['/PID', String(server), '/F']);
  exe('schtasks', ['/Run', '/TN', TASK_NAME]);
}
/** The Windows supervisor: runs the server, restarts it 10s after it exits
 *  (launchd's KeepAlive + ThrottleInterval), and logs to %LOCALAPPDATA%. */
async function supervise() {
  mkdirSync(paths.dir, { recursive: true });
  for (;;) {
    const log = openSync(logPath, 'a');
    const child = spawn(nodeBin, [serverEntry], { cwd: repoRoot, stdio: ['ignore', log, log], windowsHide: true });
    writeFileSync(paths.pids, JSON.stringify({ supervisor: process.pid, server: child.pid }));
    const code = await new Promise((r) => { child.on('exit', r); child.on('error', () => r(null)); });
    appendFileSync(logPath, `[supervisor] server exited (${code}); restarting in 10s\n`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

/** Restart in place, whatever the platform (rollback, restart, rescue page). */
function restartInPlace() {
  if (OS === 'darwin') shQuiet(`launchctl kickstart -k gui/${uid}/${LABEL}`);
  else if (OS === 'linux') { try { systemctl('restart', UNIT_NAME); } catch { /* not installed */ } }
  else if (OS === 'win32') { try { winStart(); } catch { /* not installed */ } }
}

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
    if (OS === 'linux') return linuxStart();
    if (OS === 'win32') return winStart();
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
      sleepMs(delayMs);
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
/** True once no session has been mid-turn for QUIET_READINGS readings in a row (a turn's
 *  own checks can start a beat after it goes idle); false if `maxMs` ran out.
 *  No live server, or one that won't answer: nothing to wait for. */
const QUIET_READINGS = 5;
async function waitForQuiet(maxMs) {
  const token = process.env.ROOST_TOKEN ?? process.env.POCKET_TOKEN;
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const deadline = Date.now() + maxMs;
  let quiet = 0;
  while (Date.now() < deadline) {
    let busy = false;
    try {
      const res = await fetch(`http://127.0.0.1:${livePort}/api/sessions`, { headers, signal: AbortSignal.timeout(3000) });
      if (!res.ok) return true;
      const body = await res.json();
      const list = Array.isArray(body) ? body : body.sessions ?? [];
      busy = list.some((s) => s.state === 'working');
    } catch {
      return true;
    }
    quiet = busy ? 0 : quiet + 1;
    // ~10s of quiet, not ~4: a job that just verified is still celebrating
    // (the burst, the 5s hold, the fold). Restarting inside that showed a
    // blank reply and "reconnecting…" (2026-09-28).
    if (quiet >= QUIET_READINGS) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}
async function waitUp(port, seconds) {
  for (let i = 0; i < seconds * 2; i++) { if (await isUp(port, 1000)) return true; sleepMs(500); }
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
    // 2026-09-27: "What happened to your message back to me?" -- a deploy run
    // by the crew restarted Roost mid-turn, every time, so the reply that
    // should have followed it was never written. Wait until no session is
    // mid-turn (this one included, and any other project's), then restart.
    // Capped, so a turn that never ends can't hold a release back forever.
    console.log('4/5  waiting for the crew to finish talking');
    const quietFor = await waitForQuiet(10 * 60_000);
    console.log(quietFor ? `     quiet — restarting` : `     still busy after 10 minutes — restarting anyway`);
    // Tell the next boot WHY it booted, so the thread says "deployed", not "cut off".
    try {
      writeFileSync(join(repoRoot, '.roost-data', 'releases', 'restart.json'), JSON.stringify({ commit: meta?.commit, subject: meta?.subject, smoke: meta?.smoke, at: new Date().toISOString(), waited: !quietFor }));
    } catch { /* the notice is a nicety; the restart is not */ }
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
    console.log(OS === 'win32' ? `Logs: Get-Content -Wait "${logPath}"` : `Logs: tail -f ${logPath}`);

    // Deploy going live and GitHub having the commit used to be two separate
    // steps, and the second one only happened if someone remembered to open
    // the Changes sheet and tap Push. GitHub sat 40 commits behind for a full
    // day this way (2026-09-25). Bundled here, after the live app is already
    // confirmed healthy, so a push failure (offline, no remote) never blocks
    // or reverts a deploy that already succeeded -- it only means GitHub
    // catches up next time.
    console.log('Also: pushing to GitHub');
    try {
      run('git push');
      console.log('     pushed.');
    } catch (e) {
      console.error(`     could not push (deploy still succeeded): ${e.message ?? e}`);
    }
    break;
  }
  case 'rollback': {
    // Also run by the rescue page, detached, from inside the server it restarts.
    try {
      const r = rollback();
      restartInPlace();
      console.log(`Rolled back to ${r.now.commit} (${r.now.subject}). The build it replaced is kept as "previous".`);
    } catch (e) {
      console.error(String(e.message ?? e));
      process.exit(1);
    }
    break;
  }
  case 'restart': {
    restartInPlace();
    console.log(`Restarted ${LABEL}.`);
    break;
  }
  case 'releases': {
    console.log('current: ', JSON.stringify(readMeta('current')));
    console.log('previous:', JSON.stringify(readMeta('previous')));
    break;
  }
  case 'uninstall': {
    if (OS === 'linux') {
      exeQuiet('systemctl', ['--user', 'disable', '--now', UNIT_NAME]);
      rmSync(paths.unit, { force: true });
      exeQuiet('systemctl', ['--user', 'daemon-reload']);
    } else if (OS === 'win32') {
      exeQuiet('schtasks', ['/Delete', '/F', '/TN', TASK_NAME]);
      const { supervisor, server } = readPids();
      for (const pid of [supervisor, server]) if (alive(pid)) exeQuiet('taskkill', ['/PID', String(pid), '/F']);
      rmSync(paths.launcher, { force: true });
      rmSync(paths.pids, { force: true });
    } else {
      shQuiet(`launchctl bootout gui/${uid}/${LABEL}`);
      rmSync(plistPath, { force: true });
    }
    console.log(`Stopped and removed ${LABEL}.`);
    break;
  }
  case 'supervise': {
    await supervise();
    break;
  }
  case 'start': {
    // Just (re)start the installed service -- no build, no smoke (CI, setup).
    try { start(); console.log(`Started ${LABEL}.`); } catch (e) { console.error(String(e.message ?? e)); process.exit(1); }
    break;
  }
  case 'status': {
    if (OS === 'linux' || OS === 'win32') {
      const out = OS === 'linux'
        ? (existsSync(paths.unit) ? exeQuiet('systemctl', ['--user', 'show', UNIT_NAME, '-p', 'ActiveState', '-p', 'MainPID']).replace(/\n/g, ' ') : '')
        : exeQuiet('schtasks', ['/Query', '/TN', TASK_NAME, '/FO', 'LIST']) && (() => { const p = readPids(); return `task ${TASK_NAME} registered; supervisor ${alive(p.supervisor) ? p.supervisor : 'not running'}, server ${alive(p.server) ? p.server : 'not running'}`; })();
      if (!out) console.log('Not installed. Run: npm run service:install');
      else { console.log(`${LABEL}: ${out}`); console.log(`Recent log:\n${tailLog(6)}`); }
      break;
    }
    const out = shQuiet(`launchctl print gui/${uid}/${LABEL}`);
    if (!out) {
      console.log('Not installed. Run: npm run service:install');
    } else {
      const state = out.match(/state = .*/)?.[0] ?? '';
      const pid = out.match(/pid = .*/)?.[0] ?? '';
      console.log(`${LABEL}: ${state} ${pid ? `(${pid})` : ''}`);
      console.log(`Recent log:\n${tailLog(6)}`);
    }
    break;
  }
  default:
    console.log('Usage: node scripts/service.mjs <install|uninstall|status|rollback|restart|start|releases>');
    process.exit(1);
}
