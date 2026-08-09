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
  send: (msg: ClientMessage) => void;
}

function apply(items: ChatItem[], event: ServerEvent): ChatItem[] {
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
        next.push({ kind: 'assistant', text: event.delta, complete: false, ts: event.ts });
      }
      break;
    case 'assistant_message': {
      const draftIndex = next.findLastIndex((i) => i.kind === 'assistant' && !i.complete);
      if (draftIndex >= 0) next[draftIndex] = { kind: 'assistant', text: event.text, complete: true, ts: event.ts };
      else next.push({ kind: 'assistant', text: event.text, complete: true, ts: event.ts });
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
      next.push({ kind: 'tool', toolId: event.toolId, name: event.name, detail: event.detail, done: false, ts: event.ts });
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
  const [pendingApproval, setPendingApproval] = useState<SessionState['pendingApproval']>(null);
  const socketRef = useRef<SessionSocket | null>(null);

  useEffect(() => {
    const handle = (event: ServerEvent) => {
      switch (event.type) {
        case 'replay': {
          setMeta(event.meta);
          let rebuilt: ChatItem[] = [];
          let lastApproval: SessionState['pendingApproval'] = null;
          const resolved = new Set(
            event.events.filter((e) => e.type === 'approval_resolved').map((e: any) => e.requestId),
          );
          for (const e of event.events) {
            rebuilt = apply(rebuilt, e);
            if (e.type === 'approval_request' && !resolved.has(e.requestId)) {
              lastApproval = { requestId: e.requestId, title: e.title, detail: e.detail };
            }
            if (e.type === 'usage') setUsage(e.usage);
            if (e.type === 'status') setStatus(e.state);
          }
          setItems(rebuilt);
          setPendingApproval(lastApproval);
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
          break;
        case 'approval_request':
          setPendingApproval({ requestId: event.requestId, title: event.title, detail: event.detail });
          setItems((prev) => apply(prev, event));
          break;
        case 'approval_resolved':
          setPendingApproval((prev) => (prev?.requestId === event.requestId ? null : prev));
          setItems((prev) => apply(prev, event));
          break;
        default:
          setItems((prev) => apply(prev, event));
      }
    };
    const socket = new SessionSocket(sessionId, handle, setConnected);
    socketRef.current = socket;
    return () => socket.close();
  }, [sessionId]);

  return {
    items,
    meta,
    status,
    connected,
    usage,
    pendingApproval,
    send: (msg) => socketRef.current?.send(msg),
  };
}
