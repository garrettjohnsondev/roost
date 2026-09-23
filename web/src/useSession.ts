import { useEffect, useRef, useState } from 'react';
import { SessionSocket } from './api';
import type { ChatItem, ClientMessage, ServerEvent, SessionMeta, UsageInfo, ContextInfo } from './types';

export interface SessionState {
  items: ChatItem[];
  /** Items before this index are replayed history; see SessionCore. */
  replayedCount: number;
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
  context: ContextInfo | null;
  /** false when the socket is not open -- the caller keeps the draft. */
  send: (msg: ClientMessage) => boolean;
}

export function apply(items: ChatItem[], event: ServerEvent): ChatItem[] {
  const next = [...items];
  const last = next[next.length - 1];
  switch (event.type) {
    case 'user_message':
      next.push({ kind: 'user', text: event.text, imageCount: event.imageCount, ts: event.ts });
      break;
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
    case 'approval_request':
      next.push({ kind: 'approval', requestId: event.requestId, title: event.title, detail: event.detail, ts: event.ts });
      break;
    case 'approval_resolved': {
      const i = next.findLastIndex((item) => item.kind === 'approval' && item.requestId === event.requestId);
      if (i >= 0) next[i] = { ...(next[i] as Extract<ChatItem, { kind: 'approval' }>), decision: event.decision };
      break;
    }
    case 'routed':
      next.push({ kind: 'routed', model: event.model, tier: event.tier, reason: event.reason, crew: event.crew, ts: event.ts });
      break;
    case 'consult':
      next.push({ kind: 'consult', phase: event.phase, agent: event.agent, crew: event.crew, reviewStrength: event.reviewStrength, text: event.text, ts: event.ts });
      break;
    case 'verify':
      next.push({ kind: 'verify', report: event.report, ts: event.ts });
      break;
    case 'error':
      next.push({ kind: 'error', text: event.message, ts: event.ts });
      break;
  }
  return next;
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
}

export function initialCore(): SessionCore {
  return { items: [], meta: null, status: 'connecting', statusMessage: null, usage: null, approvals: [], context: null, replayedCount: 0 };
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
      return { items, meta: event.meta, status, statusMessage, usage, approvals, context, replayedCount: items.length };
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
  const socketRef = useRef<SessionSocket | null>(null);

  useEffect(() => {
    // No id: a fixture is being rendered, so there is nothing to connect to.
    if (!sessionId) return;
    setClosedReason(null);
    setCore(initialCore());
    const handle = (event: ServerEvent) => setCore((prev) => reduceSessionEvent(prev, event));
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
    context: core.context,
    replayedCount: core.replayedCount,
    send: (msg) => socketRef.current?.send(msg) ?? false,
  };
}
