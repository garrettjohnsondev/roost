import { createReadStream, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { dataDir } from './config.js';

/** Per-project usage from the vendors' own local logs (roadmap #47, agreed
 *  2026-09-28): "Did we hammer Nell? … yayo bay used 30% of your weekly".
 *  Claude Code writes ~/.claude/projects/<slug>/*.jsonl with a `usage` block
 *  per reply; Codex writes ~/.codex/sessions/YYYY/MM/DD/*.jsonl with
 *  `token_count` events. Those logs are gigabytes, so each file is read once
 *  and then only from where it was last read (the offset is kept). */

export interface Bucket { tokens: number }
interface FileState {
  size: number;
  offset: number;
  agent: 'claude' | 'codex';
  cwd?: string;
  model?: string;
  /** day (yyyy-mm-dd) → cwd → model → tokens */
  days: Record<string, Record<string, Record<string, number>>>;
  seen?: string[];
}
interface Cache { files: Record<string, FileState> }

const cachePath = () => join(dataDir(), 'usage-scan.json');
let cache: Cache | null = null;
function loadCache(): Cache {
  if (cache) return cache;
  try { cache = JSON.parse(readFileSync(cachePath(), 'utf8')); } catch { cache = { files: {} }; }
  return cache!;
}
function saveCache(): void {
  try { mkdirSync(dataDir(), { recursive: true }); writeFileSync(cachePath(), JSON.stringify(cache)); } catch { /* next scan redoes it */ }
}

const DAY = 86_400_000;
const dayKey = (iso: string) => iso.slice(0, 10);

function recentFiles(root: string, depth: number, since: number): string[] {
  const out: string[] = [];
  const walk = (dir: string, d: number) => {
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const n of names) {
      const p = join(dir, n);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (d > 0) walk(p, d - 1); }
      else if (n.endsWith('.jsonl') && st.mtimeMs >= since) out.push(p);
    }
  };
  walk(root, depth);
  return out;
}

function add(f: FileState, day: string, cwd: string, model: string, n: number) {
  if (!n || !cwd) return;
  const d = (f.days[day] ??= {});
  const c = (d[cwd] ??= {});
  c[model] = (c[model] ?? 0) + n;
}

async function readFrom(path: string, f: FileState): Promise<void> {
  const st = statSync(path);
  if (st.size === f.size) return;
  if (st.size < f.size) { f.offset = 0; f.days = {}; f.seen = []; }
  const seen = new Set(f.seen ?? []);
  const rl = createInterface({ input: createReadStream(path, { start: f.offset, encoding: 'utf8' }), crlfDelay: Infinity });
  let pos = f.offset;
  for await (const line of rl) {
    pos += Buffer.byteLength(line, 'utf8') + 1;
    if (f.agent === 'claude') {
      if (!line.includes('"usage"')) continue;
      try {
        const e = JSON.parse(line);
        const m = e.message;
        if (e.type !== 'assistant' || !m?.usage || !e.timestamp) continue;
        const id = m.id ?? e.uuid;
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        const u = m.usage;
        // Cache reads are nearly free against the limit; count what costs.
        const n = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0);
        add(f, dayKey(e.timestamp), e.cwd ?? f.cwd ?? '', m.model ?? 'claude', n);
        if (e.cwd) f.cwd = e.cwd;
      } catch { /* a partial line at the end; read again next time */ }
    } else {
      if (!(line.includes('"token_count"') || line.includes('"session_meta"') || line.includes('"turn_context"'))) continue;
      try {
        const e = JSON.parse(line);
        const p = e.payload ?? {};
        if (e.type === 'session_meta' || e.type === 'turn_context') {
          if (p.cwd) f.cwd = p.cwd;
          if (p.model) f.model = p.model;
          continue;
        }
        const u = p.info?.last_token_usage;
        if (p.type !== 'token_count' || !u || !e.timestamp) continue;
        const n = Math.max(0, (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0)) + (u.output_tokens ?? 0);
        add(f, dayKey(e.timestamp), f.cwd ?? '', f.model ?? 'codex', n);
      } catch { /* partial line */ }
    }
  }
  f.offset = pos > st.size ? st.size : pos;
  f.size = st.size;
  f.seen = [...seen].slice(-4000);
}

let scanning: Promise<void> | null = null;
let lastScan = 0;

/** Brings the cache up to date (at most every few minutes; concurrent calls share one scan). */
export function scanUsage(opts: { claudeRoot?: string; codexRoot?: string; now?: number } = {}): Promise<void> {
  const now = opts.now ?? Date.now();
  if (scanning) return scanning;
  if (now - lastScan < 3 * 60_000 && !opts.claudeRoot) return Promise.resolve();
  scanning = (async () => {
    const c = loadCache();
    const since = now - 8 * DAY;
    const claudeRoot = opts.claudeRoot ?? join(homedir(), '.claude', 'projects');
    const codexRoot = opts.codexRoot ?? join(homedir(), '.codex', 'sessions');
    const files: Array<[string, 'claude' | 'codex']> = [
      ...recentFiles(claudeRoot, 1, since).map((p) => [p, 'claude'] as [string, 'claude']),
      ...recentFiles(codexRoot, 3, since).map((p) => [p, 'codex'] as [string, 'codex']),
    ];
    for (const [p, agent] of files) {
      const f = (c.files[p] ??= { size: 0, offset: 0, agent, days: {} });
      try { await readFrom(p, f); } catch { /* unreadable file; skip */ }
    }
    // Forget files older than the window.
    const keep = new Set(files.map(([p]) => p));
    for (const p of Object.keys(c.files)) if (!keep.has(p)) delete c.files[p];
    saveCache();
    lastScan = now;
  })().finally(() => { scanning = null; });
  return scanning;
}

export interface ProjectUsage {
  cwd: string;
  /** Tokens that count against the limit, last 7 days. */
  tokens: number;
  byAgent: { claude: number; codex: number };
  /** model → tokens */
  byModel: Record<string, number>;
  /** This project's share of all your use on that vendor this week (0..1). */
  share: { claude: number | null; codex: number | null };
}

/** Last 7 days per configured project. A folder inside a project counts
 *  toward it (the longest matching project wins). */
export function projectUsage(projects: string[], now = Date.now()): ProjectUsage[] {
  const c = loadCache();
  const from = dayKey(new Date(now - 7 * DAY).toISOString());
  const sorted = [...projects].sort((a, b) => b.length - a.length);
  const owner = (cwd: string) => sorted.find((p) => cwd === p || cwd.startsWith(p.endsWith('/') ? p : `${p}/`));
  const out = new Map<string, ProjectUsage>();
  const total = { claude: 0, codex: 0 };
  for (const f of Object.values(c.files)) {
    for (const [day, cwds] of Object.entries(f.days)) {
      if (day < from) continue;
      for (const [cwd, models] of Object.entries(cwds)) {
        for (const [model, n] of Object.entries(models)) {
          total[f.agent] += n;
          const p = owner(cwd);
          if (!p) continue;
          const u = out.get(p) ?? { cwd: p, tokens: 0, byAgent: { claude: 0, codex: 0 }, byModel: {}, share: { claude: null, codex: null } };
          u.tokens += n;
          u.byAgent[f.agent] += n;
          u.byModel[model] = (u.byModel[model] ?? 0) + n;
          out.set(p, u);
        }
      }
    }
  }
  for (const u of out.values()) {
    u.share = { claude: total.claude ? u.byAgent.claude / total.claude : null, codex: total.codex ? u.byAgent.codex / total.codex : null };
  }
  return [...out.values()].sort((a, b) => b.tokens - a.tokens);
}

export function _resetForTests(): void { cache = { files: {} }; lastScan = 0; scanning = null; }
