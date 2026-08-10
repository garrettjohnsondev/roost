import type { ClientMessage, PocketConfigResponse, RecentProject, ServerEvent, SessionMeta, UsageSnapshot } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  config: () => request<PocketConfigResponse>('/api/config'),
  sessions: () => request<{ sessions: SessionMeta[] }>('/api/sessions'),
  createSession: (body: { agent: string; cwd: string; model?: string; resume?: string; title?: string }) =>
    request<{ session: SessionMeta }>('/api/sessions', { method: 'POST', body: JSON.stringify(body) }),
  browse: (path?: string) =>
    request<{
      path: string;
      parent: string | null;
      dirs: Array<{ name: string; path: string; isRepo: boolean }>;
      shortcuts: Array<{ name: string; path: string }>;
    }>(`/api/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  addProject: (path: string) =>
    request<{ projects: string[] }>('/api/projects', { method: 'POST', body: JSON.stringify({ path }) }),
  resumable: (agent: string, cwd: string) =>
    request<{ sessions: Array<{ id: string; title: string; updatedAt: number }> }>(
      `/api/resumable?agent=${encodeURIComponent(agent)}&cwd=${encodeURIComponent(cwd)}`,
    ),
  closeSession: (id: string) => request<{ closed: boolean }>(`/api/sessions/${id}`, { method: 'DELETE' }),
  removeProject: (path: string) =>
    request<{ projects: string[] }>(`/api/projects?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
  recent: () => request<{ projects: RecentProject[] }>('/api/recent'),
  usage: () => request<{ usage: UsageSnapshot | null }>('/api/usage'),
  refreshUsage: () => request<{ usage: UsageSnapshot }>('/api/usage/refresh', { method: 'POST' }),
};

// Close codes the server uses for a session that is gone for good — reconnecting would
// just hit the same wall forever, so these stop the retry loop instead of spinning on it.
const TERMINAL_CLOSE_CODES = new Set([4004, 4010]);

/** WebSocket wrapper with automatic reconnect; the server replays history on each attach. */
export class SessionSocket {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private retryMs = 1000;

  constructor(
    private sessionId: string,
    private onEvent: (event: ServerEvent) => void,
    private onConnectionChange: (connected: boolean) => void,
    private onSessionGone: (reason: string) => void,
  ) {
    this.connect();
  }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws?session=${this.sessionId}`);
    this.ws.onopen = () => {
      this.retryMs = 1000;
      this.onConnectionChange(true);
    };
    this.ws.onmessage = (e) => {
      try {
        this.onEvent(JSON.parse(e.data));
      } catch {
        /* ignore malformed frames */
      }
    };
    this.ws.onclose = (e) => {
      this.onConnectionChange(false);
      if (this.closedByUser) return;
      if (TERMINAL_CLOSE_CODES.has(e.code)) {
        this.closedByUser = true; // stop retrying — the session itself is gone
        this.onSessionGone(e.reason || 'This session was closed.');
        return;
      }
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 15000);
    };
  }

  send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.closedByUser = true;
    this.ws?.close();
  }
}
