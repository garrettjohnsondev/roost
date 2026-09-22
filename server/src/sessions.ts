import { composeReconcilePrompt } from './consult.js';
import { writePlan, extractCriteria, newTaskId, type PlanFile } from './plans.js';
import type { SessionMode } from './protocol.js';
import { verifyTask, gatesFrom, gateFingerprint } from './verify.js';
import { loadProjectKnowledge } from './projectFile.js';
import { quotaStore } from './quota.js';
import { chooseRoute } from './route.js';
import { chooseEffort, classifyKind } from './routing.js';
import type { BudgetConfig, AutoRouteConfig as OtherRouteConfig } from './config.js';
import type { Surplus } from './quota.js';
import type { SurplusInfo } from './protocol.js';
import { logDecision } from './decisions.js';
import { reviewerFor, resolveReviewer } from './capabilities.js';
import { modelRegistry } from './registry.js';
import { sanitizeAgentOutput } from './sanitize.js';
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

/** What a finished consult leaves behind for Proceed. */
type ConsultState = { task: string; plan: string; critique: string; criteria?: string[]; taskId?: string; planPath?: string };

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
    pendingConsult?: ConsultState;
    mode?: SessionMode;
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
  pendingConsult?: ConsultState;
  private standardModelFor: (agent: AgentKind) => string;
  /** Decision 3: skip the cross-model review when triage sizes the task small. */
  private sizeGate = true;
  private budget!: BudgetConfig;
  private otherAutoRoute!: OtherRouteConfig;
  /** "Use the good models" while a surplus window is live. */
  private boost = false;
  private lastSuggestion?: string;
  /** The project's gates as they were when this session began. An agent that
   *  edits them mid-session is caught at verification time. */
  private gateFingerprintAtStart: string | null = null;
  routedModel?: string;
  model: string;
  effort: string;
  approvals: ApprovalSetting;
  mode: SessionMode;
  private maxReviewRounds = 1;
  private autoProceed = false;
  private verifyAfterProceed = true;
  /** Set on Proceed; consumed when the executor's turn ends. */
  private pendingVerify?: { taskId?: string; criteria?: string[]; review: boolean };
  private executing = false;

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
    this.mode = opts.restore?.mode ?? (this.model === 'auto' ? 'auto' : 'chat');
    this.resumedFrom = opts.resume;
    this.onChange = opts.onChange;
    this.autoRoute = config.autoRoute[agent];
    this.routedModel = opts.restore?.routedModel;
    this.pendingConsult = opts.restore?.pendingConsult;
    // Consult one-shots run on each agent's "standard" tier model — capable enough to
    // plan/review, without paying heavy-tier prices for a throwaway run.
    this.standardModelFor = (a: AgentKind) => config.autoRoute[a].standard.model;
    this.sizeGate = config.consult?.sizeGate ?? true;
    this.budget = config.budget;
    this.maxReviewRounds = Math.max(1, Math.min(2, config.consult?.maxReviewRounds ?? 1));
    this.autoProceed = config.consult?.autoProceed ?? false;
    this.verifyAfterProceed = config.consult?.verifyAfterProceed ?? true;
    this.otherAutoRoute = config.autoRoute[this.agent === 'claude' ? 'codex' : 'claude'];
    try {
      const gates = gatesFrom(loadProjectKnowledge(this.cwd));
      this.gateFingerprintAtStart = gates.length ? gateFingerprint(gates) : null;
    } catch {
      this.gateFingerprintAtStart = null;
    }
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
      mode: this.mode,
      planPath: this.pendingConsult?.planPath,
      agentSessionId: this.agentSessionId,
      resumedFrom: this.resumedFrom,
      boost: this.boost || undefined,
      surplus: toSurplusInfo(quotaStore().surplus(this.agent, this.budget)),
    };
  }

  /** Auto-mode dispatcher: cheap Haiku triage picks the tier, tier picks model+effort.
   *  First message always triages; follow-ups only when they plausibly outgrow the
   *  current tier. Any routing failure falls through silently — the message must send. */
  private async routeFor(text: string): Promise<void> {
    if (!text || (this.lastTier && !shouldRetriage(text, this.lastTier))) return;
    const { tier, reason } = await triage(text, this.agent, this.autoRoute.light?.model, (d) => this.ledgerCall(d, 'triage'));
    this.lastTier = tier;
    // Quota-aware: the tier triage asked for is modulated by live headroom on
    // THIS session's vendor -- a chat is bound to one adapter, so the other
    // vendor can only be suggested -- and by the surplus/boost toggle.
    const otherAgent: AgentKind = this.agent === 'claude' ? 'codex' : 'claude';
    const vendorState = (a: AgentKind) => ({
      route: a === this.agent ? this.autoRoute : this.otherAutoRoute,
      headroom: quotaStore().headroom(a, this.budget),
      presence: modelRegistry().presence(a),
      surplus: quotaStore().surplus(a, this.budget),
    });
    const mine = vendorState(this.agent);
    if (this.boost && !mine.surplus) {
      this.boost = false;
      this.notice('Boost turned off — the surplus window has reset.');
    }
    const decision = chooseRoute({ tier, vendors: { [this.agent]: mine, [otherAgent]: vendorState(otherAgent) }, lockAgent: this.agent, boost: this.boost });
    logDecision({ kind: 'route', sessionId: this.id, agent: this.agent, askedTier: tier, tier: decision.tier, model: decision.model, headroom: mine.headroom.state, gated: decision.gated, refused: decision.refused, steppedDown: decision.steppedDown, steppedUp: decision.steppedUp, boost: this.boost, reason: decision.reason });
    if (decision.suggestOther) {
      const key = `${mine.headroom.state}:${decision.suggestOther}`;
      if (this.lastSuggestion !== key) {
        this.lastSuggestion = key;
        const msg = `${this.agent} is ${mine.headroom.state} (${mine.headroom.reason}); ${decision.suggestOther} has room — consider starting new work there.`;
        this.notice(msg);
        if (this.sockets.size === 0) sendNotification(`route:${this.id}`, `Quota · ${this.title}`, msg, { minIntervalMs: 30 * 60_000 });
      }
    }
    if (decision.refused) {
      // The user's own message still goes out; routing just has nothing to pick.
      this.notice(`Routing refused: ${decision.reason}. Sending on the current model.`);
      return;
    }
    const target = { model: decision.model, effort: decision.effort };
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
      // Phase 4b's chooser, finally on the live path: it trims thinking before
      // the model is downgraded and raises it first under boost. The user's
      // configured effort is the base; adaptive is not forced over it.
      const card = modelRegistry().get(this.agent, target.model);
      const effortPick = chooseEffort({
        tier: decision.tier, kind: classifyKind(text), agent: this.agent, headroom: mine.headroom.state,
        surplus: this.boost && !!mine.surplus, configured: target.effort ?? null, supported: card?.efforts ?? null, adaptive: false,
      });
      const newEffort = effortPick.effort;
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
        this.pushEvent({ type: 'routed', model: target.model, tier: decision.tier, reason: `${reason}; ${decision.reason}`, ts: now() });
        this.broadcastMeta();
      }
    } catch (err: any) {
      this.reportError(`Auto-routing to ${target.model} failed (${String(err?.message ?? err)}) — continuing on current model.`);
    }
  }

  private pushEvent(event: ServerEvent) {
    // Every assistant turn carries who spoke, in what capacity, on which model
    // -- Phase 1's promise. Only consult turns had it; ordinary replies did not.
    // Deltas are left bare (the reducer folds them into the completed turn).
    if (event.type === 'assistant_message' && !event.crew) {
      const model = this.routedModel || (this.model && this.model !== 'auto' ? this.model : this.standardModelFor(this.agent));
      event = { ...event, crew: crewMember(this.agent, model, this.currentRole) };
    }
    if (event.type === 'status' && event.state === 'idle' && this.executing && this.pendingVerify) {
      const pv = this.pendingVerify;
      this.executing = false;
      this.pendingVerify = undefined;
      // Deferred a tick so this idle lands in the transcript before "Verifying…".
      setTimeout(() => void this.autoVerify(pv), 0);
    }
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
        if (this.mode === 'plan' || this.mode === 'build') {
          // Plan: a plan file, nothing executes. Build: the full conference,
          // then the Proceed gate (or autoProceed, off by default).
          await this.runConsult(msg.text, { planOnly: this.mode === 'plan' });
          break;
        }
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
          composeProceedPrompt(consult.task, consult.plan, consult.critique, consult.criteria ?? []),
          undefined,
          `▶ Proceed with the consulted plan: ${truncate(consult.task, 120)}`,
        );
        // Verification runs when this turn ends: gates always, the diff
        // reviewer in build mode. Armed here, fired from pushEvent.
        if (this.verifyAfterProceed) {
          this.pendingVerify = { taskId: consult.taskId, criteria: consult.criteria, review: this.mode === 'build' };
          this.executing = true;
        }
        logDecision({ kind: 'review', sessionId: this.id, stage: 'execute', taskId: consult.taskId, mode: this.mode });
        this.broadcastMeta();
        break;
      }
      case 'verify': {
        // The harness runs the project's gates and posts what happened --
        // exit codes and output, not the agent's opinion of its own work.
        this.pushEvent({ type: 'status', state: 'working', message: msg.review ? 'Running gates, then reviewing the diff…' : 'Running the project gates…', ts: now() });
        try {
          const report = await verifyTask({
            cwd: this.cwd,
            taskId: this.id,
            fingerprintAtStart: this.gateFingerprintAtStart,
            review: msg.review ? { executorAgent: this.agent, criteria: typeof msg.criteria === 'string' ? msg.criteria : undefined, onCall: (d) => this.ledgerCall(d, 'review') } : undefined,
          });
          this.pushEvent({ type: 'verify', report, ts: now() });
        } catch (err: any) {
          this.reportError(`Verification failed to run: ${String(err?.message ?? err)}`);
        } finally {
          this.pushEvent({ type: 'status', state: 'idle', ts: now() });
        }
        break;
      }
      case 'set_mode': {
        const m = msg.mode;
        if (m !== 'chat' && m !== 'auto' && m !== 'plan' && m !== 'build') break;
        this.mode = m;
        if ((m === 'auto' || m === 'build') && this.model !== 'auto') {
          this.routedModel = this.model || undefined;
          this.model = 'auto';
          this.lastTier = undefined;
        } else if ((m === 'chat' || m === 'plan') && this.model === 'auto') {
          const concrete = this.routedModel ?? this.standardModelFor(this.agent);
          await this.adapter.setModel(concrete).catch(() => {});
          this.model = concrete;
          this.routedModel = undefined;
        }
        logDecision({ kind: 'gate', sessionId: this.id, rule: 'mode', action: m });
        this.broadcastMeta();
        break;
      }
      case 'set_boost':
        this.boost = !!msg.on;
        if (this.autoMode) this.lastTier = undefined; // the next message re-routes
        logDecision({ kind: 'gate', sessionId: this.id, rule: 'boost', action: this.boost ? 'on' : 'off' });
        this.broadcastMeta();
        break;
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
  private async runConsult(task: string, opts: { planOnly?: boolean } = {}): Promise<void> {
    if (!task.trim() || this.consultRunning) return;
    // The gate, before any one-shot process exists.
    const h = quotaStore().headroom(this.agent, this.budget);
    if (h.state === 'exhausted') {
      logDecision({ kind: 'gate', sessionId: this.id, rule: 'quota', action: 'refused', agent: this.agent, role: 'consult', reason: h.reason });
      this.reportError(`Consult refused: ${this.agent} ${h.reason}.`);
      return;
    }
    this.consultRunning = true;
    this.consultCancelled = false;
    this.pendingConsult = undefined;
    // Who reviews: the other vendor when present, otherwise a different model
    // on this subscription, otherwise a clean context of the same model -- and
    // the strength is labelled on the turn. This was hard-wired to the other
    // vendor and simply failed on a single subscription. The planner is the
    // model the user actually chose, not a silent downgrade to standard.
    const plannerModel = this.model && this.model !== 'auto' ? this.model : (this.routedModel ?? this.standardModelFor(this.agent));
    const choice = reviewerFor({ agent: this.agent, model: plannerModel }, modelRegistry().all(), (a) => modelRegistry().presence(a));
    const configuredOther: AgentKind = this.agent === 'claude' ? 'codex' : 'claude';
    // An empty or unfetched roster must not be reported as "no reviewer" while
    // the configured one goes on to review anyway.
    const resolved = resolveReviewer(choice, { agent: configuredOther, model: this.standardModelFor(configuredOther) });
    const other: AgentKind = resolved.agent;
    const reviewerModel = resolved.model;
    const strengthLabel = resolved.label;
    // Decision 3: below ~10 files / 3 independent pieces the conference costs
    // more than it returns. Ask triage for a size; when it says small, keep
    // the plan and skip the cross-model review -- and say so on the turn.
    // Unknown size runs the full conference: the gate never skips on a guess.
    const sized = this.sizeGate ? await triage(task, this.agent, this.autoRoute.light?.model, (d) => this.ledgerCall(d, 'triage')) : null;
    const skipReview = sized?.size === 'small';
    logDecision({ kind: 'review', sessionId: this.id, planner: { agent: this.agent, model: plannerModel }, reviewer: { agent: other, model: reviewerModel }, strength: resolved.strength, size: sized?.size ?? null, skipped: skipReview });
    try {
      const context = this.transcript
        .filter((e) => e.type === 'user_message' || e.type === 'assistant_message')
        .slice(-6)
        .map((e: any) => `${e.type === 'user_message' ? 'User' : 'Agent'}: ${truncate(e.text, 300)}`)
        .join('\n');

      this.pushEvent({ type: 'status', state: 'working', message: `${crewMember(this.agent, plannerModel, 'planner').name} is drafting a plan…`, ts: now() });
      this.activeConsult = startConsultStep(this.agent, this.cwd, composePlannerPrompt(task, context), plannerModel, 'plan', (d) => this.ledgerCall(d, 'plan'));
      // Dispatched output is untrusted input: defang control structures before
      // the plan reaches the reviewer's context, the transcript, or execution.
      const plan = sanitizeAgentOutput(await this.activeConsult.promise).text;
      this.pushEvent({ type: 'consult', phase: 'plan', agent: this.agent, crew: crewMember(this.agent, plannerModel, 'planner'), text: plan, ts: now() });
      // The plan is a file from here on. Criteria are pulled out of it and
      // travel with review, execution and verification.
      const taskId = newTaskId();
      const criteria = extractCriteria(plan);
      let planFile: PlanFile = { taskId, task, plan, criteria, rounds: 0, createdAt: now(), updatedAt: now() };
      const path = writePlan(this.cwd, planFile);
      logDecision({ kind: 'review', sessionId: this.id, stage: 'plan', taskId, criteria: criteria.length, planPath: path });
      if (opts.planOnly) {
        this.pendingConsult = { task, plan, critique: '', criteria, taskId, planPath: path };
        this.pushEvent({ type: 'status', state: 'working', message: `Plan written to ${path}`, ts: now() });
        return;
      }

      let critique: string;
      if (skipReview) {
        critique = `(Review skipped — triage sized this task small${sized?.reason ? `: ${sized.reason}` : ''}. Below ~10 files or 3 independent pieces the cross-model review costs more than it returns; proceeding uses the plan as-is.)`;
        this.pushEvent({ type: 'consult', phase: 'critique', agent: this.agent, reviewStrength: 'Size gate — review skipped', text: critique, ts: now() });
      } else {
        this.pushEvent({ type: 'status', state: 'working', message: `${crewMember(other, reviewerModel, 'reviewer').name} is reviewing the plan (${strengthLabel.toLowerCase()})…`, ts: now() });
        try {
          this.activeConsult = startConsultStep(other, this.cwd, composeCriticPrompt(task, plan, criteria), reviewerModel, 'critique', (d) => this.ledgerCall(d, 'review'));
          critique = sanitizeAgentOutput(await this.activeConsult.promise).text;
        } catch (err: any) {
          if (this.consultCancelled) throw err;
          // A dead reviewer shouldn't cost the user a good plan — degrade to plan-only.
          critique = `(Critique unavailable — ${truncate(String(err?.message ?? err), 200)}. Proceeding uses the plan as-is.)`;
        }
        this.pushEvent({ type: 'consult', phase: 'critique', agent: other, crew: crewMember(other, reviewerModel, 'reviewer'), reviewStrength: strengthLabel, text: critique, ts: now() });
      }

      // Reconcile: the author filters the findings against the task and the
      // criteria BEFORE anyone acts on them. Capped at maxReviewRounds
      // (default 1, never more than 2): round 1 buys ~8 points, round 2 ~4.5,
      // round 3 ~1.5 and rising noise.
      let reconciled = plan;
      let currentCritique = critique;
      let rounds = 0;
      while (!skipReview && rounds < this.maxReviewRounds && !currentCritique.startsWith('(Critique unavailable')) {
        rounds += 1;
        this.pushEvent({ type: 'status', state: 'working', message: `${crewMember(this.agent, plannerModel, 'planner').name} is reconciling the review against the requirements…`, ts: now() });
        this.activeConsult = startConsultStep(this.agent, this.cwd, composeReconcilePrompt(task, reconciled, currentCritique, criteria), plannerModel, 'reconcile', (d) => this.ledgerCall(d, 'reconcile'));
        reconciled = sanitizeAgentOutput(await this.activeConsult.promise).text;
        this.pushEvent({ type: 'consult', phase: 'reconcile', agent: this.agent, crew: crewMember(this.agent, plannerModel, 'planner'), text: reconciled, ts: now() });
        planFile = { ...planFile, critique: currentCritique, reconciled, rounds, updatedAt: now() };
        writePlan(this.cwd, planFile);
        logDecision({ kind: 'review', sessionId: this.id, stage: 'reconcile', taskId, round: rounds });
        const needsChanges = /VERDICT:\s*NEEDS CHANGES/i.test(currentCritique);
        if (!needsChanges || rounds >= this.maxReviewRounds) break;
        this.pushEvent({ type: 'status', state: 'working', message: `${crewMember(other, reviewerModel, 'reviewer').name} is re-reviewing (round ${rounds + 1})…`, ts: now() });
        try {
          this.activeConsult = startConsultStep(other, this.cwd, composeCriticPrompt(task, reconciled, criteria), reviewerModel, 'critique', (d) => this.ledgerCall(d, 'review'));
          currentCritique = sanitizeAgentOutput(await this.activeConsult.promise).text;
          this.pushEvent({ type: 'consult', phase: 'critique', agent: other, crew: crewMember(other, reviewerModel, 'reviewer'), reviewStrength: strengthLabel, text: currentCritique, ts: now() });
        } catch (err: any) {
          if (this.consultCancelled) throw err;
          break;
        }
      }

      this.pendingConsult = { task, plan: reconciled, critique: currentCritique, criteria, taskId, planPath: path };
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
    if (this.autoProceed && this.mode === 'build' && this.pendingConsult && !opts.planOnly) {
      await this.handleClientMessage({ type: 'consult_proceed' });
    }
  }

  /** Runs when the executor's turn ends after a Proceed: the project gates,
   *  and in build mode the fresh-context diff reviewer with the criteria. */
  private async autoVerify(pv: { taskId?: string; criteria?: string[]; review: boolean }): Promise<void> {
    this.pushEvent({ type: 'status', state: 'working', message: pv.review ? 'Execution finished — running the gates, then reviewing the diff…' : 'Execution finished — running the project gates…', ts: now() });
    try {
      const report = await verifyTask({
        cwd: this.cwd,
        taskId: pv.taskId ?? this.id,
        fingerprintAtStart: this.gateFingerprintAtStart,
        review: pv.review ? { executorAgent: this.agent, criteria: pv.criteria?.length ? pv.criteria.map((c) => `- ${c}`).join('\n') : undefined, onCall: (d) => this.ledgerCall(d, 'review') } : undefined,
      });
      this.pushEvent({ type: 'verify', report, ts: now() });
      if (this.sockets.size === 0) sendNotification(`verify:${this.id}`, `${report.passed ? 'Verified' : 'Verification FAILED'} · ${this.title}`, report.summary);
    } catch (err: any) {
      this.reportError(`Verification failed to run: ${String(err?.message ?? err)}`);
    } finally {
      this.pushEvent({ type: 'status', state: 'idle', ts: now() });
    }
  }

  /** One-shots (triage, plan, review, reconcile, diff review) were invisible
   *  to the ledger -- the orchestrator's own turns are the line item nobody
   *  budgets for, and they were not even counted. */
  private ledgerCall(d: CallDelta, role: string): void {
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
      role,
      persona: crewMember(d.agent, d.model, this.currentRole as CrewRole).name,
      tier: this.lastTier,
      inTok: d.inTok,
      outTok: d.outTok,
      cacheReadTok: d.cacheReadTok,
      cacheWriteTok: d.cacheWriteTok,
      reasoningTok: d.reasoningTok,
      costUsd: priced.usd ?? null,
      costBasis: priced.basis as any,
    });
  }

  /** A visible, non-error note on the session's status line. */
  notice(message: string) {
    this.pushEvent({ type: 'status', state: this.lastStatus, message, ts: now() });
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

function toSurplusInfo(s: Surplus | null): SurplusInfo | null {
  return s ? { agent: s.agent, label: s.window.label, minutesLeft: s.minutesLeft, headroomPct: s.headroomPct } : null;
}

/** Thrown by SessionManager.create when guards.oneWriter is 'block'. */
export class OneWriterError extends Error {
  readonly status = 409;
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
  pendingConsult?: ConsultState;
  mode?: SessionMode;
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
      mode: s.mode,
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
            mode: entry.mode,
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
    // Decision 2, one writer. Checked BEFORE constructing the session, because
    // a Session spawns its agent process on construction and a refusal must
    // not leave one running.
    const others = [...this.sessions.values()].filter((s) => s.meta().cwd === cwd);
    if (others.length && this.config.guards?.oneWriter === 'block') {
      logDecision({ kind: 'gate', rule: 'one-writer', action: 'blocked', cwd, others: others.map((s) => s.id) });
      throw new OneWriterError(`${others.length} other session${others.length > 1 ? 's are' : ' is'} already open on this project and guards.oneWriter is 'block'. Close it first, or set guards.oneWriter to 'warn'.`);
    }
    const session = new Session(agent, cwd, this.config, { ...opts, onChange: () => this.scheduleSave() });
    this.sessions.set(session.id, session);
    if (others.length) {
      session.notice(`${others.length} other session${others.length > 1 ? 's are' : ' is'} open on this project — concurrent edits are not guarded; keep one session writing at a time.`);
      logDecision({ kind: 'gate', sessionId: session.id, rule: 'one-writer', cwd, others: others.map((s) => s.id) });
    }
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
