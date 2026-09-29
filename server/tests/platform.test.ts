import { describe, expect, it } from 'vitest';
import {
  isUnder, relativeInside, baseName, pathParts, claudeProjectDirName, listDrives, volumeShortcuts,
  shellArgv, loginShellArgv, resolveCli, cmdQuote, tailscaleCandidates,
} from '../src/platform.js';
import { shortTarget } from '../src/approvalWords.js';
// @ts-expect-error -- plain .mjs, no types
import { servicePaths, systemdUnit, windowsLauncher, schtasksCreateArgs } from '../../scripts/platform.mjs';

describe('platform path helpers', () => {
  it('isUnder: posix and Windows, either slash, any case on Windows', () => {
    expect(isUnder('/a/b', '/a/b/c', 'darwin')).toBe(true);
    expect(isUnder('/a/b', '/a/bc', 'darwin')).toBe(false);
    expect(isUnder('/a/b', '/a/b', 'linux')).toBe(true);
    expect(isUnder('C:\\code\\app', 'C:\\code\\app\\src\\x.ts', 'win32')).toBe(true);
    expect(isUnder('C:\\code\\app', 'c:/code/APP/src', 'win32')).toBe(true);
    expect(isUnder('C:\\code\\app', 'C:\\code\\apple', 'win32')).toBe(false);
    expect(isUnder('C:\\code', 'D:\\code', 'win32')).toBe(false);
  });

  it('relativeInside uses forward slashes', () => {
    expect(relativeInside('C:\\p', 'C:\\p\\src\\a.ts', 'win32')).toBe('src/a.ts');
    expect(relativeInside('/p', '/q/a.ts', 'linux')).toBeNull();
  });

  it('baseName / pathParts take either slash', () => {
    expect(baseName('/Volumes/SSD/remote')).toBe('remote');
    expect(baseName('C:\\code\\remote\\')).toBe('remote');
    expect(pathParts('C:\\a/b\\c')).toEqual(['C:', 'a', 'b', 'c']);
  });

  it('approval words shorten a Windows path to the project', () => {
    expect(shortTarget('C:\\p\\src\\a.ts', 'C:\\p')).toBe('src/a.ts');
    expect(shortTarget('/p/src/a.ts', '/p')).toBe('src/a.ts');
  });

  it('encodes ~/.claude/projects folder names the way Claude Code does', () => {
    expect(claudeProjectDirName('/Users/me/my app')).toBe('-Users-me-my-app');
    expect(claudeProjectDirName('C:\\Users\\me\\app')).toBe('C--Users-me-app');
    expect(claudeProjectDirName('/Volumes/PortableSSD/remote')).toBe('-Volumes-PortableSSD-remote');
  });
});

describe('folder browser shortcuts', () => {
  const fs = (tree: Record<string, string[]>, real: Record<string, string> = {}, drives: string[] = []) => ({
    readdir: (p: string) => { if (!tree[p]) throw new Error('ENOENT'); return tree[p]; },
    realpath: (p: string) => real[p] ?? p,
    exists: (p: string) => drives.includes(p),
  });

  it('lists drive letters on Windows', () => {
    expect(listDrives((p) => p === 'C:\\' || p === 'E:\\')).toEqual(['C:\\', 'E:\\']);
  });

  it('Windows: other drives, not the system one', () => {
    expect(volumeShortcuts('win32', fs({}, {}, ['C:\\', 'D:\\']), { SystemDrive: 'C:' })).toEqual([{ name: 'D:', path: 'D:\\' }]);
  });

  it('Mac: /Volumes minus the boot disk', () => {
    expect(volumeShortcuts('darwin', fs({ '/Volumes': ['Macintosh HD', 'SSD', '.hidden'] }, { '/Volumes/Macintosh HD': '/' }))).toEqual([{ name: 'SSD', path: '/Volumes/SSD' }]);
  });

  it('Linux: /media/<user> and /mnt', () => {
    expect(volumeShortcuts('linux', fs({ '/media/ann': ['USB'], '/mnt': ['data'] }), { USER: 'ann' })).toEqual([
      { name: 'USB', path: '/media/ann/USB' }, { name: 'data', path: '/mnt/data' },
    ]);
  });
});

describe('running commands', () => {
  it('uses cmd.exe on Windows, sh elsewhere', () => {
    expect(shellArgv('npm test', 'linux')).toEqual(['/bin/sh', ['-c', 'npm test']]);
    const [sh, args] = shellArgv('npm test', 'win32');
    expect(sh).toMatch(/cmd\.exe$/i);
    expect(args).toEqual(['/d', '/s', '/c', '"npm test"']);
    expect(loginShellArgv('x', 'darwin', { SHELL: '/bin/zsh' })).toEqual(['/bin/zsh', ['-lc', 'x']]);
    expect(loginShellArgv('x', 'darwin', {})[0]).toBe('/bin/zsh');
    expect(loginShellArgv('x', 'win32', {})[1]).toEqual(['/d', '/s', '/c', '"x"']);
  });

  it('finds codex.cmd on Windows and prefers its JS entry under node', () => {
    const env = { PATH: 'C:\\Windows;C:\\npm' };
    expect(resolveCli('codex', 'darwin', env)).toEqual({ command: 'codex', args: [], shell: false });
    const js = 'C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js';
    expect(resolveCli('codex', 'win32', env, (p) => p === 'C:\\npm\\codex.cmd' || p === js)).toEqual({ command: process.execPath, args: [js], shell: false });
    expect(resolveCli('codex', 'win32', env, (p) => p === 'C:\\npm\\codex.cmd')).toEqual({ command: '"C:\\npm\\codex.cmd"', args: [], shell: true });
    expect(resolveCli('codex', 'win32', env, (p) => p === 'C:\\npm\\codex.exe')).toEqual({ command: 'C:\\npm\\codex.exe', args: [], shell: false });
  });

  it('quotes cmd.exe arguments only when needed', () => {
    expect(cmdQuote('app-server')).toBe('app-server');
    expect(cmdQuote('mcp_servers={}')).toBe('"mcp_servers={}"');
    expect(cmdQuote('a "b"')).toBe('"a ""b"""');
  });

  it('knows where Tailscale lives', () => {
    expect(tailscaleCandidates('darwin')).toContain('/Applications/Tailscale.app/Contents/MacOS/Tailscale');
    expect(tailscaleCandidates('win32')).toContain('C:\\Program Files\\Tailscale\\tailscale.exe');
  });
});

describe('service backends (scripts/platform.mjs)', () => {
  it('logs to %LOCALAPPDATA%\\Roost on Windows, ~/Library/Logs on Mac, XDG state on Linux', () => {
    expect(servicePaths('win32', { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, 'C:\\Users\\me').log).toBe('C:\\Users\\me\\AppData\\Local\\Roost\\roost.log');
    expect(servicePaths('darwin', {}, '/Users/me').log).toBe('/Users/me/Library/Logs/roost.log');
    const l = servicePaths('linux', {}, '/home/me');
    expect(l.log).toBe('/home/me/.local/state/roost/roost.log');
    expect(l.unit).toBe('/home/me/.config/systemd/user/roost.service');
  });

  it('the systemd unit restarts on crash and never kills a deploy the server spawned', () => {
    const u = systemdUnit({ nodeBin: '/usr/bin/node', serverEntry: '/r/server/dist/index.js', repoRoot: '/r', log: '/l/roost.log', home: '/home/me' });
    expect(u).toContain('ExecStart=/usr/bin/node /r/server/dist/index.js');
    expect(u).toContain('Restart=always');
    expect(u).toContain('KillMode=process');
    expect(u).toContain('StandardOutput=append:/l/roost.log');
  });

  it('the Windows launcher runs the supervisor hidden, and the task runs at logon', () => {
    const v = windowsLauncher({ nodeBin: 'C:\\Program Files\\nodejs\\node.exe', serviceScript: 'C:\\r\\scripts\\service.mjs', repoRoot: 'C:\\r' });
    expect(v).toContain('sh.Run """C:\\Program Files\\nodejs\\node.exe"" ""C:\\r\\scripts\\service.mjs"" supervise", 0, False');
    expect(schtasksCreateArgs('C:\\x\\roost.vbs')).toEqual(['/Create', '/F', '/SC', 'ONLOGON', '/RL', 'LIMITED', '/TN', 'Roost', '/TR', 'wscript.exe "C:\\x\\roost.vbs"']);
  });
});
