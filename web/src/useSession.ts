import { useEffect, useRef, useState } from 'react';
import { SessionSocket } from './api';
import type { ChatItem, ClientMessage, ServerEvent, SessionMeta, UsageInfo } from './types';

export interface SessionState {
  items: ChatItem[];
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
      next.push({ kind: 'routed', model: event.model, tier: event.tier, reason: event.reason, ts: event.ts });
      break;
    case 'consult':
      next.push({ kind: 'consult', phase: event.phase, agent: event.agent, crew: event.crew, reviewStrength: event.reviewStrength, text: event.text, ts: event.ts });
      break;
    case 'error':
      next.push({ kind: 'error', text: event.message, ts: event.ts });
      break;
  }
  return next;
}

export function useSession(sessionId: string): SessionState {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [status, setStatus] = useState<SessionState['status']>('connecting');
  const [connected, setConnected] = useState(false);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  // A queue, not a slot: two concurrent requests used to strand the first one
  // with no way to answer it.
  const [approvals, setApprovals] = useState<Array<NonNullable<SessionState['pendingApproval']>>>([]);
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const socketRef = useRef<SessionSocket | null>(null);

  useEffect(() => {
    // Everything below is per-session. Leaving the previous session's usage,
    // status and approval in place until the replay arrived showed one chat's
    // numbers under another chat's title.
    setClosedReason(null);
    setUsage(null);
    setStatusMessage(null);
    setApprovals([]);
    setItems([]);
    const handle = (event: ServerEvent) => {
      switch (event.type) {
        case 'replay': {
          setMeta(event.meta);
          let rebuilt: ChatItem[] = [];
          const open: Array<NonNullable<SessionState['pendingApproval']>> = [];
          const resolved = new Set(
            event.events.filter((e) => e.type === 'approval_resolved').map((e: any) => e.requestId),
          );
          for (const e of event.events) {
            rebuilt = apply(rebuilt, e);
            if (e.type === 'approval_request' && !resolved.has(e.requestId)) {
              open.push({ requestId: e.requestId, title: e.title, detail: e.detail });
            }
            if (e.type === 'usage') setUsage(e.usage);
            if (e.type === 'status') setStatus(e.state);
          }
          setItems(rebuilt);
          setApprovals(open);
          break;
        }
        case 'session_meta':
          setMeta(event.meta);
          break;
        case 'usage':
          setUsage(event.usage);
          break;
        case 'status':
          setStatus(event.state);
          setStatusMessage(event.message ?? null);
          break;
        case 'approval_request':
          setApprovals((q) => (q.some((a) => a.requestId === event.requestId) ? q : [...q, { requestId: event.requestId, title: event.title, detail: event.detail }]));
          setItems((prev) => apply(prev, event));
          break;
        case 'approval_resolved':
          setApprovals((q) => q.filter((a) => a.requestId !== event.requestId));
          setItems((prev) => apply(prev, event));
          break;
        default:
          setItems((prev) => apply(prev, event));
      }
    };
    const socket = new SessionSocket(sessionId, handle, setConnected, setClosedReason);
    socketRef.current = socket;
    return () => socket.close();
  }, [sessionId]);

  return {
    items,
    meta,
    status,
    connected,
    usage,
    pendingApproval: approvals[0] ?? null,
    pendingApprovalCount: approvals.length,
    closedReason,
    statusMessage,
    send: (msg) => socketRef.current?.send(msg) ?? false,
  };
}
