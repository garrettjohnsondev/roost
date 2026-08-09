import type { ClientMessage, PocketConfigResponse, ServerEvent, SessionMeta } from './types';

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
  createSession: (body: { agent: string; cwd: string; model?: string }) =>
    request<{ session: SessionMeta }>('/api/sessions', { method: 'POST', body: JSON.stringify(body) }),
  closeSession: (id: string) => request<{ closed: boolean }>(`/api/sessions/${id}`, { method: 'DELETE' }),
};

/** WebSocket wrapper with automatic reconnect; the server replays history on each attach. */
export class SessionSocket {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private retryMs = 1000;

  constructor(
    private sessionId: string,
    private onEvent: (event: ServerEvent) => void,
    private onConnectionChange: (connected: boolean) => void,
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
    this.ws.onclose = () => {
      this.onConnectionChange(false);
      if (!this.closedByUser) {
        setTimeout(() => this.connect(), this.retryMs);
        this.retryMs = Math.min(this.retryMs * 2, 15000);
      }
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
