// The OS-specific pieces of the background service, as pure functions so the
// tests can check every platform from any machine (server/tests/platform.test.ts).
//   darwin: a LaunchAgent (unchanged; service.mjs owns it)
//   linux:  a systemd --user unit
//   win32:  a Scheduled Task at logon that runs a hidden node supervisor
import { posix, win32 } from 'node:path';

export const TASK_NAME = 'Roost';
export const UNIT_NAME = 'roost.service';

/** Where the service keeps its log (and, on Windows, its launcher and pids). */
export function servicePaths(plat, env, home) {
  if (plat === 'win32') {
    const dir = win32.join(env.LOCALAPPDATA || win32.join(home, 'AppData', 'Local'), 'Roost');
    return { dir, log: win32.join(dir, 'roost.log'), launcher: win32.join(dir, 'roost.vbs'), pids: win32.join(dir, 'roost.pids.json') };
  }
  if (plat === 'linux') {
    const state = env.XDG_STATE_HOME || posix.join(home, '.local', 'state');
    const config = env.XDG_CONFIG_HOME || posix.join(home, '.config');
    const dir = posix.join(state, 'roost');
    return { dir, log: posix.join(dir, 'roost.log'), unit: posix.join(config, 'systemd', 'user', UNIT_NAME) };
  }
  return { dir: posix.join(home, 'Library', 'Logs'), log: posix.join(home, 'Library', 'Logs', 'roost.log') };
}

/** The systemd user unit. KillMode=process: a restart stops the server only,
 *  not a deploy it started (the deploy restarts the server it runs under --
 *  the default control-group mode would kill it halfway, the 2026-09-24 bug). */
export function systemdUnit({ nodeBin, serverEntry, repoRoot, log, home }) {
  return [
    '[Unit]', 'Description=Roost', 'After=network-online.target', '',
    '[Service]',
    `WorkingDirectory=${repoRoot}`,
    `ExecStart=${nodeBin} ${serverEntry}`,
    'Restart=always', 'RestartSec=10', 'KillMode=process',
    `Environment=PATH=${posix.dirname(nodeBin)}:/usr/local/bin:/usr/bin:/bin`,
    `Environment=HOME=${home}`,
    `StandardOutput=append:${log}`, `StandardError=append:${log}`, '',
    '[Install]', 'WantedBy=default.target', '',
  ].join('\n');
}

/** A VBScript that starts the node supervisor with no window (0) and returns
 *  (False). Task Scheduler runs `wscript.exe roost.vbs`; a plain node task
 *  would pop a console window at every logon. */
export function windowsLauncher({ nodeBin, serviceScript, repoRoot }) {
  const q = (s) => `""${s}""`;
  return [
    'Set sh = CreateObject("WScript.Shell")',
    `sh.CurrentDirectory = "${repoRoot}"`,
    `sh.Run "${q(nodeBin)} ${q(serviceScript)} supervise", 0, False`,
    '',
  ].join('\r\n');
}

/** schtasks argv (no shell) that (re)creates the logon task. */
export function schtasksCreateArgs(launcher) {
  return ['/Create', '/F', '/SC', 'ONLOGON', '/RL', 'LIMITED', '/TN', TASK_NAME, '/TR', `wscript.exe "${launcher}"`];
}
