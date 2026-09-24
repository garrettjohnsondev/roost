import { describe, expect, it } from 'vitest';
import { apply, endsTriage, initialCore, reduceSessionEvent } from './useSession';
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

const pip: CrewInfo = { name: 'Pip', role: 'dispatcher', roleLabel: 'Dispatch', tier: 'worker', color: '#c9803a', initial: 'P', sprite: 'pip', agent: 'claude', model: '' };
const moss: CrewInfo = { name: 'Moss', role: 'chat', roleLabel: 'Chat', tier: 'worker', color: '#205a1d', initial: 'M', sprite: 'moss', agent: 'claude', model: 'claude-haiku-4-5' };

describe('the routed turn names who got the work', () => {
  it('carries the worker onto the chat item, not just the model id', () => {
    const items = apply([], { type: 'routed', model: 'claude-haiku-4-5', tier: 'light', reason: 'small', crew: pip, worker: moss, ts });
    expect(items[0]).toMatchObject({ kind: 'routed', worker: { name: 'Moss', sprite: 'moss' } });
  });

  it("clears Pip's status line when he hands off, so it never sits under the worker", () => {
    let core = reduceSessionEvent(initialCore(), { type: 'status', state: 'working', message: 'Pip is picking who takes this…', crew: pip, ts });
    expect(core.statusMessage).toBe('Pip is picking who takes this…');
    core = reduceSessionEvent(core, { type: 'routed', model: 'claude-haiku-4-5', tier: 'light', reason: 'small', crew: pip, worker: moss, ts });
    expect(core.statusMessage).toBeNull();
    expect(core.items.at(-1)).toMatchObject({ kind: 'routed' });
  });
});

describe('Pip holds the stage until routing is actually over', () => {
  it("does not end on Pip's own picking status, or on meter churn", () => {
    expect(endsTriage({ type: 'status', state: 'working', message: 'Pip is picking who takes this…', crew: pip, ts })).toBe(false);
    expect(endsTriage({ type: 'usage', usage: { inputTokens: 1, outputTokens: 1 }, ts })).toBe(false);
    expect(endsTriage({ type: 'user_message', text: 'hi', imageCount: 0, ts })).toBe(false);
  });

  it('hands off on a route, on the engine starting, or on visible work', () => {
    expect(endsTriage({ type: 'routed', model: 'm', tier: 'light', reason: '', worker: moss, ts })).toBe(true);
    // Same model kept: no `routed` fires, so the engine's own status is the hand-off.
    expect(endsTriage({ type: 'status', state: 'working', ts })).toBe(true);
    expect(endsTriage({ type: 'assistant_delta', delta: 'x', ts })).toBe(true);
    expect(endsTriage({ type: 'tool_start', toolId: 't', name: 'Bash', detail: '', ts })).toBe(true);
  });

  it('ends when the turn ends or fails, so Pip is never stranded', () => {
    expect(endsTriage({ type: 'status', state: 'idle', ts })).toBe(true);
    expect(endsTriage({ type: 'status', state: 'error', message: 'boom', ts })).toBe(true);
  });
});
