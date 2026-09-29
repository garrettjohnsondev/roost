import { describe, expect, it } from 'vitest';
import { chaptersOf, chapterName, dayLabel, groupChaptersByDay, isWeakName, type Chapter } from './chapters';
import type { ChatItem } from './types';

const ollie = { name: 'Ollie' } as any, juno = { name: 'Juno' } as any, moss = { name: 'Moss' } as any;
const user = (text: string): ChatItem => ({ kind: 'user', text, imageCount: 0, ts: 0 });
const said = (crew: any, text = 'x'): ChatItem => ({ kind: 'assistant', text, complete: true, ts: 0, crew });
const tool = (): ChatItem => ({ kind: 'tool', toolId: 't', name: 'Bash', detail: 'ls', done: true, ok: true, ts: 0 });
const verify = (passed: boolean): ChatItem => ({ kind: 'verify', report: { passed } as any, ts: 0 });

describe('chaptersOf — a job closes when its gates pass', () => {
  it('keeps an unverified thread as one open job', () => {
    const c = chaptersOf([user('Add a --json flag'), said(ollie), tool()]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ start: 0, end: 3, status: 'open', turns: 1 });
  });

  it('closes a job at a passing verify and opens the next after it', () => {
    const items = [user('Rename fmtAgo'), said(moss), verify(true), user('Odds model for the demo app'), said(juno)];
    const c = chaptersOf(items);
    expect(c.map((x) => [x.start, x.end, x.status])).toEqual([[0, 3, 'verified'], [3, 5, 'open']]);
  });

  it('does not close on a FAILED verify — the job needs work, it is not done', () => {
    const c = chaptersOf([user('Fix the flag'), said(ollie), verify(false), said(ollie)]);
    expect(c).toHaveLength(1);
    expect(c[0].status).toBe('needs-work');
  });

  it('lists everyone who spoke, once each, in order', () => {
    const c = chaptersOf([user('Add a --json flag'), said(ollie), said(juno), said(ollie), said(moss), verify(true)]);
    expect(c[0].crew.map((x) => x.name)).toEqual(['Ollie', 'Juno', 'Moss']);
    expect(c[0].turns).toBe(4);
  });

  it('never loses or duplicates an item — chapters tile the thread exactly', () => {
    const items = [user('a'), said(ollie), verify(true), user('b'), verify(true), user('c'), tool()];
    const c = chaptersOf(items);
    expect(c[0].start).toBe(0);
    for (let k = 1; k < c.length; k++) expect(c[k].start).toBe(c[k - 1].end);
    expect(c[c.length - 1].end).toBe(items.length);
  });

  it('returns nothing for an empty thread', () => {
    expect(chaptersOf([])).toEqual([]);
  });
});

describe('chapterName — named after the work, not the date', () => {
  it('drops the preamble and the leading verb', () => {
    expect(chapterName('Add a --json flag to the avatar generator')).toBe('--json flag to the avatar');
    expect(chapterName('Please can you rename fmtAgo to formatAgo')).toBe('fmtAgo to formatAgo');
    expect(chapterName("Let's build the odds model for the demo app")).toBe('odds model for the demo');
  });
  it('keeps the verb when it is all there is', () => {
    expect(chapterName('Refactor')).toBe('Refactor');
  });
  it('never leaves a row nameless', () => {
    expect(chapterName('')).toBe('Untitled job');
    expect(chapterName('   please  ')).toBe('Untitled job');
  });
});

describe('dayLabel — Today, Yesterday, a weekday, then a week', () => {
  const DAY = 86_400_000;
  const now = new Date(2026, 8, 24, 15, 0, 0).getTime(); // Thursday, 2026-09-24, 3pm local

  it('the same calendar day, however many hours apart, is Today', () => {
    expect(dayLabel(now, now)).toBe('Today');
    expect(dayLabel(new Date(2026, 8, 24, 0, 5).getTime(), now)).toBe('Today');
  });

  it('midnight-aligned: 11:58pm yesterday and 12:02am today are different days', () => {
    const lateYesterday = new Date(2026, 8, 23, 23, 58).getTime();
    expect(dayLabel(lateYesterday, now)).toBe('Yesterday');
  });

  it('a weekday name for 2–6 days back', () => {
    expect(dayLabel(now - 2 * DAY, now)).toBe('Tuesday');
    expect(dayLabel(now - 6 * DAY, now)).toBe('Friday');
  });

  it('a week label for 7+ days back, naming the Monday that starts that week', () => {
    const label = dayLabel(now - 10 * DAY, now);
    expect(label).toMatch(/^Week of /);
  });
});

describe('groupChaptersByDay — collapses consecutive same-bucket chapters, never reorders', () => {
  const DAY = 86_400_000;
  const now = new Date(2026, 8, 24, 15, 0, 0).getTime();
  const ch = (startedAt: number, name = 'x'): Chapter => ({ start: 0, end: 1, name, crew: [], turns: 1, status: 'verified', startedAt });

  it('one group when everything is the same day', () => {
    const groups = groupChaptersByDay([ch(now - 1000), ch(now - 500), ch(now)], now);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Today');
    expect(groups[0].chapters).toHaveLength(3);
  });

  it('a new group each time the bucket changes, in the original order', () => {
    const groups = groupChaptersByDay([ch(now - 2 * DAY, 'a'), ch(now - 1 * DAY, 'b'), ch(now, 'c')], now);
    expect(groups.map((g) => g.label)).toEqual(['Tuesday', 'Yesterday', 'Today']);
    expect(groups.map((g) => g.chapters[0].name)).toEqual(['a', 'b', 'c']);
  });

  it('two chapters in the same week, different days, still bucket into ONE week group', () => {
    const groups = groupChaptersByDay([ch(now - 8 * DAY, 'a'), ch(now - 9 * DAY, 'b')], now);
    expect(groups).toHaveLength(1);
    expect(groups[0].chapters.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('every group carries a stable key distinct from its label', () => {
    const groups = groupChaptersByDay([ch(now)], now);
    expect(groups[0].key).toBe('today');
  });
});

describe('where a job ends (item 31)', () => {
  const u = (text: string, ts: number) => ({ kind: 'user', text, imageCount: 0, ts }) as ChatItem;
  const a = (text: string, ts: number) => ({ kind: 'assistant', text, complete: true, ts }) as ChatItem;
  const failed = (ts: number) => ({ kind: 'verify', report: { passed: false, unverified: false, summary: '', gates: [], images: [], tampered: false }, ts }) as unknown as ChatItem;

  it('a failed verify no longer holds every later task in one job (the 2026-09-24 day)', () => {
    const items = [u('Fix the login bug', 0), a('Fixed.', 1), failed(2), u('Look at this screenshot', 3), a('I see six bars.', 4), u('Write up an md on the animations', 5), a('Written.', 6)];
    const ch = chaptersOf(items);
    expect(ch.map((c) => c.name)).toEqual(['login bug', 'this screenshot', 'up an md on the']);
    expect(ch[0].status).toBe('needs-work');
    expect(ch[1].status).toBe('open');
  });

  it('go-aheads, agreements and short questions stay in the job they answer', () => {
    const items = [u('Build the map screen', 0), a('Plan ready.', 1), u('Proceed', 2), a('Building.', 3), u('Are we stalled?', 4), a('No.', 5), u('I agree', 6), a('Done.', 7)];
    expect(chaptersOf(items)).toHaveLength(1);
  });

  it('a long quiet spell starts a new job even on a go-ahead', () => {
    const items = [u('Build the map', 0), a('Done.', 1), u('ok', 1 + 46 * 60_000), a('Sure.', 2 + 46 * 60_000)];
    expect(chaptersOf(items)).toHaveLength(2);
  });

  it('an ask that names nothing takes the next one that does, then the crew’s own line', () => {
    expect(chaptersOf([u('Bram proceed with the remaining', 0), a('Reworking the fold tile.', 1)])[0].name).toBe('Reworking the fold tile');
    expect(isWeakName(chapterName('Bram proceed with the remaining'))).toBe(true);
  });

  it('a job with no crew turn yet absorbs the next message instead of splitting', () => {
    expect(chaptersOf([u('Fix the header', 0), u('and the footer', 1), a('Both fixed.', 2)])).toHaveLength(1);
  });
});

describe('what comes after a passing check', () => {
  it('a note after the pass is the closed job\'s tail, not an empty new job', () => {
    const t = 1;
    const items: ChatItem[] = [
      { kind: 'user', text: 'Ship the settings sheet', imageCount: 0, ts: t },
      { kind: 'assistant', text: 'Done, and here is what changed.', complete: true, ts: t },
      { kind: 'verify', report: { passed: true, gates: [], summary: 'ok' } as any, ts: t },
      { kind: 'notice', text: 'Deployed at 11:34 AM: …', ts: t },
    ];
    const ch = chaptersOf(items);
    expect(ch).toHaveLength(1);
    expect(ch[0]).toMatchObject({ start: 0, end: 4, tail: 3, status: 'verified' });
    // a real new message still starts a new job
    const more = chaptersOf([...items, { kind: 'user', text: 'Next, the map', imageCount: 0, ts: t + 999_999 }, { kind: 'assistant', text: 'On it.', complete: true, ts: t + 999_999 }]);
    expect(more).toHaveLength(2);
    expect(more[1].start).toBe(4);
  });
});

import { chapterName as nameOf } from './chapters';
describe('a proceed is named after its task', () => {
  it('drops the button words', () => {
    expect(nameOf('▶ Proceed with the consulted plan: Add client prediction to the game')).toBe('client prediction to the game');
  });
});
