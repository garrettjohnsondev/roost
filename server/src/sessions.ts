import { shouldApplyEffort } from './routing.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { WebSocket } from 'ws';
import { now, type AgentKind, type ApprovalSetting, type ClientMessage, type ServerEvent, type SessionMeta } from './protocol.js';
import { truncate } from './util.js';
import type { AgentAdapter, CallDelta } from './agents/types.js';
import { ClaudeAdapter } from './agents/claude.js';
import { CodexAdapter } from './agents/codex.js';
import { statePath, type AutoRouteConfig, type PocketConfig } from './config.js';
import { sendNotification } from './notify.js';
import { shouldRetriage, triage, type Tier } from './router.js';
import { callLedger } from './ledger.js';
import { crewMember, type CrewRole } from './crew.js';
import { estimateCost } from './pricing.js';
import { composeCriticPrompt, composePlannerPrompt, composeProceedPrompt, startConsultStep, type ConsultRun } from './consult.js';

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
    routedModel?: string;
    pendingConsult?: { task: string; plan: string; critique: string };
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
  private autoRoute: AutoRouteConfig;
  private lastTier?: Tier;
  /** Effort moves this session; each one costs a prompt-cache reset. */
  private effortChanges = 0;
  /** Which hat the live agent is wearing, so ledger rows attribute correctly. */
  private currentRole: CrewRole = 'chat';
  private consultRunning = false;
  private activeConsult?: ConsultRun;
  private consultCancelled = false;
  pendingConsult?: { task: string; plan: string; critique: string };
  private standardModelFor: (agent: AgentKind) => string;
  routedModel?: string;
  model: string;
  effort: string;
  approvals: ApprovalSetting;

  private get autoMode(): boolean {
    return this.model === 'auto';
  }

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
    this.autoRoute = config.autoRoute[agent];
    this.routedModel = opts.restore?.routedModel;
    this.pendingConsult = opts.restore?.pendingConsult;
    // Consult one-shots run on each agent's "standard" tier model — capable enough to
    // plan/review, without paying heavy-tier prices for a throwaway run.
    this.standardModelFor = (a: AgentKind) => config.autoRoute[a].standard.model;
    const adapterOptions = {
      cwd,
      // In auto mode the concrete model is chosen per-message by the router; start the
      // adapter on the last routed choice (or engine default) rather than the literal 'auto'.
      model: this.autoMode ? this.routedModel ?? '' : this.model,
      effort: this.effort,
      approvals: this.approvals,
      resume: opts.resume,
      emit: (event: ServerEvent) => this.pushEvent(event),
      onAgentSessionId: (id: string) => {
        this.agentSessionId = id;
        this.broadcastMeta();
      },
      onModelResolved: (model: string) => {
        // In auto mode 'auto' is the setting; the engine's answer is the routed reality.
        if (this.autoMode) this.routedModel = model;
        else this.model = model;
        this.broadcastMeta();
      },
      // Per-call usage lands in the durable ledger. Engines that report their own
      // dollars (Claude) are taken as authoritative; ones that don't (Codex) are
      // priced from the model id, which yields null rather than a guess when no
      // rate row exists for it.
      onCall: (d: CallDelta) => {
        const priced =
          d.costUsd != null
            ? { usd: d.costUsd, basis: d.costBasis }
            : estimateCost(d.model, { inTok: d.inTok, outTok: d.outTok, cacheReadTok: d.cacheReadTok, cacheWriteTok: d.cacheWriteTok });
        callLedger().record({
          at: Date.now(),
          sessionId: this.id,
          agentSessionId: d.agentSessionId,
          turnId: d.turnId,
          agent: d.agent,
          model: d.model,
          role: this.currentRole,
          persona: crewMember(d.agent, d.model, this.currentRole as CrewRole).name,
          tier: this.lastTier,
          inTok: d.inTok,
          outTok: d.outTok,
          cacheReadTok: d.cacheReadTok,
          cacheWriteTok: d.cacheWriteTok,
          reasoningTok: d.reasoningTok,
          costUsd: priced.usd,
          costBasis: priced.basis,
        });
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
      crew: crewMember(this.agent, this.autoMode ? this.routedModel ?? this.model : this.model, this.currentRole),
      routedModel: this.routedModel,
      consultPending: this.pendingConsult ? true : undefined,
      agentSessionId: this.agentSessionId,
      resumedFrom: this.resumedFrom,
    };
  }

  /** Auto-mode dispatcher: cheap Haiku triage picks the tier, tier picks model+effort.
   *  First message always triages; follow-ups only when they plausibly outgrow the
   *  current tier. Any routing failure falls through silently — the message must send. */
  private async routeFor(text: string): Promise<void> {
    if (!text || (this.lastTier && !shouldRetriage(text, this.lastTier))) return;
    const { tier, reason } = await triage(text);
    this.lastTier = tier;
    const target = this.autoRoute[tier];
    try {
      let changed = false;
      // Two tiers may share a model. Returning early on a same-model retriage
      // skipped the effort change and the 'routed' event along with it.
      if (target.model !== this.routedModel) {
        await this.adapter.setModel(target.model);
        this.routedModel = target.model;
        changed = true;
      }
      // Changing effort mid-conversation invalidates the prompt cache. Only
      // move for a change worth the reset, and never flap -- this used to
      // re-apply on every retriage with no hysteresis at all.
      const newEffort = target.effort ?? '';
      if (newEffort !== this.effort) {
        const change = shouldApplyEffort({ current: this.effort || null, proposed: newEffort, agent: this.agent, changesSoFar: this.effortChanges });
        if (change.apply) {
          await this.adapter.setEffort(newEffort).catch(() => {});
          this.effort = newEffort;
          this.effortChanges += 1;
          changed = true;
        }
      }
      if (changed) {
        this.pushEvent({ type: 'routed', model: target.model, tier, reason, ts: now() });
        this.broadcastMeta();
      }
    } catch (err: any) {
      this.reportError(`Auto-routing to ${target.model} failed (${String(err?.message ?? err)}) — continuing on current model.`);
    }
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
        if (this.autoMode) await this.routeFor(msg.text);
        await this.adapter.sendUserMessage(msg.text, msg.images);
        this.broadcastMeta();
        break;
      case 'approval_response': {
        // Validated here, once. A malformed decision reaching an adapter used
        // to resolve as ALLOW, because both adapters treated "not deny" as accept.
        const decision = msg.decision as unknown;
        if (decision !== 'allow' && decision !== 'allow-session' && decision !== 'deny') {
          this.reportError(`Ignored approval with unknown decision ${JSON.stringify(decision)}.`);
          break;
        }
        // 'allow-session' remembers THIS tool for the rest of the session. It
        // used to flip the whole session to full-auto, silently widening every
        // later permission the user never saw.
        this.adapter.resolveApproval(msg.requestId, decision);
        break;
      }
      case 'set_model':
        if (msg.model === 'auto') {
          // Keep whatever is currently running as the routed baseline; next message re-triages.
          this.routedModel = this.autoMode ? this.routedModel : this.model || undefined;
          this.model = 'auto';
          this.lastTier = undefined;
        } else {
          await this.adapter.setModel(msg.model);
          this.model = msg.model;
          this.routedModel = undefined;
          this.lastTier = undefined;
        }
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
        if (this.activeConsult) {
          this.consultCancelled = true;
          this.activeConsult.cancel();
        }
        await this.adapter.interrupt();
        break;
      case 'consult':
        await this.runConsult(msg.text);
        break;
      case 'consult_proceed': {
        const consult = this.pendingConsult;
        if (!consult) break;
        this.pendingConsult = undefined;
        if (this.title === 'New session' && consult.task) this.title = truncate(consult.task, 60);
        if (this.autoMode) await this.routeFor(consult.task);
        await this.adapter.sendUserMessage(
          composeProceedPrompt(consult.task, consult.plan, consult.critique),
          undefined,
          `▶ Proceed with the consulted plan: ${truncate(consult.task, 120)}`,
        );
        this.broadcastMeta();
        break;
      }
      case 'consult_dismiss':
        this.pendingConsult = undefined;
        this.broadcastMeta();
        break;
    }
  }

  /** Runs the two-agent conference: this session's agent plans (read-only one-shot with
   *  a digest of recent conversation for context), the other agent critiques, both land
   *  in the transcript, and consultPending arms the Proceed/Dismiss bar. Stop cancels the
   *  active one-shot; a failed critique degrades gracefully instead of losing the plan. */
  private async runConsult(task: string): Promise<void> {
    if (!task.trim() || this.consultRunning) return;
    this.consultRunning = true;
    this.consultCancelled = false;
    this.pendingConsult = undefined;
    const other: AgentKind = this.agent === 'claude' ? 'codex' : 'claude';
    try {
      const context = this.transcript
        .filter((e) => e.type === 'user_message' || e.type === 'assistant_message')
        .slice(-6)
        .map((e: any) => `${e.type === 'user_message' ? 'User' : 'Agent'}: ${truncate(e.text, 300)}`)
        .join('\n');

      this.pushEvent({ type: 'status', state: 'working', message: `${crewMember(this.agent, this.standardModelFor(this.agent), 'planner').name} is drafting a plan…`, ts: now() });
      this.activeConsult = startConsultStep(this.agent, this.cwd, composePlannerPrompt(task, context), this.standardModelFor(this.agent), 'plan');
      const plan = await this.activeConsult.promise;
      this.pushEvent({ type: 'consult', phase: 'plan', agent: this.agent, crew: crewMember(this.agent, this.standardModelFor(this.agent), 'planner'), text: plan, ts: now() });

      this.pushEvent({ type: 'status', state: 'working', message: `${crewMember(other, this.standardModelFor(other), 'reviewer').name} is reviewing the plan…`, ts: now() });
      let critique: string;
      try {
        this.activeConsult = startConsultStep(other, this.cwd, composeCriticPrompt(task, plan), this.standardModelFor(other), 'critique');
        critique = await this.activeConsult.promise;
      } catch (err: any) {
        if (this.consultCancelled) throw err;
        // A dead reviewer shouldn't cost the user a good plan — degrade to plan-only.
        critique = `(Critique unavailable — ${truncate(String(err?.message ?? err), 200)}. Proceeding uses the plan as-is.)`;
      }
      this.pushEvent({ type: 'consult', phase: 'critique', agent: other, crew: crewMember(other, this.standardModelFor(other), 'reviewer'), text: critique, ts: now() });

      this.pendingConsult = { task, plan, critique };
      if (this.sockets.size === 0) {
        sendNotification(`consult:${this.id}`, `Consult ready · ${this.title}`, 'Plan and critique are waiting for your decision.');
      }
    } catch (err: any) {
      if (this.consultCancelled) this.pushEvent({ type: 'status', state: 'idle', message: 'Consult cancelled.', ts: now() });
      else this.reportError(`Consult failed: ${String(err?.message ?? err)}`);
    } finally {
      this.activeConsult = undefined;
      this.consultRunning = false;
      this.pushEvent({ type: 'status', state: 'idle', ts: now() });
      this.broadcastMeta();
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
  routedModel?: string;
  effort: string;
  approvals: ApprovalSetting;
  createdAt: number;
  updatedAt: number;
  agentSessionId?: string;
  resumedFrom?: string;
  pendingConsult?: { task: string; plan: string; critique: string };
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

  saveNow(): void {
    const entries: PersistedSession[] = [...this.sessions.values()].map((s) => ({
      id: s.id,
      agent: s.agent,
      cwd: s.cwd,
      title: s.title,
      model: s.model,
      routedModel: s.routedModel,
      effort: s.effort,
      approvals: s.approvals,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      agentSessionId: s.agentSessionId,
      resumedFrom: s.resumedFrom,
      pendingConsult: s.pendingConsult,
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
    if (!existsSync(statePath())) return; // no state file yet
    try {
      entries = JSON.parse(readFileSync(statePath(), 'utf8')).sessions ?? [];
    } catch (err: any) {
      // A file that exists but cannot be parsed is not "no state yet". Say so,
      // and keep it for inspection instead of overwriting it on the next save.
      const aside = `${statePath()}.corrupt-${Date.now()}`;
      try {
        renameSync(statePath(), aside);
      } catch {
        /* leave it in place */
      }
      console.error(`[pocket] session state at ${statePath()} is unreadable (${err?.message ?? err}); moved aside to ${aside}`);
      return;
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
            routedModel: entry.routedModel,
            pendingConsult: entry.pendingConsult,
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
