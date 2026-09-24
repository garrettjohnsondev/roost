import { describe, expect, it } from 'vitest';
import { segmentsOf, summarizeRun } from './toolruns';
import type { ChatItem } from './types';

const ts = 1;
const tool = (name: string, done = true, ok = true): ChatItem => ({ kind: 'tool', toolId: name + Math.random(), name, detail: 'x', done, ok, ts });
const user: ChatItem = { kind: 'user', text: 'hi', imageCount: 0, ts };
const reply: ChatItem = { kind: 'assistant', text: 'ok', complete: true, ts };

describe('tool runs fold consecutive calls, and only those', () => {
  it('leaves a lone tool as a plain item', () => {
    const items = [user, tool('Read'), reply];
    expect(segmentsOf(items, 0, 3)).toEqual([{ kind: 'item', index: 0 }, { kind: 'item', index: 1 }, { kind: 'item', index: 2 }]);
  });

  it('folds two or more in a row into one run', () => {
    const items = [user, tool('Read'), tool('Grep'), tool('Bash'), reply, tool('Edit'), tool('Bash')];
    expect(segmentsOf(items, 0, items.length)).toEqual([
      { kind: 'item', index: 0 },
      { kind: 'run', start: 1, end: 4 },
      { kind: 'item', index: 4 },
      { kind: 'run', start: 5, end: 7 },
    ]);
  });

  it('respects the slice it is given, so a chapter never folds across its edge', () => {
    const items = [tool('Read'), tool('Grep'), tool('Bash')];
    expect(segmentsOf(items, 1, 3)).toEqual([{ kind: 'run', start: 1, end: 3 }]);
  });
});

describe('a run says what it did, in plain words', () => {
  const t = (name: string, done = true, ok = true) => tool(name, done, ok) as Extract<ChatItem, { kind: 'tool' }>;

  it('counts by what the tool does, not what it is called', () => {
    const s = summarizeRun([t('Read'), t('Grep'), t('Glob'), t('Read'), t('Bash'), t('Bash'), t('Edit')]);
    expect(s.text).toBe('read 4 files, ran 2 commands, edited 1 file');
    expect(s.count).toBe(7);
  });

  it('knows the Codex names too', () => {
    expect(summarizeRun([t('exec_command'), t('apply_patch')]).text).toBe('ran 1 command, edited 1 file');
  });

  it('names the call in progress, so folding loses no state', () => {
    const s = summarizeRun([t('Read'), t('Bash', false)]);
    expect(s.running?.name).toBe('Bash');
  });

  it('counts failures', () => {
    expect(summarizeRun([t('Bash'), t('Bash', true, false)]).failed).toBe(1);
  });
});
