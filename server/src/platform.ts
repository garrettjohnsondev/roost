/** The few places Roost touches the operating system, with one small branch
 *  per platform. Roost was built on a Mac; everything here keeps the Mac
 *  behaviour exactly and adds the Windows / Linux equivalent (docs/WINDOWS.md).
 *  The helpers take the platform and file-system probes as arguments so the
 *  tests can check all three from any machine. */
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { posix, win32 } from 'node:path';

export type Plat = NodeJS.Platform;

const pathFor = (plat: Plat) => (plat === 'win32' ? win32 : posix);

/** Is `child` the folder `parent` or inside it? Windows paths compare
 *  case-insensitively and with either slash; a `startsWith(p + '/')` check
 *  never matched a `C:\\` path. */
export function isUnder(parent: string, child: string, plat: Plat = process.platform): boolean {
  const p = pathFor(plat);
  const rel = p.relative(p.resolve(parent), p.resolve(child));
  return rel === '' || (!!rel && !rel.startsWith('..') && !p.isAbsolute(rel));
}

/** `child` relative to `parent` with forward slashes, or null when outside. */
export function relativeInside(parent: string, child: string, plat: Plat = process.platform): string | null {
  if (!isUnder(parent, child, plat)) return null;
  const p = pathFor(plat);
  return p.relative(p.resolve(parent), p.resolve(child)).split(p.sep).join('/');
}

/** Path segments, whichever slash the path was written with. */
export const pathParts = (p: string): string[] => p.split(/[\\/]+/).filter(Boolean);
/** The last path segment ("remote" for /Volumes/SSD/remote or C:\\code\\remote). */
export const baseName = (p: string): string => pathParts(p).pop() ?? p;

/** The folder name Claude Code uses under ~/.claude/projects for a cwd: every
 *  character that is not a letter or digit becomes '-'. So /Users/me/app is
 *  -Users-me-app, and C:\\Users\\me\\app is C--Users-me-app. */
export const claudeProjectDirName = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9]/g, '-');

/** Windows drive roots that exist ("C:\\", "D:\\"). */
export function listDrives(exists: (p: string) => boolean = existsSync): string[] {
  const out: string[] = [];
  for (let c = 65; c <= 90; c++) {
    const root = `${String.fromCharCode(c)}:\\`;
    try { if (exists(root)) out.push(root); } catch { /* not there */ }
  }
  return out;
}

export interface FsProbe {
  readdir: (p: string) => string[];
  realpath: (p: string) => string;
  exists: (p: string) => boolean;
}
const realFs: FsProbe = {
  readdir: (p) => readdirSync(p),
  realpath: (p) => realpathSync(p),
  exists: existsSync,
};

/** Folder-browser shortcuts for other disks: mounted volumes on a Mac (the
 *  boot disk excluded), drive letters on Windows (the system drive excluded,
 *  it is where Home is), and /media/<user>, /run/media/<user>, /mnt on Linux. */
export function volumeShortcuts(plat: Plat = process.platform, fs: FsProbe = realFs, env: NodeJS.ProcessEnv = process.env): Array<{ name: string; path: string }> {
  const out: Array<{ name: string; path: string }> = [];
  const children = (dir: string) => {
    try {
      for (const n of fs.readdir(dir)) if (!n.startsWith('.')) out.push({ name: n, path: posix.join(dir, n) });
    } catch { /* not on this machine */ }
  };
  if (plat === 'darwin') {
    try {
      for (const n of fs.readdir('/Volumes')) {
        if (n.startsWith('.')) continue;
        const full = posix.join('/Volumes', n);
        try { if (fs.realpath(full) !== '/') out.push({ name: n, path: full }); } catch { /* unmounted */ }
      }
    } catch { /* no /Volumes */ }
  } else if (plat === 'win32') {
    const system = (env.SystemDrive ?? 'C:').toUpperCase().slice(0, 2);
    for (const d of listDrives(fs.exists)) if (d.slice(0, 2).toUpperCase() !== system) out.push({ name: d.slice(0, 2), path: d });
  } else {
    const user = env.USER ?? env.LOGNAME ?? '';
    if (user) { children(`/media/${user}`); children(`/run/media/${user}`); }
    children('/mnt');
  }
  return out;
}

/** argv for running a command line through the platform shell. POSIX keeps
 *  /bin/sh -c; Windows has no /bin/sh, so cmd.exe /d /s /c. */
export function shellArgv(command: string, plat: Plat = process.platform): [string, string[]] {
  // cmd /s strips one outer pair of quotes and runs the rest verbatim, so the
  // line is wrapped once and passed with windowsVerbatimArguments (Node would
  // otherwise escape inner quotes as \", which cmd doesn't understand -- CI,
  // 2026-09-29: `node -e "console.log('fine')"` printed nothing).
  return plat === 'win32' ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${command}"`]] : ['/bin/sh', ['-c', command]];
}

/** The deploy runner's shell: the user's login shell on Mac/Linux (so PATH
 *  matches their terminal), cmd.exe on Windows. */
export function loginShellArgv(command: string, plat: Plat = process.platform, env: NodeJS.ProcessEnv = process.env): [string, string[]] {
  if (plat === 'win32') return shellArgv(command, plat);
  return [env.SHELL || (plat === 'darwin' ? '/bin/zsh' : '/bin/sh'), ['-lc', command]];
}

export interface Resolved { command: string; args: string[]; shell: boolean }

/** How to spawn an npm-installed CLI (`codex`, `claude`). On Windows npm
 *  installs `codex.cmd`, which spawn('codex') cannot find, and Node refuses to
 *  spawn a .cmd without a shell (CVE-2024-27980). Prefer running the package's
 *  JS entry under this node; fall back to the .cmd through the shell. */
export function resolveCli(name: string, plat: Plat = process.platform, env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): Resolved {
  if (plat !== 'win32') return { command: name, args: [], shell: false };
  const dirs = (env.PATH ?? env.Path ?? '').split(';').filter(Boolean);
  const entries: Record<string, string> = {
    codex: 'node_modules\\@openai\\codex\\bin\\codex.js',
    claude: 'node_modules\\@anthropic-ai\\claude-code\\cli.js',
  };
  for (const d of dirs) {
    const cmd = win32.join(d, `${name}.cmd`);
    if (!exists(cmd)) {
      const exe = win32.join(d, `${name}.exe`);
      if (exists(exe)) return { command: exe, args: [], shell: false };
      continue;
    }
    const js = entries[name] ? win32.join(d, entries[name]) : '';
    if (js && exists(js)) return { command: process.execPath, args: [js], shell: false };
    return { command: `"${cmd}"`, args: [], shell: true };
  }
  return { command: name, args: [], shell: false };
}

/** Quote one argument for cmd.exe when a .cmd has to run through the shell. */
export const cmdQuote = (a: string): string => (/^[\w./:=@\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`);

/** spawn() arguments for an npm CLI with `args`, on any platform. */
export function cliSpawn(name: string, args: string[], plat: Plat = process.platform): { command: string; args: string[]; shell: boolean } {
  const r = resolveCli(name, plat);
  return r.shell ? { command: r.command, args: [...r.args, ...args].map(cmdQuote), shell: true } : { command: r.command, args: [...r.args, ...args], shell: false };
}

/** The Tailscale CLI, wherever this platform keeps it. */
export function tailscaleCandidates(plat: Plat = process.platform): string[] {
  if (plat === 'darwin') return ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];
  if (plat === 'win32') return ['tailscale', 'C:\\Program Files\\Tailscale\\tailscale.exe'];
  return ['tailscale'];
}
