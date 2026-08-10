#!/usr/bin/env node
// Manage Pocket as a macOS LaunchAgent: auto-starts at login, restarts on crash.
//   npm run service:install | service:uninstall | service:status

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const LABEL = 'com.pocket.server';
const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const logPath = join(homedir(), 'Library', 'Logs', 'pocket.log');
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

const command = process.argv[2];

switch (command) {
  case 'install': {
    if (!existsSync(serverEntry)) {
      console.error('server/dist not found — run `npm run build` first.');
      process.exit(1);
    }
    mkdirSync(dirname(plistPath), { recursive: true });
    writeFileSync(plistPath, plist);
    shQuiet(`launchctl bootout gui/${uid}/${LABEL}`); // remove any previous copy

    // launchd sometimes hasn't fully released the old label by the time bootout returns —
    // an immediate bootstrap can then fail with "Bootstrap failed: 5: Input/output error".
    // Retry with a growing delay instead of leaving the service down on a lost race.
    const attempts = [300, 1000, 2000];
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
        shQuiet(`launchctl bootout gui/${uid}/${LABEL}`);
      }
    }
    if (!started) {
      console.error(`Failed to start ${LABEL} after ${attempts.length} attempts.`);
      console.error(lastErr?.stderr?.toString?.() ?? String(lastErr));
      process.exit(1);
    }
    console.log(`Installed and started ${LABEL}.`);
    console.log(`It now starts automatically at login and restarts if it crashes.`);
    console.log(`Logs: tail -f ${logPath}`);
    setTimeout(() => {
      console.log(shQuiet(`tail -6 ${logPath}`));
    }, 1500);
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
    console.log('Usage: node scripts/service.mjs <install|uninstall|status>');
    process.exit(1);
}
