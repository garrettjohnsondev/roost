import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './config.js';
import type { ServerEvent } from './protocol.js';

/** The Roost-visible thread, on disk, one event per line.
 *
 *  2026-09-24: the server was restarted while a job was mid-flight on the
 *  phone. The session came back (sessions.json remembers it) but its thread
 *  did not -- transcripts were RAM only -- so the phone showed an empty chat
 *  and a "Picking up from before" recap of the ENGINE's history, with no
 *  faces and no sign of what had just been happening. "I have no idea what's
 *  happening now." The thread is what the person sees; it has to survive the
 *  process that draws it.
 *
 *  Appends are buffered and flushed on a short unref'd timer, so a burst of
 *  tool events does not turn into a burst of syscalls (the ledger's sync
 *  appends are already noted as a bottleneck in the roadmap). Deltas are not
 *  written: the reducer folds them into the finished turn, and replay skips
 *  them for the same reason. */
const FLUSH_MS = 300;

export function transcriptPath(id: string): string {
  return join(dataDir(), 'transcripts', `${id}.jsonl`);
}

export class TranscriptWriter {
  private buf: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  constructor(private readonly id: string) {}

  append(event: ServerEvent): void {
    if (event.type === 'assistant_delta' || event.type === 'thinking_delta') return;
    this.buf.push(JSON.stringify(event));
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), FLUSH_MS);
      this.timer.unref();
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.buf.length) return;
    const lines = this.buf.splice(0).join('\n') + '\n';
    try {
      const path = transcriptPath(this.id);
      mkdirSync(join(path, '..'), { recursive: true });
      appendFileSync(path, lines);
    } catch (err: any) {
      console.warn(`[roost] could not persist transcript for ${this.id.slice(0, 8)}:`, String(err?.message ?? err));
    }
  }
}

/** The events written before the last restart, oldest first, capped to the
 *  most recent `cap`. A line that does not parse is skipped, not fatal: one
 *  torn write at a crash must not cost the whole thread. */
export function readTranscript(id: string, cap: number): ServerEvent[] {
  const path = transcriptPath(id);
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const out: ServerEvent[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* torn line */
    }
  }
  return out.length > cap ? out.slice(out.length - cap) : out;
}

export function removeTranscript(id: string): void {
  try {
    unlinkSync(transcriptPath(id));
  } catch {
    /* already gone */
  }
}

/** What a restored thread was doing when the process died: the last status it
 *  recorded. 'working' means a turn was cut off and the person should be told. */
export function lastState(events: ServerEvent[]): 'working' | 'idle' | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'status') return e.state === 'working' ? 'working' : 'idle';
  }
  return null;
}
