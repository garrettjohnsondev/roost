// Releases: the last two builds that passed the smoke check, and the way back.
//
// 2026-09-24: a bad build crashed every session all day and there was no way to
// undo it from the phone. Two things made that possible, and this file removes
// both:
//
// 1. A build went live the moment it was written. The server served web/dist
//    straight from disk, so `npm run build` — run by hand, by an agent checking
//    its work, by anyone — changed what the phone got, checked or not. Now the
//    server serves the CURRENT RELEASE, and a build becomes a release only after
//    it passes the smoke check.
// 2. There was nothing to go back to. The previous release is kept, and
//    `rollback` swaps it in and restarts — from the terminal, or from the phone
//    through the rescue page.
//
//   .roost-data/releases/current/{web,server,meta.json}   what is live
//   .roost-data/releases/previous/{web,server,meta.json}  the one before it

import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, statSync, createReadStream } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { execSync } from 'node:child_process';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export const releasesDir = join(repoRoot, '.roost-data', 'releases');
const cur = join(releasesDir, 'current');
const prev = join(releasesDir, 'previous');
const webDist = join(repoRoot, 'web', 'dist');
const serverDist = join(repoRoot, 'server', 'dist');

/** Plain directory renames and copies, never symlinks, so promote/rollback
 *  work unchanged on Windows. A rename there fails with EPERM/EBUSY while a
 *  file inside is open (the server streaming a page, an antivirus scan), so it
 *  is retried briefly instead of stranding a half-swapped release. */
function move(from, to) {
  for (let i = 0; ; i++) {
    try { return renameSync(from, to); } catch (e) {
      if (process.platform !== 'win32' || i >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
}

export function readMeta(which) {
  try {
    return JSON.parse(readFileSync(join(releasesDir, which, 'meta.json'), 'utf8'));
  } catch {
    return null;
  }
}

function commit() {
  try {
    const sha = execSync('git rev-parse --short HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' }).trim() ? '+uncommitted' : '';
    const subject = execSync('git log -1 --format=%s', { cwd: repoRoot, encoding: 'utf8' }).trim();
    return { commit: sha + dirty, subject };
  } catch {
    return { commit: 'unknown', subject: '' };
  }
}

/** The fresh build (web/dist, server/dist) becomes the current release; the old
 *  current becomes previous. Only called after the smoke check passed. */
export function promote() {
  mkdirSync(releasesDir, { recursive: true });
  const staging = join(releasesDir, 'staging');
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  cpSync(webDist, join(staging, 'web'), { recursive: true });
  cpSync(serverDist, join(staging, 'server'), { recursive: true });
  writeFileSync(join(staging, 'meta.json'), JSON.stringify({ ...commit(), at: new Date().toISOString(), smoke: 'passed' }, null, 2));
  rmSync(prev, { recursive: true, force: true });
  if (existsSync(cur)) move(cur, prev);
  move(staging, cur);
  return readMeta('current');
}

/** Swap previous and current, and put the (now current) release's server code
 *  back in server/dist, where the LaunchAgent runs it from. Swapping rather
 *  than overwriting means a rollback can itself be undone. */
export function rollback() {
  if (!existsSync(join(prev, 'meta.json'))) throw new Error('there is no previous release to go back to');
  const swap = join(releasesDir, 'swap');
  rmSync(swap, { recursive: true, force: true });
  move(cur, swap);
  move(prev, cur);
  move(swap, prev);
  rmSync(serverDist, { recursive: true, force: true });
  cpSync(join(cur, 'server'), serverDist, { recursive: true });
  return { now: readMeta('current'), was: readMeta('previous') };
}

/** A deploy that stopped (build error, failed check) has already overwritten
 *  server/dist — and server/dist is what the LaunchAgent runs on its next
 *  restart. Put the live release's server code back so a crash-restart cannot
 *  pick up code that never passed. */
export function restoreServer() {
  if (!existsSync(join(cur, 'server'))) return false;
  rmSync(serverDist, { recursive: true, force: true });
  cpSync(join(cur, 'server'), serverDist, { recursive: true });
  return true;
}

// ---- the candidate server --------------------------------------------------
// The new front end, served on a spare port, talking to the LIVE server for
// /api and /ws — exactly what a phone would get if this build went live. The
// smoke check runs against it before anything is promoted.

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

export function serveCandidate({ port, livePort }) {
  const proxied = (url) => url.startsWith('/api') || url.startsWith('/ws') || url.startsWith('/avatars/custom');
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (proxied(url)) {
      const up = httpRequest({ host: '127.0.0.1', port: livePort, path: url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${livePort}` } }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      });
      up.on('error', () => { res.writeHead(502); res.end(); });
      req.pipe(up);
      return;
    }
    const path = normalize(decodeURIComponent(url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    let file = join(webDist, path);
    if (!file.startsWith(webDist) || !existsSync(file) || statSync(file).isDirectory()) file = join(webDist, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  // WebSockets: hand the raw upgrade straight to the live server.
  server.on('upgrade', (req, socket, head) => {
    const up = connect(livePort, '127.0.0.1', () => {
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries({ ...req.headers, host: `127.0.0.1:${livePort}` }).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
      if (head?.length) up.write(head);
      up.pipe(socket); socket.pipe(up);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
