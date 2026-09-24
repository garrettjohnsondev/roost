import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fromPid, LiveManager, parseLiveConfig, toPid } from '../src/live.js';
import { isLivePath, proxyRequest, serveStatic, splitLivePath } from '../src/liveProxy.js';
import type { ProjectKnowledge } from '../src/projectFile.js';

const knowledgeOf = (sections: Record<string, string>): ProjectKnowledge => ({ sections, path: '', exists: true });

describe('the ## preview section, read the way a person actually writes it', () => {
  it('a bare command line', () => {
    expect(parseLiveConfig(knowledgeOf({ preview: 'npm run dev -- --port {port} --host 127.0.0.1' }))).toEqual({
      kind: 'command',
      command: 'npm run dev -- --port {port} --host 127.0.0.1',
    });
  });
  it('a backticked command, or a markdown bullet', () => {
    expect(parseLiveConfig(knowledgeOf({ preview: '`npm run dev -- --port {port}`' }))?.command).toBe('npm run dev -- --port {port}');
    expect(parseLiveConfig(knowledgeOf({ preview: '- npm start' }))?.command).toBe('npm start');
  });
  it('static:', () => {
    expect(parseLiveConfig(knowledgeOf({ preview: 'static: dist' }))).toEqual({ kind: 'static', dir: 'dist' });
    expect(parseLiveConfig(knowledgeOf({ preview: 'static: `build/`' }))).toEqual({ kind: 'static', dir: 'build/' });
  });
  it('no section: not configured, never a guess', () => {
    expect(parseLiveConfig(knowledgeOf({}))).toBeNull();
  });
});

describe('the proxy id round-trips a project path and rejects anything else', () => {
  it('encodes and decodes', () => {
    const cwd = '/Volumes/PortableSSD/remote';
    expect(fromPid(toPid(cwd))).toBe(cwd);
  });
  it('never resolves a forged or garbled pid', () => {
    expect(fromPid('not-a-real-pid!!')).toBeNull();
    expect(fromPid('')).toBeNull();
  });
});

describe('isLivePath / splitLivePath', () => {
  it('matches /live/<pid> with or without a trailing path', () => {
    expect(isLivePath('/live/abc123')).toBe(true);
    expect(isLivePath('/live/abc123/')).toBe(true);
    expect(isLivePath('/live/abc123/assets/main.js')).toBe(true);
    expect(isLivePath('/api/live/start')).toBe(false);
    expect(isLivePath('/ws')).toBe(false);
    expect(isLivePath(undefined)).toBe(false);
  });
  it('splits pid from the rest', () => {
    expect(splitLivePath('/live/abc123/assets/main.js')).toEqual({ pid: 'abc123', rest: '/assets/main.js' });
    expect(splitLivePath('/live/abc123')).toEqual({ pid: 'abc123', rest: '/' });
  });
});

describe('LiveManager: not configured, static, and idle sweep', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'roost-live-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('reports unconfigured for a project with no ## preview section', async () => {
    const mgr = new LiveManager();
    expect((await mgr.start(tmp)).configured).toBe(false);
    expect(mgr.status(tmp).configured).toBe(false);
  });

  it('a static preview needs no process and is running immediately', async () => {
    const proj = join(tmp, 'staticproj');
    mkdirSync(join(proj, '.roost'), { recursive: true });
    mkdirSync(join(proj, 'dist'));
    writeFileSync(join(proj, 'dist', 'index.html'), '<h1>hi</h1>');
    writeFileSync(join(proj, '.roost', 'project.md'), '## preview\n\nstatic: dist\n');
    const mgr = new LiveManager();
    const info = await mgr.start(proj);
    expect(info).toMatchObject({ configured: true, state: 'running', kind: 'static' });
    expect(info.url).toBe(`/live/${toPid(proj)}/`);
    const target = mgr.target(toPid(proj));
    expect(target?.kind).toBe('static');
    mgr.stop(proj);
    expect(mgr.status(proj).state).toBe('stopped');
  });

  it('a stopped or unknown pid resolves to no target', () => {
    const mgr = new LiveManager();
    expect(mgr.target(toPid('/nowhere'))).toBeNull();
    expect(mgr.target('garbage')).toBeNull();
  });

  it('a command preview starts a real process, answers on its port, and stop() kills it', async () => {
    const proj = join(tmp, 'cmdproj');
    mkdirSync(join(proj, '.roost'), { recursive: true });
    const server = "require('http').createServer((q,s)=>s.end('ok')).listen(process.env.PORT)";
    writeFileSync(join(proj, '.roost', 'project.md'), `## preview\n\n\`node -e "${server}"\`\n`);
    const mgr = new LiveManager();
    const info = await mgr.start(proj);
    expect(info.state).toBe('running');
    const target = mgr.target(toPid(proj));
    expect(target?.kind).toBe('command');
    if (target?.kind === 'command') {
      const res = await fetch(`http://127.0.0.1:${target.port}/`);
      expect(await res.text()).toBe('ok');
    }
    mgr.stop(proj);
    await new Promise((r) => setTimeout(r, 200));
    expect(mgr.status(proj).state).toBe('stopped');
  }, 15_000);

  it('a command that never opens its port reports an error, with the output that explains why', async () => {
    const proj = join(tmp, 'failproj');
    mkdirSync(join(proj, '.roost'), { recursive: true });
    writeFileSync(join(proj, '.roost', 'project.md'), "## preview\n\n`node -e \"console.error('boom'); process.exit(1)\"`\n");
    const mgr = new LiveManager();
    const info = await mgr.start(proj);
    expect(info.state).toBe('error');
    expect(info.error).toBeTruthy();
    expect(info.output?.some((l) => l.includes('boom'))).toBe(true);
  }, 15_000);

  it('sweepIdle stops a running preview past the idle window, and leaves a fresh one alone', async () => {
    const proj = join(tmp, 'idleproj');
    mkdirSync(join(proj, '.roost'), { recursive: true });
    mkdirSync(join(proj, 'dist'));
    writeFileSync(join(proj, 'dist', 'index.html'), 'x');
    writeFileSync(join(proj, '.roost', 'project.md'), '## preview\n\nstatic: dist\n');
    const mgr = new LiveManager();
    await mgr.start(proj);
    mgr.sweepIdle();
    expect(mgr.status(proj).state).toBe('running');
    (mgr as any).byCwd.get(proj).lastActivityAt = 0;
    mgr.sweepIdle();
    expect(mgr.status(proj).state).toBe('stopped');
  });
});

describe('proxyRequest forwards to the real upstream, including a failure', () => {
  let target: HttpServer;
  let port: number;
  beforeAll(async () => {
    target = createHttpServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain', 'x-seen-path': req.url ?? '' });
      res.end('hello from upstream');
    });
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    port = (target.address() as any).port;
  });
  afterAll(() => new Promise<void>((r) => target.close(() => r())));

  it('proxies a GET, body and headers intact, path preserved', async () => {
    const proxy = createHttpServer((req, res) => proxyRequest(req, res, port));
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const pport = (proxy.address() as any).port;
    try {
      const res = await fetch(`http://127.0.0.1:${pport}/live/xyz/assets/app.js`);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-seen-path')).toBe('/live/xyz/assets/app.js');
      expect(await res.text()).toBe('hello from upstream');
    } finally {
      await new Promise<void>((r) => proxy.close(() => r()));
    }
  });

  it('answers 502 when the upstream is gone, instead of hanging', async () => {
    const deadPort = port + 1; // nothing listens here
    const proxy = createHttpServer((req, res) => proxyRequest(req, res, deadPort));
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const pport = (proxy.address() as any).port;
    try {
      const res = await fetch(`http://127.0.0.1:${pport}/`);
      expect(res.status).toBe(502);
    } finally {
      await new Promise<void>((r) => proxy.close(() => r()));
    }
  });
});

describe('serveStatic: the built site, an SPA fallback, and never a file outside root', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'roost-static-'));
  mkdirSync(join(tmp, 'root'));
  writeFileSync(join(tmp, 'root', 'index.html'), '<h1>root</h1>');
  mkdirSync(join(tmp, 'root', 'assets'));
  writeFileSync(join(tmp, 'root', 'assets', 'app.js'), 'console.log(1)');
  writeFileSync(join(tmp, 'secret.txt'), 'do not serve me');
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  function serve(root: string, urlPath: string): Promise<{ status: number; type?: string; body: string }> {
    const srv = createHttpServer((req, res) => serveStatic(root, urlPath, res));
    return new Promise((resolve) => {
      srv.listen(0, '127.0.0.1', async () => {
        const port = (srv.address() as any).port;
        const res = await fetch(`http://127.0.0.1:${port}/`);
        srv.close();
        resolve({ status: res.status, type: res.headers.get('content-type') ?? undefined, body: await res.text() });
      });
    });
  }

  it('serves a real file with its content type', async () => {
    const r = await serve(join(tmp, 'root'), '/assets/app.js');
    expect(r.status).toBe(200);
    expect(r.type).toContain('javascript');
    expect(r.body).toBe('console.log(1)');
  });

  it('falls back to index.html for an unknown path (client-side routing)', async () => {
    const r = await serve(join(tmp, 'root'), '/some/spa/route');
    expect(r.status).toBe(200);
    expect(r.body).toContain('root');
  });

  it('refuses a path that escapes root, even when the file exists elsewhere', async () => {
    const r = await serve(join(tmp, 'root'), '/../secret.txt');
    expect(r.status).not.toBe(200);
    expect(r.body).not.toContain('do not serve me');
  });
});
