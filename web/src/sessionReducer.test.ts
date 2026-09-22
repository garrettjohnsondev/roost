import { describe, expect, it } from 'vitest';
import { initialCore, reduceSessionEvent } from './useSession';
import type { ServerEvent, SessionMeta } from './types';

const ts = 1;
const meta = { id: 's1', agent: 'claude', cwd: '/p', title: 't', model: 'sonnet', effort: '', approvals: 'ask', createdAt: 0, updatedAt: 0, state: 'idle' } as unknown as SessionMeta;
const reduce = (events: ServerEvent[]) => events.reduce(reduceSessionEvent, initialCore());

describe('session reducer', () => {
  it('starts with nothing, which is exactly what a session switch shows', () => {
    const c = initialCore();
    expect(c.usage).toBeNull();
    expect(c.statusMessage).toBeNull();
    expect(c.approvals).toEqual([]);
    expect(c.items).toEqual([]);
  });

  it('tracks usage, status and its message', () => {
    const c = reduce([
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 }, ts },
      { type: 'status', state: 'working', message: 'Sunny is drafting a plan…', ts },
    ]);
    expect(c.usage).toEqual({ inputTokens: 10, outputTokens: 2 });
    expect(c.status).toBe('working');
    expect(c.statusMessage).toBe('Sunny is drafting a plan…');
    expect(reduceSessionEvent(c, { type: 'status', state: 'idle', ts }).statusMessage).toBeNull();
  });

  it('queues concurrent approvals, dedupes, and resolves by id', () => {
    let c = reduce([
      { type: 'approval_request', requestId: 'a', title: 'Run a command', detail: 'ls', ts },
      { type: 'approval_request', requestId: 'b', title: 'Edit a file', detail: 'x.ts', ts },
      { type: 'approval_request', requestId: 'a', title: 'Run a command', detail: 'ls', ts },
    ]);
    expect(c.approvals.map((a) => a.requestId)).toEqual(['a', 'b']);
    c = reduceSessionEvent(c, { type: 'approval_resolved', requestId: 'a', decision: 'allow', ts });
    // The second request is still answerable -- it used to be stranded.
    expect(c.approvals.map((a) => a.requestId)).toEqual(['b']);
  });

  it('rebuilds everything from a replay, including only the unresolved approvals', () => {
    const c = reduceSessionEvent(initialCore(), {
      type: 'replay',
      meta,
      events: [
        { type: 'user_message', text: 'hi', imageCount: 0, ts },
        { type: 'assistant_message', text: 'hello', ts },
        { type: 'approval_request', requestId: 'old', title: 'x', detail: '', ts },
        { type: 'approval_resolved', requestId: 'old', decision: 'deny', ts },
        { type: 'approval_request', requestId: 'open', title: 'y', detail: '', ts },
        { type: 'usage', usage: { inputTokens: 5, outputTokens: 1 }, ts },
        { type: 'status', state: 'idle', ts },
      ],
    } as ServerEvent);
    expect(c.meta?.id).toBe('s1');
    expect(c.items.map((i) => i.kind)).toEqual(['user', 'assistant', 'approval', 'approval']);
    expect(c.approvals.map((a) => a.requestId)).toEqual(['open']);
    expect(c.usage?.inputTokens).toBe(5);
    expect(c.status).toBe('idle');
  });
});
