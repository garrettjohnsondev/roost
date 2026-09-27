import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { explore, extractFile, getCodeMap, impactReport, search, words } from '../src/codemap.js';

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'codemap-'));
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), text);
  }
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}

const APP = {
  'src/store.ts': `
    /** Keeps the grants a person gave for this session. */
    export class Store {
      save(key: string) { return this.write(key); }
      private write(key: string) { return key; }
    }
    export function makeStore() { return new Store(); }
  `,
  'src/deploy.ts': `
    import { makeStore } from './store.js';
    import * as util from './util';
    // Reports a restart after a deploy went live.
    export function reportRestart(commit: string) {
      const s = makeStore();
      s.save(commit);
      Object.create(null);
      return util.format(commit);
    }
  `,
  'src/util.ts': `export function format(x: string) { return x.trim(); }
  export function create() { return 1; }`,
  'src/index.ts': `export { reportRestart as announce } from './deploy';`,
  'src/main.ts': `
    import { announce } from './index';
    announce('abc');
  `,
  'src/View.tsx': `
    import { reportRestart } from './deploy';
    function Badge() { return null; }
    export default function View() { reportRestart('x'); return <div><Badge /></div>; }
  `,
  'src/view.test.ts': `export function reportRestartHelper() {}`,
  'node_modules/pkg/index.js': 'export function ignored() {}',
};

describe('the code map', () => {
  it('splits identifiers the way a question is phrased', () => {
    expect(words('handleClientMessage')).toEqual(['handle', 'client', 'message']);
    expect(words('gate_fingerprint URLParser')).toEqual(['gate', 'fingerprint', 'url', 'parser']);
  });

  it('extracts functions, classes, methods, components and imports from syntax alone', () => {
    const fx = extractFile('src/View.tsx', APP['src/View.tsx']);
    expect(fx.symbols.map((s) => `${s.qualified}:${s.kind}`)).toEqual(['Badge:component', 'View:component']);
    expect(fx.imports.reportRestart).toEqual({ module: './deploy', imported: 'reportRestart' });
    // JSX use of a component is a call edge
    expect(fx.calls.some((c) => c.name === 'Badge')).toBe(true);
  });

  it('resolves calls through imports, re-exports, namespaces, this and new -- and never into node_modules', () => {
    const root = project(APP);
    const m = getCodeMap(root);
    expect([...m.files.keys()].some((f) => f.includes('node_modules'))).toBe(false);
    const callees = (id: string) => (m.callees.get(id) ?? []).map((e) => e.to).sort();
    expect(callees('src/deploy.ts#reportRestart')).toEqual(['src/store.ts#Store.save', 'src/store.ts#makeStore', 'src/util.ts#format']);
    expect(callees('src/store.ts#Store.save')).toEqual(['src/store.ts#Store.write']);
    expect(callees('src/store.ts#makeStore')).toEqual(['src/store.ts#Store']);
    // through `export { reportRestart as announce }`
    expect(callees('src/main.ts#(module)')).toEqual(['src/deploy.ts#reportRestart']);
    expect(callees('src/View.tsx#View')).toEqual(['src/View.tsx#Badge', 'src/deploy.ts#reportRestart']);
  });

  it('a built-in receiver is never mistaken for project code with the same method name', () => {
    // Object.create(null) must not become a call to util.create
    const m = getCodeMap(project(APP));
    expect(m.callers.get('src/util.ts#create')).toBeUndefined();
  });

  it('finds code by what it does, not only by its name, and ranks tests below source', () => {
    const m = getCodeMap(project(APP));
    const hits = search(m, 'how is a restart reported after deploy');
    expect(hits[0].qualified).toBe('reportRestart');
    expect(hits.findIndex((s) => s.qualified === 'reportRestartHelper')).toBeGreaterThan(0);
    expect(search(m, 'where are grants for the session kept')[0].qualified).toBe('Store');
  });

  it('explore returns source with line numbers, callers, callees and the blast radius', () => {
    const root = project(APP);
    const out = explore(root, 'Store.save');
    expect(out).toMatch(/### Store\.save \(method, exported\) — lines \d+–\d+/);
    expect(out).toMatch(/\d+ {2}\s*save\(key: string\) \{ return this\.write\(key\); \}/);
    expect(out).toMatch(/Called by \(1\): reportRestart @ src\/deploy\.ts:\d+/);
    expect(out).toMatch(/Calls \(1\): Store\.write/);
    expect(out).toMatch(/## Blast radius of Store\.save/);
  });

  it('impact walks callers transitively, nearest first', () => {
    const out = impactReport(project(APP), 'Store.save');
    expect(out).toMatch(/- 1 hop: reportRestart/);
    expect(out).toMatch(/- 2 hops: .*\(module\).*View|- 2 hops: .*View.*\(module\)/);
  });

  it('stays current with the files on disk, re-parsing only what changed', () => {
    const root = project(APP);
    const first = getCodeMap(root);
    expect(getCodeMap(root)).toBe(first); // nothing moved: the same map, no rebuild
    writeFileSync(join(root, 'src/util.ts'), 'export function format(x: string) { return x; }\nexport function shout(x: string) { return format(x); }');
    utimesSync(join(root, 'src/util.ts'), new Date(), new Date(Date.now() + 5000));
    const second = getCodeMap(root);
    expect(second).not.toBe(first);
    expect(second.symbols.has('src/util.ts#shout')).toBe(true);
    expect(second.files.get('src/store.ts')).toBe(first.files.get('src/store.ts')); // untouched file reused
  });

  it('says so plainly when there is nothing to map', () => {
    expect(explore(project({ 'README.md': '# hi' }), 'anything')).toMatch(/code map is empty here/);
  });
});

describe('the code map for Codex', () => {
  it('is handed to each thread through config overrides, auto-approved, launched from Roost itself', async () => {
    const { codexCodemapConfig } = await import('../src/codemapTool.js');
    const cfg = codexCodemapConfig('/some/project') as any;
    const server = cfg['mcp_servers.roost'];
    expect(server.command).toBe(process.execPath);
    expect(server.args.at(-1)).toBe('/some/project');
    expect(server.args.some((a: string) => /codemapStdio\.(ts|js)$/.test(a))).toBe(true);
    expect(server.default_tools_approval_mode).toBe('approve');
  });

  it('the stdio server answers the same tools as the Claude side', async () => {
    const { spawn } = await import('node:child_process');
    const { codemapStdioCommand } = await import('../src/codemapTool.js');
    const root = project(APP);
    const cmd = codemapStdioCommand(root)!;
    const child = spawn(cmd.command, cmd.args, { stdio: ['pipe', 'pipe', 'ignore'] });
    const replies = new Map<number, any>();
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        try {
          const m = JSON.parse(line);
          if (m.id != null) replies.set(m.id, m);
        } catch { /* not ours */ }
      }
    });
    const send = (m: object) => child.stdin.write(JSON.stringify(m) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'code_explore', arguments: { query: 'Store.save' } } });
    for (let t = 0; t < 100 && !replies.has(3); t++) await new Promise((r) => setTimeout(r, 100));
    child.kill();
    expect(replies.get(1)?.result?.serverInfo?.name).toBe('roost');
    expect(replies.get(2)?.result?.tools.map((t: any) => t.name).sort()).toEqual(['code_explore', 'code_impact']);
    expect(replies.get(3)?.result?.content?.[0]?.text).toMatch(/### Store\.save \(method, exported\)/);
  }, 20_000);
});
