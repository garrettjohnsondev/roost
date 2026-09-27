import { describe, expect, it } from 'vitest';
import { classifyTool, compare, TurnTally, turnsFromTranscript, type TurnRow } from '../src/turnStats.js';

describe('turn stats: did the code map earn its keep', () => {
  it('sorts tools into map lookups, exploring, edits and the rest', () => {
    expect(classifyTool('mcp__roost__code_explore')).toBe('codemap');
    expect(classifyTool('roost:code_impact')).toBe('codemap');
    expect(classifyTool('Read')).toBe('explore');
    expect(classifyTool('Grep')).toBe('explore');
    expect(classifyTool('Bash', 'grep -rn "notice" server/src')).toBe('explore');
    expect(classifyTool('Bash', 'cd server && sed -n 1,40p src/a.ts')).toBe('explore');
    expect(classifyTool('Bash', 'npm test')).toBe('other');
    expect(classifyTool('Edit')).toBe('edit');
  });

  it('tallies one turn from the event stream and resets', () => {
    const t = new TurnTally();
    const ts = 1;
    t.observe({ type: 'tool_start', toolId: 'a', name: 'Read', detail: 'x.ts', ts });
    t.observe({ type: 'tool_start', toolId: 'b', name: 'mcp__roost__code_explore', detail: 'code map: x', ts });
    t.observe({ type: 'tool_start', toolId: 'c', name: 'Edit', detail: 'x.ts', ts });
    t.observe({ type: 'usage', usage: { inputTokens: 900, outputTokens: 50, costUsd: 0.01 } as any, ts });
    expect(t.finish({ at: 5, sessionId: 's', agent: 'claude', mapped: true })).toMatchObject({ tools: 3, explore: 1, codemap: 1, edits: 1, inTok: 900, costUsd: 0.01 });
    expect(t.finish({ at: 6, sessionId: 's', agent: 'claude', mapped: true })).toBeNull();
  });

  it('rebuilds turns from a saved transcript, ignoring notices, stopping at the cutoff', () => {
    const ev: any[] = [
      { type: 'status', state: 'working', ts: 1 },
      { type: 'tool_start', toolId: 'a', name: 'Grep', detail: 'x', ts: 2 },
      { type: 'status', state: 'idle', message: 'a notice, not the end', ts: 3 },
      { type: 'tool_start', toolId: 'b', name: 'Read', detail: 'x', ts: 4 },
      { type: 'status', state: 'idle', ts: 5 },
      { type: 'status', state: 'working', ts: 10 },
      { type: 'tool_start', toolId: 'c', name: 'Read', detail: 'x', ts: 11 },
      { type: 'status', state: 'idle', ts: 12 },
    ];
    const rows = turnsFromTranscript('s', 'claude', ev, { before: 9 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tools: 2, explore: 2, mapped: false, source: 'baseline' });
  });

  it('compares coding turns only, and says when there is not enough yet', () => {
    const r = (mapped: boolean, explore: number, codemap = 0): TurnRow => ({ at: 0, sessionId: 's', agent: 'claude', mapped, tools: explore + codemap + 1, explore, codemap, edits: 1 });
    const rows = [r(false, 8), r(false, 6), r(true, 1, 1), r(true, 3), { ...r(true, 0), tools: 0 }];
    const c = compare(rows, 2);
    expect(c.before.turns).toBe(2);
    expect(c.after.turns).toBe(2); // the tool-less chat turn is not a coding turn
    expect(c.usedMap.meanExplore).toBe(1);
    expect(c.enough).toBe(true);
    expect(compare(rows, 20).enough).toBe(false);
  });
});
