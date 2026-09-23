import type {
  ClientMessage,
  GitStatusResult,
  RoostConfigResponse,
  PreviewResult,
  RecentProject,
  ServerEvent,
  SessionMeta,
  UsageSnapshot,
  Persona,
  DecisionsSummary,
  WeightEstimate,
  ModelsResponse,
} from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    // The server answers errors as {error: string}; show that text, not the
    // raw JSON envelope.
    const body = await res.text();
    let message = body;
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed.error === 'string') message = parsed.error;
    } catch {
      /* not JSON */
    }
    throw new Error(message ? `${res.status}: ${message}` : `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  config: () => request<RoostConfigResponse>('/api/config'),
  sessions: () => request<{ sessions: SessionMeta[] }>('/api/sessions'),
  crew: () => request<{ crew: Persona[]; overrides: Persona[] }>('/api/crew'),
  saveCrew: (overrides: Persona[]) =>
    request<{ ok: true; crew: Persona[] }>('/api/crew', { method: 'POST', body: JSON.stringify({ overrides }) }),
  weights: () => request<{ estimates: WeightEstimate[] }>('/api/weights'),
  models: () => request<ModelsResponse>('/api/models'),
  refreshModels: () => request<{ ok: true; changes: unknown[] }>('/api/models/refresh', { method: 'POST', body: '{}' }),
  assignModel: (agent: string, tier: string, model: string) =>
    request<{ ok: true; note: string }>('/api/models/assign', { method: 'POST', body: JSON.stringify({ agent, tier, model }) }),
  decisions: () => request<{ summary: DecisionsSummary; recent: unknown[] }>('/api/decisions'),
  avatars: () => request<{ custom: Array<{ file: string; url: string; at: number }> }>('/api/avatars'),
  generateAvatar: (subject: string, color: string) =>
    request<{ ok: true; file: string; url: string }>('/api/avatars/generate', {
      method: 'POST',
      body: JSON.stringify({ subject, color }),
    }),
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
  preview: (agent: string, cwd: string, id: string) =>
    request<{ preview: PreviewResult }>(
      `/api/preview?agent=${encodeURIComponent(agent)}&cwd=${encodeURIComponent(cwd)}&id=${encodeURIComponent(id)}`,
    ),
  usage: () => request<{ usage: UsageSnapshot | null }>('/api/usage'),
  refreshUsage: () => request<{ usage: UsageSnapshot }>('/api/usage/refresh', { method: 'POST' }),
  setNotifications: (body: { topic: string; url?: string }) =>
    request<{ notifications: { url: string; topic: string } }>('/api/notifications', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  testNotification: () => request<{ sent: boolean }>('/api/notifications/test', { method: 'POST' }),
  gitSummaries: () => request<{ summaries: Record<string, { files: number; ahead: number }> }>('/api/git/summaries'),
  gitStatus: (cwd: string) => request<{ git: GitStatusResult }>(`/api/git?cwd=${encodeURIComponent(cwd)}`),
  gitDiff: (cwd: string, path: string) =>
    request<{ diff: string }>(`/api/git/diff?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`),
  gitCommit: (cwd: string, message: string) =>
    request<{ output: string }>('/api/git/commit', { method: 'POST', body: JSON.stringify({ cwd, message }) }),
  gitPush: (cwd: string) => request<{ output: string }>('/api/git/push', { method: 'POST', body: JSON.stringify({ cwd }) }),
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

  /** false when the socket is not open, so the caller keeps the draft instead
   *  of clearing it into the void. */
  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  close() {
    this.closedByUser = true;
    this.ws?.close();
  }
}
