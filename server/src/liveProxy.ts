import type { IncomingMessage, ServerResponse } from 'node:http';
import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { extname, join, sep } from 'node:path';
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';

/** The two halves of proxying `/live/<pid>/…` to a running dev server:
 *  ordinary requests, and the WebSocket upgrade that hot reload depends on.
 *  No dependency pulled in for this -- Node's own `http` and `net` are the
 *  whole implementation, mirroring how small the rest of this server keeps
 *  its dependency list. */

export function proxyRequest(req: IncomingMessage, res: ServerResponse, port: number): void {
  const upstream = http.request(
    { host: '127.0.0.1', port, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${port}` } },
    (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers);
      upRes.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('The preview is not answering. It may have just stopped.');
  });
  req.pipe(upstream);
}

/** A raw socket proxy for the upgrade: the response to the upgrade request
 *  is the upstream's own, byte for byte, which is what a WebSocket
 *  handshake requires -- there is no `http.request` equivalent for this. */
export function proxyUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, port: number): void {
  const upstream = net.connect(port, '127.0.0.1', () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
}

const STATIC_TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.wasm': 'application/wasm', '.map': 'application/json', '.txt': 'text/plain', '.woff2': 'font/woff2',
};

/** Serves a built site (`static: dist`) at `/live/<pid>/…`, an SPA-style
 *  fallback to index.html for a path with no file (client-side routing),
 *  and never a file outside `root` -- the same real-path check images.ts
 *  uses, since this is another route that turns a URL into a filesystem
 *  read. `urlPath` is what came after the `/live/<pid>` prefix. */
export function serveStatic(root: string, urlPath: string, res: ServerResponse): void {
  // Resolved here too, not just by the caller: `root` may still contain a
  // symlink component (macOS's /tmp -> /private/tmp is the common one), and
  // comparing an unresolved root against a resolved file path always fails.
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    res.writeHead(404).end('Not found.');
    return;
  }
  const clean = urlPath.split('?')[0].split('#')[0];
  const rel = decodeURIComponent(clean === '' || clean === '/' ? '/index.html' : clean);
  const joined = join(realRoot, rel);
  let real: string;
  try {
    real = existsSync(joined) && statSync(joined).isFile() ? realpathSync(joined) : realpathSync(join(realRoot, 'index.html'));
  } catch {
    res.writeHead(404).end('Not found.');
    return;
  }
  if (real !== realRoot && !real.startsWith(realRoot.endsWith(sep) ? realRoot : realRoot + sep)) {
    res.writeHead(403).end('Refused.');
    return;
  }
  res.writeHead(200, { 'content-type': STATIC_TYPES[extname(real).toLowerCase()] ?? 'application/octet-stream' });
  createReadStream(real).pipe(res);
}

/** True for a request under `/live/<pid>` (with or without a trailing
 *  path), used to route both HTTP requests and upgrade events the same
 *  way before either has parsed out the pid. */
export function isLivePath(url: string | undefined): boolean {
  return !!url && /^\/live\/[^/]+(\/|$)/.test(url);
}

export function splitLivePath(url: string): { pid: string; rest: string } {
  const m = url.match(/^\/live\/([^/]+)(\/.*)?$/)!;
  return { pid: m[1], rest: m[2] ?? '/' };
}
