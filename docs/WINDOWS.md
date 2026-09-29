# Roost on Windows and Linux

Roost was built and deployed on a Mac. This page records everything that
touched the OS, what broke on Windows (and Linux), what was changed, and what is
still open. `.github/workflows/ci.yml` runs typecheck, tests, build, a real
server with the headless-Chrome smoke check, and service install/status/uninstall
on ubuntu, macOS and Windows. The owner has no Windows machine, so that CI run
is the proof.

The OS branches live in two places:

- `server/src/platform.ts`: path containment, basenames, drive listing,
  shells, npm CLI resolution, Tailscale location
- `scripts/platform.mjs`: service paths, the systemd unit, the Windows
  launcher, schtasks arguments

Both are unit-tested for all three platforms from any machine
(`server/tests/platform.test.ts`).

## What broke, and the fix

| Area | Problem on Windows (W) / Linux (L) | Fix |
|---|---|---|
| `scripts/service.mjs` | macOS only: `launchctl`, `~/Library`, `process.getuid()` (throws on W before anything runs), `sleep` and `tail` shell-outs | Branches: **Linux** uses a systemd `--user` unit (`~/.config/systemd/user/roost.service`, log `~/.local/state/roost/roost.log`, `KillMode=process` so a restart does not kill a deploy the server spawned, plus `loginctl enable-linger`). **Windows** uses a Scheduled Task `Roost` at logon that runs `wscript.exe roost.vbs`, which starts `node scripts/service.mjs supervise` with no window. The supervisor runs the server, restarts it 10 s after it exits (like launchd's KeepAlive/ThrottleInterval), logs to `%LOCALAPPDATA%\Roost\roost.log`, and writes its own pid and the server's to `roost.pids.json`. Restart kills the server pid only (not `/T`), so the supervisor brings it back and a deploy that the server spawned survives. If the launcher changed, it re-registers the task and runs it. `sleep`/`tail` are now done in JS. There is a new `start` command (start or restart the service, no build) for CI and setup. The Mac path is unchanged: same plist, same kickstart/bootstrap logic. The doctrine tests still pin it. |
| `scripts/releases.mjs` | Already used directory copies and renames, no symlinks. On W, a rename fails with EPERM/EBUSY while a file inside is open | `move()` retries the rename briefly on Windows |
| `scripts/smoke.mjs` | Chrome path was hard-coded to the Mac location | Uses `CHROME_PATH` if set, then the usual Mac, Linux and Windows install paths. Passes `--no-sandbox` on Linux CI |
| `scripts/setup.mjs` | The W `schtasks` line had broken quoting and ran node with a visible window. The L unit had no log and no KillMode. `--check` exited 1 in CI | All three OSes now go through `service.mjs install`. Added `--check --ci`, which only fails on missing Node or git |
| Codex spawn (`jsonrpc.ts`, `avatars.ts`), `claude auth status` (`claudeAuth.ts`) | npm installs `codex.cmd`/`claude.cmd` on W. `spawn('codex')` gets ENOENT, and Node refuses to spawn a `.cmd` without a shell (CVE-2024-27980) | `cliSpawn()` finds the shim on PATH and runs the package's JS entry under this node. It falls back to a `.exe`, or to the `.cmd` through the shell with cmd-quoted arguments |
| Codemap MCP server for Codex (`codemapTool.ts`) | Already `process.execPath` + absolute script path | No change needed |
| Gates, live previews and deploys (`verify.ts`, `live.ts`, `deploy.ts`) | `/bin/sh -c`, `sh -c` and `$SHELL -lc` do not exist on W | `shellArgv()` / `loginShellArgv()`: `cmd.exe /d /s /c` on W. POSIX is unchanged (`/bin/sh -c`, login shell with `-lc`) |
| Folder browser (`index.ts` `listVolumeShortcuts`) | `/Volumes` only | `volumeShortcuts()`: drive letters on W (the system drive is left out because Home covers it), `/media/$USER`, `/run/media/$USER` and `/mnt` on L |
| Tailscale URL printout (`index.ts`) | Mac app path only | `tailscaleCandidates()` includes `C:\Program Files\Tailscale\tailscale.exe` |
| `'/'` path splitting (server `toolDetail`, `sessions`, `index`, `rescue`, `approvalWords`, `projectUsage`, plus 8 web files) | `C:\code\app` was treated as a single segment, so project names showed as the whole path. `startsWith(p + '/')` never matched a W path, so per-project usage and short tool targets failed | Split on `/[\\/]/`. Containment checks use `isUnder()`/`relativeInside()` (`path.win32`, case-insensitive, either slash) |
| `~/.claude/projects` slugs | Roost does not build slugs: it reads the `cwd` recorded inside each jsonl (`projectUsage.ts`) and uses the SDK's `listSessions` (`resumable.ts`) | No change needed. `claudeProjectDirName()` documents and tests Claude Code's encoding (every non-alphanumeric character becomes `-`: `C:\Users\me\app` → `C--Users-me-app`) for any future caller |
| Transcripts, codemap file walk, usage scanners, git, newProject | Already used `path.join`, git `ls-files` (forward-slash keys, and `resolveModule` normalises `\` to `/`), and `execFile('git' / 'gh')` (real `.exe`s) | No change needed |
| Notifications (`notify.ts`) | HTTP only | No change needed |
| Line endings | A W checkout with `autocrlf` puts CRLF into sources that tests read with `\n`-anchored regexes | `.gitattributes`: `eol=lf` |
| Tests | Used `true`/`false`/`touch` (not in cmd.exe), 0600 file modes, a POSIX pty, `symlinkSync` (needs admin on W), `$HOME` | Made the commands portable (`exit 0`/`exit 1`/`echo`) and used `homedir()`. The mode and pty tests are skipped on W. The symlink test skips itself when links can't be created |

## What remains

- **Signing in to Claude from the phone** (`claudeAuth.startSignIn`) drives
  `claude setup-token` through `server/scripts/pty-bridge.py`, which needs a
  POSIX pty. On Windows, `canSignInFromPhone` is false (no `/usr/bin/python3`),
  so the phone falls back to "run `claude setup-token` on the computer". A
  ConPTY bridge (node-pty) would fix this.
- **Windows service in CI:** a hosted runner has no interactive logon session,
  so the `ONLOGON` task may register without ever running. The CI step
  therefore reports instead of failing on Windows and Linux (Linux runners may
  have no systemd user bus). On macOS it is strict.
- **Deploy recipes** (`deploy.ts`) run through `cmd.exe` on Windows. A project
  whose recipe is written in bash syntax needs a Windows-flavoured recipe or
  Git Bash on PATH.
- `images.ts` also allows `/tmp` and `/private/tmp`. On Windows those paths
  don't resolve and are dropped harmlessly; `os.tmpdir()` covers the real one.
- Signals: `child.kill('SIGTERM')` is a hard kill on Windows, which is
  acceptable for the timeouts where it is used.

## CI results (2026-09-29)
All green on windows-latest, macos-latest and ubuntu-latest: install, typecheck, tests, build, setup check, server start, smoke (39 pages in headless Chrome), service install/status/uninstall.

One open question for a real Windows user: when Roost runs as the logon task on the CI runner, the Claude Agent SDK's bundled `claude.exe` "exists but failed to launch", while the same server started directly on that runner lists Claude's models fine. Hosted runners run scheduled tasks in a non-interactive session without a full user profile, which is the likely cause; a normal Windows login should not have it. First tester on Windows: after `setup`, open Roost and check Settings → Models lists Claude's models. If it doesn't, the fallback is starting Roost from a terminal (`npm start`).
