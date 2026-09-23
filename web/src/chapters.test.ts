import { describe, expect, it } from 'vitest';
import { chaptersOf, chapterName } from './chapters';
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
    expect(chapterName("Let's build the odds model for the demo app")).toBe('odds model for the bet');
  });
  it('keeps the verb when it is all there is', () => {
    expect(chapterName('Refactor')).toBe('Refactor');
  });
  it('never leaves a row nameless', () => {
    expect(chapterName('')).toBe('Untitled job');
    expect(chapterName('   please  ')).toBe('Untitled job');
  });
});
