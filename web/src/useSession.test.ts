import { describe, expect, it } from 'vitest';
import { apply } from './useSession';
import type { ChatItem, CrewInfo } from './types';

/** The chat reducer is pure, so it is the first thing in the web workspace to
 *  get a test. Everything the phone shows in a conversation goes through it. */
const ts = 1;
const sunny: CrewInfo = { name: 'Sunny', role: 'chat', roleLabel: 'Chat', tier: 'flagship', color: '#673eb4', initial: 'S', agent: 'claude', model: 'sonnet' };

describe('chat reducer', () => {
  it('folds deltas into one draft and completes it in place, keeping the crew badge', () => {
    let items: ChatItem[] = [];
    items = apply(items, { type: 'assistant_delta', delta: 'Hel', ts });
    items = apply(items, { type: 'assistant_delta', delta: 'lo', ts });
    items = apply(items, { type: 'assistant_message', text: 'Hello', crew: sunny, ts });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'assistant', text: 'Hello', complete: true });
    expect((items[0] as Extract<ChatItem, { kind: 'assistant' }>).crew?.name).toBe('Sunny');
  });

  it('starts a new draft after a user message rather than appending to the last reply', () => {
    let items: ChatItem[] = [];
    items = apply(items, { type: 'assistant_message', text: 'first', ts });
    items = apply(items, { type: 'user_message', text: 'again', imageCount: 0, ts });
    items = apply(items, { type: 'assistant_delta', delta: 'sec', ts });
    expect(items.map((i) => i.kind)).toEqual(['assistant', 'user', 'assistant']);
  });

  it('appends a completed message when no draft is open', () => {
    let items: ChatItem[] = [];
    items = apply(items, { type: 'assistant_message', text: 'one', ts });
    items = apply(items, { type: 'assistant_message', text: 'two', ts });
    expect(items).toHaveLength(2);
  });
});
