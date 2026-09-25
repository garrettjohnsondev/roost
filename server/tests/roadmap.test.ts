import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCorrections, parseOpen, parsePhases, parseTests, readRoadmap, roadmapFrom } from '../src/roadmap.js';

const MD = `# X

## 2. Status

| Phase | What | State |
|---|---|---|
| **0** | Truth — pricing, ledger | ✅ **Done, verified live** |
| **4b** | Effort as a routed dimension | 🟨 partial — clamp only |
| **8** | The crew UI (sprites) | ⬜ not started |

**12 tests green, typecheck clean both workspaces.** <!-- written by scripts -->

## 8. Corrections log

| # | What went wrong | Fix |
|---|---|---|
| 1 | a | b |
| 2 | c | d |

## 9. Open risks and unverified claims

1. **A risk** — not an open item.

## 12. Open — what is not built yet

1. ~~**Done thing**~~ — done.
2. **The boards** — still open.
3. Plain open item.
`;

describe('the map reads itself', () => {
  it('phases: id, short name, state from the cell, detail kept as evidence', () => {
    expect(parsePhases(MD)).toEqual([
      { id: '0', name: 'Truth', state: 'shipped', detail: 'Done, verified live' },
      { id: '4b', name: 'Effort as a routed dimension', state: 'in-hand', detail: 'partial — clamp only' },
      { id: '8', name: 'The crew UI', state: 'pending', detail: 'not started' },
    ]);
  });
  it('tests from the machine-written line, green or failing', () => {
    expect(parseTests(MD)).toEqual({ passed: 12, failing: 0 });
    expect(parseTests('**10 passing, 2 FAILING, typecheck clean**')).toEqual({ passed: 10, failing: 2 });
  });
  it('corrections are the numbered rows of the log, nothing else', () => {
    expect(parseCorrections(MD)).toBe(2);
  });
  it('open items are the unstruck ones in §12 — never §9 risks', () => {
    expect(parseOpen(MD)).toEqual([{ n: 2, title: 'The boards' }, { n: 3, title: 'Plain open item' }]);
  });
  it('a missing section is null (no data), never zero', () => {
    const r = roadmapFrom('# nothing here');
    expect(r).toEqual({ exists: true, phases: null, tests: null, corrections: null, open: null });
  });
  it('a project without a ROADMAP.md says so', () => {
    expect(readRoadmap(mkdtempSync(join(tmpdir(), 'rm-'))).exists).toBe(false);
    const d = mkdtempSync(join(tmpdir(), 'rm-'));
    writeFileSync(join(d, 'ROADMAP.md'), MD);
    expect(readRoadmap(d).phases).toHaveLength(3);
  });
});
