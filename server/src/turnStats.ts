/**
 * One durable row per crew turn: how many tools it used, how many of those
 * were exploring the code (reads, searches, listing), whether it used the
 * code map, and what the turn cost -- so "does the code map actually save
 * anything?" (2026-09-27) is answered from your own turns, not from the
 * benchmark in somebody's README.
 *
 * Transcripts would have had this, but they are deleted when a session
 * closes; the usage ledger survives but knows nothing about tools. This is
 * the small thing in between: .roost-data/turns.jsonl.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './config.js';
import type { ServerEvent } from './protocol.js';

export type ToolClass = 'codemap' | 'explore' | 'edit' | 'other';

export interface TurnRow {
  at: number;
  sessionId: string;
  agent: string;
  model?: string;
  /** The code map was offered on this turn (false only for the pre-map baseline). */
  mapped: boolean;
  tools: number;
  explore: number;
  codemap: number;
  edits: number;
  inTok?: number;
  outTok?: number;
  costUsd?: number;
  source?: 'live' | 'baseline';
}

/** A shell command that only looks around: the grep/read loop the map replaces. */
const LOOKING = /^\s*(?:cd\s+\S+\s*&&\s*)?(?:grep|rg|ag|find|fd|ls|cat|head|tail|less|wc|tree|sed\s+-n|awk|git\s+(?:grep|log|show|diff|ls-files|blame))\b/;

export function classifyTool(name: string, detail = ''): ToolClass {
  if (/(^|__|:)code_(explore|impact)$/.test(name)) return 'codemap';
  if (/^(Read|Grep|Glob|LS|NotebookRead)$/.test(name)) return 'explore';
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(name) || /file change|patch/i.test(name)) return 'edit';
  if (/^(Bash|command|shell|exec)/i.test(name) && LOOKING.test(detail)) return 'explore';
  return 'other';
}

/** Tallies one turn from the session's own event stream. */
export class TurnTally {
  private tools = 0;
  private explore = 0;
  private codemap = 0;
  private edits = 0;
  private usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number | null };

  observe(e: ServerEvent): void {
    if (e.type === 'tool_start') {
      this.tools++;
      const c = classifyTool(e.name, e.detail);
      if (c === 'explore') this.explore++;
      else if (c === 'codemap') this.codemap++;
      else if (c === 'edit') this.edits++;
    } else if (e.type === 'usage') {
      this.usage = e.usage as any;
    }
  }

  /** The finished turn's row, or null if nothing happened worth counting. Resets for the next turn. */
  finish(base: { at: number; sessionId: string; agent: string; model?: string; mapped: boolean; source?: TurnRow['source'] }): TurnRow | null {
    const row: TurnRow | null =
      this.tools || this.usage
        ? {
            ...base,
            tools: this.tools,
            explore: this.explore,
            codemap: this.codemap,
            edits: this.edits,
            inTok: this.usage?.inputTokens,
            outTok: this.usage?.outputTokens,
            costUsd: this.usage?.costUsd ?? undefined,
          }
        : null;
    this.tools = this.explore = this.codemap = this.edits = 0;
    this.usage = undefined;
    return row;
  }
}

export const turnsPath = () => join(dataDir(), 'turns.jsonl');

export function recordTurn(row: TurnRow): void {
  try {
    appendFileSync(turnsPath(), JSON.stringify(row) + '\n');
  } catch {
    /* measurement must never break a turn */
  }
}

export function readTurns(path = turnsPath()): TurnRow[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as TurnRow];
      } catch {
        return [];
      }
    });
}

/** Turns rebuilt from a saved transcript: a turn ends at an idle status that is not a notice's. */
export function turnsFromTranscript(sessionId: string, agent: string, events: ServerEvent[], opts: { before: number }): TurnRow[] {
  const out: TurnRow[] = [];
  const t = new TurnTally();
  let working = false;
  for (const e of events) {
    if ((e as any).ts >= opts.before) break;
    t.observe(e);
    if (e.type === 'status' && e.state === 'working') working = true;
    if (e.type === 'status' && e.state === 'idle' && !e.message && working) {
      working = false;
      const row = t.finish({ at: e.ts, sessionId, agent, mapped: false, source: 'baseline' });
      if (row && row.tools > 0) out.push(row);
    }
  }
  return out;
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export interface Side {
  turns: number;
  medianTools: number;
  medianExplore: number;
  meanExplore: number;
  medianInTok: number;
  meanCost: number;
}

function side(rows: TurnRow[]): Side {
  return {
    turns: rows.length,
    medianTools: median(rows.map((r) => r.tools)),
    medianExplore: median(rows.map((r) => r.explore)),
    meanExplore: mean(rows.map((r) => r.explore)),
    medianInTok: median(rows.filter((r) => r.inTok != null).map((r) => r.inTok!)),
    meanCost: mean(rows.filter((r) => r.costUsd != null).map((r) => r.costUsd!)),
  };
}

/** Coding turns only (at least one tool): a plain chat reply has nothing to explore. */
export function compare(rows: TurnRow[], enough = 20) {
  const coding = rows.filter((r) => r.tools > 0);
  const before = side(coding.filter((r) => !r.mapped));
  const after = side(coding.filter((r) => r.mapped));
  const usedMap = side(coding.filter((r) => r.mapped && r.codemap > 0));
  const skippedMap = side(coding.filter((r) => r.mapped && r.codemap === 0));
  return { before, after, usedMap, skippedMap, enough: before.turns >= enough && after.turns >= enough };
}

export function reportText(rows: TurnRow[]): string {
  const c = compare(rows);
  const f = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—');
  const line = (label: string, s: Side) =>
    `${label.padEnd(22)} ${String(s.turns).padStart(5)}  ${f(s.medianTools).padStart(6)}  ${f(s.medianExplore).padStart(8)}  ${f(s.meanExplore).padStart(8)}  ${f(s.medianInTok / 1000, 0).padStart(7)}k  $${f(s.meanCost, 3).padStart(6)}`;
  return [
    `Code map: coding turns before vs after (${rows.length} turns recorded)`,
    `${''.padEnd(22)} turns  tools~  explore~  explore⌀  input~   cost⌀`,
    line('before the map', c.before),
    line('after the map', c.after),
    line('  … used the map', c.usedMap),
    line('  … did not use it', c.skippedMap),
    '',
    c.enough
      ? 'Enough turns on both sides to read the difference.'
      : `Not enough yet: need 20 coding turns on each side (have ${c.before.turns} before, ${c.after.turns} after).`,
    '~ median, ⌀ mean. "explore" = Read/Grep/Glob and look-only shell commands (grep, find, cat, ls, sed -n, git log…).',
    'Input tokens grow with a session\'s length regardless of the map, so tools and explore calls are the cleaner signal.',
  ].join('\n');
}
