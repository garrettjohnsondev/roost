import { useEffect, useRef, useState } from 'react';
import { SessionSocket } from './api';
import type { ChatItem, ClientMessage, ServerEvent, SessionMeta, UsageInfo, ContextInfo } from './types';

export interface SessionState {
  items: ChatItem[];
  /** Items before this index are replayed history; see SessionCore. */
  replayedCount: number;
  /** When this phone opened the session. Sleeping on idle counts its quiet
   *  from here or the last item, whichever is later: the crew wake when you
   *  arrive, and drift off only after a quiet spell you were present for. */
  openedAt: number;
  meta: SessionMeta | null;
  status: 'idle' | 'working' | 'connecting' | 'error';
  connected: boolean;
  usage: UsageInfo | null;
  pendingApproval: { requestId: string; title: string; detail: string } | null;
  /** How many approvals are waiting in total; the bar shows the first. */
  pendingApprovalCount: number;
  /** Set once the server tells us this session is gone for good (closed or idle-expired) —
   *  further reconnect attempts would be pointless, so the UI should offer a way back out. */
  closedReason: string | null;
  /** Free-text detail attached to the latest status event (e.g. consult progress). */
  statusMessage: string | null;
  /** Auto mode only: Pip is deciding who takes the message. Set LOCALLY the
   *  instant ↑ is tapped -- before any round trip -- because triage is a real
   *  model call and waiting on the server for the first sign of life is the
   *  delay that was reported. Cleared by the first event that says routing is
   *  over; see endsTriage. */
  triaging: boolean;
  context: ContextInfo | null;
  /** false when the socket is not open -- the caller keeps the draft. */
  send: (msg: ClientMessage) => boolean;
}

export function apply(items: ChatItem[], event: ServerEvent): ChatItem[] {
  const next = [...items];
  const last = next[next.length - 1];
  switch (event.type) {
    case 'user_message': {
      // Your message was already on screen, pending, from the moment you sent
      // it; the Mac's copy confirms it in place rather than appearing again.
      // Matched by text, else the oldest pending one (the server may reword).
      const i = next.findIndex((x) => x.kind === 'user' && x.pending && x.text === event.text);
      const j = i >= 0 ? i : next.findIndex((x) => x.kind === 'user' && x.pending);
      if (j >= 0) next[j] = { kind: 'user', text: event.text, imageCount: event.imageCount, ts: event.ts };
      else next.push({ kind: 'user', text: event.text, imageCount: event.imageCount, ts: event.ts });
      break;
    }
    case 'assistant_delta':
      if (last?.kind === 'assistant' && !last.complete) {
        next[next.length - 1] = { ...last, text: last.text + event.delta };
      } else {
        next.push({ kind: 'assistant', text: event.delta, complete: false, ts: event.ts, crew: event.crew });
      }
      break;
    case 'assistant_message': {
      const draftIndex = next.findLastIndex((i) => i.kind === 'assistant' && !i.complete);
      if (draftIndex >= 0) {
        const draft = next[draftIndex] as Extract<ChatItem, { kind: 'assistant' }>;
        next[draftIndex] = { kind: 'assistant', text: event.text, complete: true, ts: event.ts, crew: event.crew ?? draft.crew };
      } else {
        next.push({ kind: 'assistant', text: event.text, complete: true, ts: event.ts, crew: event.crew });
      }
      break;
    }
    case 'thinking_delta':
      if (last?.kind === 'thinking' && last.open) {
        next[next.length - 1] = { ...last, text: (last.text + event.delta).slice(-4000) };
      } else {
        next.push({ kind: 'thinking', text: event.delta, open: true, ts: event.ts });
      }
      break;
    case 'tool_start':
      // Close any open thinking bubble once real work starts.
      for (let i = 0; i < next.length; i++) {
        const item = next[i];
        if (item.kind === 'thinking' && item.open) next[i] = { ...item, open: false };
      }
      next.push({ kind: 'tool', toolId: event.toolId, name: event.name, detail: event.detail, expand: event.expand, done: false, ts: event.ts });
      break;
    case 'tool_end': {
      const i = next.findLastIndex((item) => item.kind === 'tool' && item.toolId === event.toolId);
      if (i >= 0) {
        const tool = next[i] as Extract<ChatItem, { kind: 'tool' }>;
        next[i] = { ...tool, done: true, ok: event.ok, endDetail: event.detail };
      }
      break;
    }
    case 'question':
      if (!next.some((it) => it.kind === 'question' && it.requestId === event.requestId)) {
        next.push({ kind: 'question', requestId: event.requestId, questions: event.questions, crew: event.crew, answered: false, answers: null, ts: event.ts });
      }
      break;
    case 'question_answered': {
      const i = next.findLastIndex((it) => it.kind === 'question' && it.requestId === event.requestId);
      if (i >= 0) next[i] = { ...(next[i] as Extract<ChatItem, { kind: 'question' }>), answered: true, answers: event.answers };
      break;
    }
    case 'approval_request':
      next.push({ kind: 'approval', requestId: event.requestId, title: event.title, detail: event.detail, words: event.words, crew: event.crew, ts: event.ts });
      break;
    case 'approval_resolved': {
      const i = next.findLastIndex((item) => item.kind === 'approval' && item.requestId === event.requestId);
      if (i >= 0) next[i] = { ...(next[i] as Extract<ChatItem, { kind: 'approval' }>), decision: event.decision };
      break;
    }
    case 'routed':
      next.push({ kind: 'routed', model: event.model, tier: event.tier, reason: event.reason, crew: event.crew, worker: event.worker, ts: event.ts });
      break;
    case 'consult':
      next.push({ kind: 'consult', phase: event.phase, agent: event.agent, crew: event.crew, from: event.from, reviewStrength: event.reviewStrength, text: event.text, ts: event.ts });
      break;
    case 'milestone':
      next.push({ kind: 'milestone', crew: event.crew, label: event.label, detail: event.detail, level: event.level, ts: event.ts });
      break;
    case 'verify':
      next.push({ kind: 'verify', report: event.report, ts: event.ts });
      break;
    case 'error':
      next.push({ kind: 'error', text: event.message, code: event.code, ts: event.ts });
      break;
    case 'notice':
      next.push({ kind: 'notice', text: event.text, ts: event.ts });
      break;
  }
  return next;
}

/** Whether an event means Pip has handed off. An allowlist, not a catch-all:
 *  usage and context churn arrive mid-triage and must not clear Pip early, and
 *  Pip's own "picking who takes this" status must not clear itself.
 *
 *  - routed: the model changed, and the event names the worker.
 *  - a working status from anyone but the dispatcher: the engine started the
 *    turn. This is the hand-off when routing kept the same model, since
 *    `routed` only fires on a change.
 *  - any non-working status: the turn ended or failed; nobody is picking.
 *  - reply text or a tool: work is visibly under way.
 *  - replay: a reconnect brings authoritative state; live events follow. */
export function endsTriage(event: ServerEvent): boolean {
  switch (event.type) {
    case 'routed':
    case 'assistant_delta':
    case 'assistant_message':
    case 'tool_start':
    case 'replay':
      return true;
    case 'status':
      return event.state !== 'working' || event.crew?.role !== 'dispatcher';
    default:
      return false;
  }
}

export interface SessionCore {
  items: ChatItem[];
  meta: SessionMeta | null;
  status: SessionState['status'];
  statusMessage: string | null;
  usage: UsageInfo | null;
  approvals: Array<NonNullable<SessionState['pendingApproval']>>;
  /** The engine's own context window, as last reported. null = no data. */
  context: ContextInfo | null;
  /** How many items the last replay produced. Items at or past this index
   *  arrived LIVE; the ones before it are history rebuilt when the session was
   *  opened. Motion keys off this, never off timestamps: a stamp or a cheer
   *  replaying for every past verify the moment you open a session would be
   *  motion reporting yesterday, and the phone's clock and the Mac's need not
   *  agree closely enough for a time window to tell the two apart. */
  replayedCount: number;
  openedAt: number;
}

export function initialCore(): SessionCore {
  return { items: [], meta: null, status: 'connecting', statusMessage: null, usage: null, approvals: [], context: null, replayedCount: 0, openedAt: Date.now() };
}

/** Everything the phone shows for a session, as a pure function of the events
 *  it has received. Pure so it can be tested without a DOM -- and so a session
 *  switch is exactly `initialCore()`, which is how the previous chat's usage
 *  and status stopped leaking under the next chat's title. */
export function reduceSessionEvent(prev: SessionCore, event: ServerEvent): SessionCore {
  switch (event.type) {
    case 'replay': {
      const resolved = new Set(event.events.filter((e) => e.type === 'approval_resolved').map((e: any) => e.requestId));
      let items: ChatItem[] = [];
      let usage: UsageInfo | null = null;
      let context: ContextInfo | null = null;
      let status = prev.status;
      let statusMessage: string | null = null;
      const approvals: SessionCore['approvals'] = [];
      for (const e of event.events) {
        items = apply(items, e);
        if (e.type === 'approval_request' && !resolved.has(e.requestId)) {
          approvals.push({ requestId: e.requestId, title: e.title, detail: e.detail });
        }
        if (e.type === 'usage') usage = e.usage;
        if (e.type === 'context') context = e.context;
        if (e.type === 'status') {
          status = e.state;
          statusMessage = e.message ?? null;
        }
      }
      return { items, meta: event.meta, status, statusMessage, usage, approvals, context, replayedCount: items.length, openedAt: prev.openedAt };
    }
    case 'session_meta':
      return { ...prev, meta: event.meta };
    case 'usage':
      return { ...prev, usage: event.usage };
    case 'context':
      // Emitted after every Claude turn and every Codex usage update. It went
      // to the item reducer's default case and was dropped on the floor.
      return { ...prev, context: event.context };
    case 'status':
      return { ...prev, status: event.state, statusMessage: event.message ?? null };
    case 'routed':
      // Pip has handed off. The status line at this moment is his "picking who
      // takes this", and left in place it would sit under the worker's face
      // until the engine's own status replaced it.
      return { ...prev, statusMessage: null, items: apply(prev.items, event) };
    case 'approval_request': {
      // A queue, not a slot: two concurrent requests used to strand the first.
      const approvals = prev.approvals.some((a) => a.requestId === event.requestId)
        ? prev.approvals
        : [...prev.approvals, { requestId: event.requestId, title: event.title, detail: event.detail }];
      return { ...prev, approvals, items: apply(prev.items, event) };
    }
    case 'approval_resolved':
      return { ...prev, approvals: prev.approvals.filter((a) => a.requestId !== event.requestId), items: apply(prev.items, event) };
    default:
      return { ...prev, items: apply(prev.items, event) };
  }
}

export function useSession(sessionId: string | null): SessionState {
  const [core, setCore] = useState<SessionCore>(initialCore);
  const [connected, setConnected] = useState(false);
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [triaging, setTriaging] = useState(false);
  const socketRef = useRef<SessionSocket | null>(null);

  useEffect(() => {
    // No id: a fixture is being rendered, so there is nothing to connect to.
    if (!sessionId) return;
    setClosedReason(null);
    setCore(initialCore());
    setTriaging(false);
    const handle = (event: ServerEvent) => {
      setCore((prev) => reduceSessionEvent(prev, event));
      if (endsTriage(event)) setTriaging(false);
    };
    const socket = new SessionSocket(sessionId, handle, setConnected, setClosedReason);
    socketRef.current = socket;
    return () => socket.close();
  }, [sessionId]);

  return {
    items: core.items,
    meta: core.meta,
    status: core.status,
    connected,
    usage: core.usage,
    pendingApproval: core.approvals[0] ?? null,
    pendingApprovalCount: core.approvals.length,
    closedReason,
    statusMessage: core.statusMessage,
    triaging,
    context: core.context,
    replayedCount: core.replayedCount,
    openedAt: core.openedAt,
    send: (msg) => {
      const sent = socketRef.current?.send(msg) ?? false;
      // "A slight delay, then boom, my message goes" (2026-09-28): it shows the
      // instant it's sent, dimmed until the Mac's copy confirms it.
      if (sent && msg.type === 'user_message' && typeof msg.text === 'string' && msg.text.trim()) {
        setCore((prev) => ({ ...prev, items: [...prev.items, { kind: 'user', text: msg.text, imageCount: Array.isArray(msg.images) ? msg.images.length : 0, ts: Date.now(), pending: true }] }));
      }
      // Only a message that actually went out starts a triage; a send while
      // disconnected keeps the draft and must not put Pip on stage for nothing.
      if (sent && msg.type === 'user_message' && core.meta?.mode === 'auto') setTriaging(true);
      return sent;
    },
  };
}
