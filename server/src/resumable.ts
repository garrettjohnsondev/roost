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

const MAX_RESULTS = 20;

export async function listClaudeSessions(cwd: string): Promise<ResumableSession[]> {
  const sessions = await listSessions({ dir: cwd });
  return sessions
    .map((s) => ({
      id: s.sessionId,
      title: truncate(s.customTitle || s.summary || s.firstPrompt || 'Untitled session', 80),
      updatedAt: s.lastModified,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_RESULTS);
}

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

/** Codex rollout files: ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<threadId>.jsonl.
 *  First line is session_meta (thread id + cwd); user messages appear as
 *  response_item/message/role=user with input_text content. */
export function listCodexSessions(cwd: string): ResumableSession[] {
  const root = join(homedir(), '.codex', 'sessions');
  let files: string[];
  try {
    files = (readdirSync(root, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => join(root, f));
  } catch {
    return [];
  }

  const byMtime = files
    .map((path) => {
      try {
        return { path, mtime: statSync(path).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((f): f is { path: string; mtime: number } => f !== null)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 200);

  const results: ResumableSession[] = [];
  for (const { path, mtime } of byMtime) {
    if (results.length >= MAX_RESULTS) break;
    try {
      const lines = head(path, 128 * 1024).split('\n');
      const meta = JSON.parse(lines[0] ?? '{}');
      if (meta?.type !== 'session_meta') continue;
      const payload = meta.payload ?? {};
      if (payload.cwd !== cwd) continue;
      const id = payload.id ?? payload.session_id;
      if (!id) continue;

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
      results.push({ id, title, updatedAt: Math.round(mtime) });
    } catch {
      continue;
    }
  }
  return results;
}
