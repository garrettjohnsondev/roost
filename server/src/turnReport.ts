/**
 * `npm run codemap:report` -- did the code map cut the grep/read loop?
 *
 * The first run also rebuilds a "before" baseline from the transcripts still
 * on disk (turns that finished before the map went live); after that, every
 * live turn is recorded by the server itself (turnStats.ts).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir, statePath } from './config.js';
import { readTurns, recordTurn, reportText, turnsFromTranscript } from './turnStats.js';

/** fd42ecd went live: the first moment any crew member was offered the map. */
export const MAP_LIVE_AT = Date.parse('2026-09-27T12:11:11Z');

function buildBaseline(): number {
  const have = new Set(readTurns().filter((r) => r.source === 'baseline').map((r) => `${r.sessionId}@${r.at}`));
  const agents = new Map<string, string>();
  try {
    for (const s of JSON.parse(readFileSync(statePath(), 'utf8')).sessions ?? []) agents.set(s.id, s.agent);
  } catch {
    /* no state: assume Claude */
  }
  const dir = join(dataDir(), 'transcripts');
  if (!existsSync(dir)) return 0;
  let added = 0;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
    const id = f.replace(/\.jsonl$/, '');
    const events = readFileSync(join(dir, f), 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });
    for (const row of turnsFromTranscript(id, agents.get(id) ?? 'claude', events, { before: MAP_LIVE_AT })) {
      if (have.has(`${row.sessionId}@${row.at}`)) continue;
      recordTurn(row);
      added++;
    }
  }
  return added;
}

const added = buildBaseline();
if (added) console.log(`(added ${added} baseline turns from saved transcripts)\n`);
console.log(reportText(readTurns()));
