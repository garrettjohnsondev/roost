import { openSync, readSync, closeSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { listSessions } from '@anthropic-ai/claude-agent-sdk';
import { truncate } from './util.js';

export interface ResumableSession {
  id: string;
  title: string;
  updatedAt: number;
}

interface GroupedSession extends ResumableSession {
  cwd: string;
}

const MAX_PER_PROJECT = 20;
const GROUP_TTL_MS = 60_000;

/** Read at most `bytes` from the start of a file without loading the whole thing. */
function head(path: string, bytes: number): string {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const read = readSync(fd, buf, 0, bytes, 0);
    return buf.toString('utf8', 0, read);
  } finally {
    closeSync(fd);
  }
}

let claudeCache: { at: number; byCwd: Map<string, GroupedSession[]> } | null = null;

async function loadClaudeGrouped(): Promise<Map<string, GroupedSession[]>> {
  if (claudeCache && Date.now() - claudeCache.at < GROUP_TTL_MS) return claudeCache.byCwd;
  const all = await listSessions({});
  const byCwd = new Map<string, GroupedSession[]>();
  for (const s of all) {
    if (!s.cwd) continue;
    const entry: GroupedSession = {
      id: s.sessionId,
      title: truncate(s.customTitle || s.summary || s.firstPrompt || 'Untitled session', 80),
      updatedAt: s.lastModified,
      cwd: s.cwd,
    };
    const bucket = byCwd.get(s.cwd);
    if (bucket) {
      if (bucket.length < MAX_PER_PROJECT) bucket.push(entry);
    } else {
      byCwd.set(s.cwd, [entry]);
    }
  }
  claudeCache = { at: Date.now(), byCwd };
  return byCwd;
}

let codexCache: { at: number; byCwd: Map<string, GroupedSession[]> } | null = null;

/** Codex rollout files: ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<threadId>.jsonl.
 *  First line is session_meta (thread id + cwd); user messages appear as
 *  response_item/message/role=user with input_text content. */
function loadCodexGrouped(): Map<string, GroupedSession[]> {
  if (codexCache && Date.now() - codexCache.at < GROUP_TTL_MS) return codexCache.byCwd;

  const root = join(homedir(), '.codex', 'sessions');
  let files: string[];
  try {
    files = (readdirSync(root, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => join(root, f));
  } catch {
    files = [];
  }

  const byCwd = new Map<string, GroupedSession[]>();
  for (const path of files) {
    try {
      const lines = head(path, 128 * 1024).split('\n');
      const meta = JSON.parse(lines[0] ?? '{}');
      if (meta?.type !== 'session_meta') continue;
      const payload = meta.payload ?? {};
      const cwd = payload.cwd;
      const id = payload.id ?? payload.session_id;
      if (!cwd || !id) continue;

      let title = 'Untitled session';
      for (const line of lines.slice(1)) {
        let entry: any;
        try {
          entry = JSON.parse(line);
        } catch {
          continue; // possibly a truncated final line from head()
        }
        const p = entry?.payload;
        if (entry?.type === 'response_item' && p?.type === 'message' && p?.role === 'user') {
          const text = (p.content ?? []).find(
            (c: any) => c?.type === 'input_text' && typeof c.text === 'string' && !c.text.startsWith('<'),
          )?.text;
          if (text) {
            title = truncate(text.replace(/\s+/g, ' ').trim(), 80);
            break;
          }
        }
      }
      const updatedAt = Math.round(statSync(path).mtimeMs);
      const bucket = byCwd.get(cwd);
      const record: GroupedSession = { id, title, updatedAt, cwd };
      if (bucket) bucket.push(record);
      else byCwd.set(cwd, [record]);
    } catch {
      continue;
    }
  }
  for (const bucket of byCwd.values()) bucket.sort((a, b) => b.updatedAt - a.updatedAt);
  codexCache = { at: Date.now(), byCwd };
  return byCwd;
}

export async function listClaudeSessions(cwd: string): Promise<ResumableSession[]> {
  const byCwd = await loadClaudeGrouped();
  return (byCwd.get(cwd) ?? []).slice(0, MAX_PER_PROJECT);
}

export async function listCodexSessions(cwd: string): Promise<ResumableSession[]> {
  const byCwd = loadCodexGrouped();
  return (byCwd.get(cwd) ?? []).slice(0, MAX_PER_PROJECT);
}

export interface RecentProject {
  path: string;
  lastAgent: 'claude' | 'codex';
  lastActivity: number;
  lastTitle: string;
  lastResumeId: string;
}

/** Most-recently-active session per project, across both agents — the data
 *  behind the phone's "jump back in" home screen. */
export async function getRecentProjects(projects: string[]): Promise<RecentProject[]> {
  const [claudeByCwd, codexByCwd] = await Promise.all([loadClaudeGrouped(), Promise.resolve(loadCodexGrouped())]);
  const recents: RecentProject[] = [];
  for (const path of projects) {
    const topClaude = claudeByCwd.get(path)?.[0];
    const topCodex = codexByCwd.get(path)?.[0];
    const best =
      !topClaude && !topCodex
        ? null
        : !topCodex || (topClaude && topClaude.updatedAt >= topCodex.updatedAt)
          ? { agent: 'claude' as const, session: topClaude! }
          : { agent: 'codex' as const, session: topCodex! };
    if (!best) continue;
    recents.push({
      path,
      lastAgent: best.agent,
      lastActivity: best.session.updatedAt,
      lastTitle: best.session.title,
      lastResumeId: best.session.id,
    });
  }
  return recents.sort((a, b) => b.lastActivity - a.lastActivity);
}
