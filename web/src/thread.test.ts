import { describe, expect, it } from 'vitest';
import { contextWords, isNarration, modelName, modelWords } from './ChatView';
import type { ChatItem } from './types';

const u = (ts: number) => ({ kind: 'user', text: 'go', imageCount: 0, ts }) as ChatItem;
const a = (ts: number) => ({ kind: 'assistant', text: 'x', complete: true, ts }) as ChatItem;
const t = (ts: number) => ({ kind: 'tool', toolId: String(ts), name: 'Bash', detail: 'x', done: true, ok: true, ts }) as ChatItem;

describe('narration vs the reply (item 36)', () => {
  it('a line followed by more tool work before you speak is narration', () => {
    const items = [u(0), a(1), t(2), a(3)];
    expect(isNarration(items, 1, items.length)).toBe(true);
  });
  it("the turn's last word is the reply", () => {
    const items = [u(0), a(1), t(2), a(3)];
    expect(isNarration(items, 3, items.length)).toBe(false);
  });
  it('your next message ends the turn: nothing after it counts', () => {
    const items = [u(0), a(1), u(2), t(3)];
    expect(isNarration(items, 1, items.length)).toBe(false);
  });
});

describe('models in words (item 36)', () => {
  it('reads ids the way a person says them', () => {
    expect(modelWords('claude-opus-5-5[1m]')).toBe('Opus 5.5 1M');
    expect(modelWords('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(modelWords('gpt-5.6-sol')).toBe('GPT-5.6 Sol');
    expect(modelWords('sonnet')).toBe('Sonnet');
    expect(modelWords('')).toBe('model not reported');
  });
});

import { apply } from './useSession';
describe('a question arrives as a text and is answered in place', () => {
  it('adds one question item, and marks it answered with what you said', () => {
    let items = apply([], { type: 'question', requestId: 'q', questions: [{ question: 'Which?', options: [] }], ts: 1 } as any);
    items = apply(items, { type: 'question', requestId: 'q', questions: [{ question: 'Which?', options: [] }], ts: 1 } as any);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'question', answered: false });
    items = apply(items, { type: 'question_answered', requestId: 'q', answers: { 'Which?': 'That one' }, ts: 2 } as any);
    expect(items[0]).toMatchObject({ answered: true, answers: { 'Which?': 'That one' } });
  });
});

describe('model names are the model and its version', () => {
  it('drops the dashes, the date and the context bracket', () => {
    expect(modelName('claude-opus-5-5[1m]')).toBe('Opus 5.5');
    expect(modelName('claude-sonnet-5')).toBe('Sonnet 5');
    expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(modelName('gpt-6-astra')).toBe('GPT-6 Astra');
  });
  it('the context size is its own detail, and only when the id says it', () => {
    expect(contextWords('opus[1m]')).toBe('1M context');
    expect(contextWords('claude-sonnet-5')).toBeNull();
  });
});
