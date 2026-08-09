import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { now, type AgentKind, type ApprovalSetting, type ClientMessage, type ServerEvent, type SessionMeta } from './protocol.js';
import { truncate } from './util.js';
import type { AgentAdapter } from './agents/types.js';
import { ClaudeAdapter } from './agents/claude.js';
import { CodexAdapter } from './agents/codex.js';
import type { PocketConfig } from './config.js';

const TRANSCRIPT_CAP = 5000;

export class Session {
  readonly id = randomUUID();
  readonly createdAt = now();
  title = 'New session';
  agentSessionId?: string;
  private transcript: ServerEvent[] = [];
  private sockets = new Set<WebSocket>();
  private adapter: AgentAdapter;
  model: string;
  effort: string;
  approvals: ApprovalSetting;

  constructor(
    readonly agent: AgentKind,
    readonly cwd: string,
    config: PocketConfig,
    opts: { model?: string; resume?: string } = {},
  ) {
    const agentConfig = config[agent];
    this.model = opts.model ?? agentConfig.defaultModel;
    this.effort = '';
    this.approvals = 'ask';
    const adapterOptions = {
      cwd,
      model: this.model,
      effort: this.effort,
      approvals: this.approvals,
      resume: opts.resume,
      emit: (event: ServerEvent) => this.pushEvent(event),
      onAgentSessionId: (id: string) => {
        this.agentSessionId = id;
        this.broadcastMeta();
      },
    };
    this.adapter = agent === 'claude' ? new ClaudeAdapter(adapterOptions) : new CodexAdapter(adapterOptions);
  }

  meta(): SessionMeta {
    return {
      id: this.id,
      agent: this.agent,
      cwd: this.cwd,
      title: this.title,
      model: this.model,
      effort: this.effort,
      approvals: this.approvals,
      createdAt: this.createdAt,
      agentSessionId: this.agentSessionId,
    };
  }

  private pushEvent(event: ServerEvent) {
    this.transcript.push(event);
    if (this.transcript.length > TRANSCRIPT_CAP) this.transcript.splice(0, this.transcript.length - TRANSCRIPT_CAP);
    this.broadcast(event);
  }

  private broadcast(event: ServerEvent) {
    const payload = JSON.stringify(event);
    for (const ws of this.sockets) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }

  private broadcastMeta() {
    this.broadcast({ type: 'session_meta', meta: this.meta() });
  }

  attach(ws: WebSocket) {
    this.sockets.add(ws);
    // Replay without the delta stream: full messages are enough to rebuild history,
    // and replaying deltas would duplicate the final texts.
    const events = this.transcript.filter((e) => e.type !== 'assistant_delta' && e.type !== 'thinking_delta');
    ws.send(JSON.stringify({ type: 'replay', events, meta: this.meta() } satisfies ServerEvent));
    ws.on('close', () => this.sockets.delete(ws));
  }

  async handleClientMessage(msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case 'user_message':
        if (this.title === 'New session' && msg.text) this.title = truncate(msg.text, 60);
        await this.adapter.sendUserMessage(msg.text, msg.images);
        this.broadcastMeta();
        break;
      case 'approval_response':
        this.adapter.resolveApproval(msg.requestId, msg.decision);
        if (msg.decision === 'allow-session') {
          this.approvals = 'full-auto';
          this.broadcastMeta();
        }
        break;
      case 'set_model':
        await this.adapter.setModel(msg.model);
        this.model = msg.model;
        this.broadcastMeta();
        break;
      case 'set_effort':
        await this.adapter.setEffort(msg.effort);
        this.effort = msg.effort;
        this.broadcastMeta();
        break;
      case 'set_approvals':
        await this.adapter.setApprovals(msg.approvals);
        this.approvals = msg.approvals;
        this.broadcastMeta();
        break;
      case 'interrupt':
        await this.adapter.interrupt();
        break;
    }
  }

  reportError(message: string) {
    this.pushEvent({ type: 'error', message, ts: now() });
  }

  dispose() {
    this.adapter.dispose();
    for (const ws of this.sockets) ws.close();
    this.sockets.clear();
  }
}

export class SessionManager {
  private sessions = new Map<string, Session>();

  constructor(private config: PocketConfig) {}

  create(agent: AgentKind, cwd: string, opts: { model?: string; resume?: string } = {}): Session {
    const session = new Session(agent, cwd, this.config, opts);
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  list(): SessionMeta[] {
    return [...this.sessions.values()].map((s) => s.meta()).sort((a, b) => b.createdAt - a.createdAt);
  }

  close(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.dispose();
    this.sessions.delete(id);
    return true;
  }
}
