import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { WebSocket } from 'ws';
import { now, type AgentKind, type ApprovalSetting, type ClientMessage, type ServerEvent, type SessionMeta } from './protocol.js';
import { truncate } from './util.js';
import type { AgentAdapter } from './agents/types.js';
import { ClaudeAdapter } from './agents/claude.js';
import { CodexAdapter } from './agents/codex.js';
import { statePath, type PocketConfig } from './config.js';
import { sendNotification } from './notify.js';

const TRANSCRIPT_CAP = 5000;

interface SessionOpts {
  model?: string;
  resume?: string;
  /** Present when re-materializing a persisted session after a server restart. */
  restore?: {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    effort: string;
    approvals: ApprovalSetting;
  };
  onChange?: () => void;
}

export class Session {
  readonly id: string;
  readonly createdAt: number;
  updatedAt: number;
  title: string;
  agentSessionId?: string;
  readonly resumedFrom?: string;
  private transcript: ServerEvent[] = [];
  private sockets = new Set<WebSocket>();
  private adapter: AgentAdapter;
  private lastStatus: SessionMeta['state'] = 'idle';
  private onChange?: () => void;
  model: string;
  effort: string;
  approvals: ApprovalSetting;

  constructor(
    readonly agent: AgentKind,
    readonly cwd: string,
    config: PocketConfig,
    opts: SessionOpts = {},
  ) {
    const agentConfig = config[agent];
    this.id = opts.restore?.id ?? randomUUID();
    this.createdAt = opts.restore?.createdAt ?? now();
    this.updatedAt = opts.restore?.updatedAt ?? now();
    this.title = opts.restore?.title ?? 'New session';
    // Resuming without an explicit model leaves it unset so the engine continues with
    // whatever the original session was using; onModelResolved fills in the true value
    // once the agent reports it, instead of forcing today's default onto old history.
    this.model = opts.model ?? (opts.resume ? '' : agentConfig.defaultModel);
    this.effort = opts.restore?.effort ?? '';
    this.approvals = opts.restore?.approvals ?? 'ask';
    this.resumedFrom = opts.resume;
    this.onChange = opts.onChange;
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
      onModelResolved: (model: string) => {
        this.model = model;
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
      updatedAt: this.updatedAt,
      state: this.lastStatus,
      agentSessionId: this.agentSessionId,
      resumedFrom: this.resumedFrom,
    };
  }

  private pushEvent(event: ServerEvent) {
    this.transcript.push(event);
    if (this.transcript.length > TRANSCRIPT_CAP) this.transcript.splice(0, this.transcript.length - TRANSCRIPT_CAP);
    // Meaningful activity only — status/usage churn shouldn't bump a session to the top
    // of the "recent" switcher just because it's mid-turn.
    if (event.type === 'user_message' || event.type === 'assistant_message' || event.type === 'tool_start') {
      this.updatedAt = now();
      this.onChange?.();
    }

    // Notify the phone only when nobody is watching this session — an attached socket
    // means the user already sees it happening live.
    if (this.sockets.size === 0) {
      if (event.type === 'approval_request') {
        sendNotification(`approval:${this.id}`, `Approval needed · ${this.title}`, event.title);
      } else if (event.type === 'error') {
        sendNotification(`error:${this.id}`, `Error · ${this.title}`, truncate(event.message, 300), { minIntervalMs: 60_000 });
      }
    }
    if (event.type === 'status') {
      if (this.lastStatus === 'working' && event.state === 'idle' && this.sockets.size === 0) {
        sendNotification(`done:${this.id}`, `Finished · ${this.title}`, 'The agent is done and waiting for you.', {
          minIntervalMs: 60_000,
        });
      }
      this.lastStatus = event.state;
    }

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
    this.onChange?.();
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
      case 'set_title': {
        const title = truncate(msg.title.trim(), 80);
        if (title) {
          this.title = title;
          this.broadcastMeta();
          // Best-effort: also rename the on-disk Claude session so "Recent" shows it.
          if (this.agent === 'claude') {
            const target = this.agentSessionId ?? this.resumedFrom;
            if (target) {
              void import('@anthropic-ai/claude-agent-sdk')
                .then((sdk: any) => sdk.renameSession?.(target, title, { dir: this.cwd }))
                .catch(() => {});
            }
          }
        }
        break;
      }
      case 'interrupt':
        await this.adapter.interrupt();
        break;
    }
  }

  reportError(message: string) {
    this.pushEvent({ type: 'error', message, ts: now() });
  }

  /** Closes the underlying agent process and every attached socket. `reason` reaches the
   *  client as the WebSocket close reason (code 4010) so the UI can explain why, instead
   *  of the socket just silently dying and retrying forever. */
  dispose(reason = 'Closed') {
    this.adapter.dispose();
    for (const ws of this.sockets) ws.close(4010, reason);
    this.sockets.clear();
  }
}

const IDLE_SWEEP_INTERVAL_MS = 30 * 60 * 1000;
const SAVE_DEBOUNCE_MS = 2000;

interface PersistedSession {
  id: string;
  agent: AgentKind;
  cwd: string;
  title: string;
  model: string;
  effort: string;
  approvals: ApprovalSetting;
  createdAt: number;
  updatedAt: number;
  agentSessionId?: string;
  resumedFrom?: string;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private config: PocketConfig) {
    const interval = setInterval(() => this.sweepIdle(), IDLE_SWEEP_INTERVAL_MS);
    interval.unref(); // don't hold the process open just for the sweep timer
  }

  private sweepIdle() {
    const hours = this.config.sessionIdleTimeoutHours;
    if (!hours || hours <= 0) return;
    const cutoff = now() - hours * 60 * 60 * 1000;
    let removed = false;
    for (const [id, session] of this.sessions) {
      if (session.updatedAt < cutoff) {
        session.dispose(`Closed automatically after ${hours}h of inactivity`);
        this.sessions.delete(id);
        removed = true;
      }
    }
    if (removed) this.saveNow();
  }

  /** Debounced persist — session activity calls this freely. */
  scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, SAVE_DEBOUNCE_MS);
    this.saveTimer.unref();
  }

  private saveNow(): void {
    const entries: PersistedSession[] = [...this.sessions.values()].map((s) => ({
      id: s.id,
      agent: s.agent,
      cwd: s.cwd,
      title: s.title,
      model: s.model,
      effort: s.effort,
      approvals: s.approvals,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      agentSessionId: s.agentSessionId,
      resumedFrom: s.resumedFrom,
    }));
    try {
      const path = statePath();
      // Write-then-rename so a crash mid-write can't leave a truncated state file.
      writeFileSync(path + '.tmp', JSON.stringify({ sessions: entries }, null, 2));
      renameSync(path + '.tmp', path);
    } catch (err: any) {
      console.warn('[pocket] failed to persist session state:', String(err?.message ?? err));
    }
  }

  /** Re-materialize sessions persisted before the last shutdown/crash. Each one resumes
   *  its underlying agent session, so phones that reconnect land back in their chats
   *  (with the recap card standing in for the in-memory transcript that didn't survive). */
  restore(): void {
    let entries: PersistedSession[];
    try {
      entries = JSON.parse(readFileSync(statePath(), 'utf8')).sessions ?? [];
    } catch {
      return; // no state file yet
    }
    const hours = this.config.sessionIdleTimeoutHours;
    const cutoff = hours && hours > 0 ? now() - hours * 60 * 60 * 1000 : 0;
    let restored = 0;
    for (const entry of entries) {
      try {
        if (entry.updatedAt < cutoff) continue; // would have been idle-swept anyway
        if (!this.config.projects.includes(entry.cwd)) continue;
        const resume = entry.agentSessionId ?? entry.resumedFrom;
        if (!resume) continue; // never got used — nothing to restore
        const session = new Session(entry.agent, entry.cwd, this.config, {
          model: entry.model || undefined,
          resume,
          restore: {
            id: entry.id,
            title: entry.title,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            effort: entry.effort,
            approvals: entry.approvals,
          },
          onChange: () => this.scheduleSave(),
        });
        this.sessions.set(session.id, session);
        restored++;
      } catch (err: any) {
        console.warn(`[pocket] failed to restore session ${entry.id}:`, String(err?.message ?? err));
      }
    }
    if (restored > 0) console.log(`[pocket] restored ${restored} session(s) from before restart`);
    this.saveNow();
  }

  create(agent: AgentKind, cwd: string, opts: { model?: string; resume?: string } = {}): Session {
    const session = new Session(agent, cwd, this.config, { ...opts, onChange: () => this.scheduleSave() });
    this.sessions.set(session.id, session);
    this.saveNow();
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  list(): SessionMeta[] {
    return [...this.sessions.values()].map((s) => s.meta()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  close(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.dispose('Closed');
    this.sessions.delete(id);
    this.saveNow();
    return true;
  }
}
