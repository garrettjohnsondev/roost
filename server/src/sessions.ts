import { composeReconcilePrompt } from './consult.js';
import { writePlan, extractCriteria, newTaskId, type PlanFile } from './plans.js';
import type { SessionMode } from './protocol.js';
import { verifyTask, gatesFrom, gateFingerprint } from './verify.js';
import { loadProjectKnowledge } from './projectFile.js';
import { quotaStore } from './quota.js';
import { chooseRoute } from './route.js';
import { chooseEffort, classifyKind } from './routing.js';
import { compactionIntent, type ContextPressure } from './context.js';
import { describeDrift, loadAliases, noteResolution, saveAliases } from './aliasDrift.js';
import { clearAuthFailure, noteAuthFailure } from './claudeAuth.js';
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
import { now, type AgentKind, type ApprovalSetting, type ClientMessage, type ServerEvent, type SessionMeta, type CrewInfo } from './protocol.js';
import { truncate } from './util.js';
import type { AgentAdapter, CallDelta } from './agents/types.js';
import { ClaudeAdapter } from './agents/claude.js';
import { CodexAdapter } from './agents/codex.js';
import { statePath, type AutoRouteConfig, type RoostConfig } from './config.js';
import { sendNotification } from './notify.js';
import { shouldRetriage, triage, type Tier, type TriageResult } from './router.js';
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
    modeExplicit?: boolean;
    autoCompact?: boolean;
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
  /** "Keep compacting automatically" — the person's standing answer. Public
   *  because SessionManager.saveNow persists it, as with mode/modeExplicit. */
  autoCompact = false;
  /** Armed offer awaiting a tap, and the pressure level we last asked at, so the
   *  card appears once per escalation instead of after every turn. */
  private contextOffer?: { reason: string; percent: number | null };
  private contextHandledAt: ContextPressure | null = null;
  private lastSuggestion?: string;
  /** The project's gates as they were when this session began. An agent that
   *  edits them mid-session is caught at verification time. */
  private gateFingerprintAtStart: string | null = null;
  routedModel?: string;
  model: string;
  effort: string;
  approvals: ApprovalSetting;
  mode: SessionMode;
  modeExplicit = false;
  private escalate = true;
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
    config: RoostConfig,
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
    // A stored mode sticks only if the PERSON chose it. Everything persisted
    // before this fix carries mode:'chat' because that was the accidental
    // default -- the model was 'sonnet', not the literal string 'auto', so the
    // old line below fell through to chat and the session never triaged,
    // never used a cheap model, and never convened the two vendors:
    //   this.mode = restore?.mode ?? (this.model === 'auto' ? 'auto' : 'chat')
    this.mode = (opts.restore?.modeExplicit ? opts.restore.mode : undefined) ?? config.consult?.defaultMode ?? 'auto';
    this.modeExplicit = opts.restore?.modeExplicit ?? false;
    this.autoCompact = opts.restore?.autoCompact ?? false;
    // Auto and build route per message, which requires the sentinel. Whatever
    // concrete model the session had becomes the starting point the router
    // moves from, so a resumed chat continues where it was and then re-triages.
    if ((this.mode === 'auto' || this.mode === 'build') && this.model !== 'auto') {
      if (this.model) this.routedModel = this.model;
      this.model = 'auto';
      this.lastTier = undefined;
    }
    this.resumedFrom = opts.resume;
    this.onChange = opts.onChange;
    this.autoRoute = config.autoRoute[agent];
    this.routedModel = opts.restore?.routedModel ?? this.routedModel;
    this.pendingConsult = opts.restore?.pendingConsult;
    // Consult one-shots run on each agent's "standard" tier model — capable enough to
    // plan/review, without paying heavy-tier prices for a throwaway run.
    this.standardModelFor = (a: AgentKind) => config.autoRoute[a].standard.model;
    this.sizeGate = config.consult?.sizeGate ?? true;
    this.budget = config.budget;
    this.maxReviewRounds = Math.max(1, Math.min(2, config.consult?.maxReviewRounds ?? 1));
    this.autoProceed = config.consult?.autoProceed ?? false;
    this.escalate = config.consult?.escalateToConference ?? true;
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
        // The engine's answer is also the ONLY place a Claude release shows up:
        // `opus` is a stable alias that quietly starts pointing somewhere new, so
        // what it resolved to is compared against what it resolved to last time.
        const asked = this.autoMode ? this.routedModel ?? this.model : this.model;
        if (asked) this.noteResolved(asked, model);
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
      modeExplicit: this.modeExplicit || undefined,
      planPath: this.pendingConsult?.planPath,
      agentSessionId: this.agentSessionId,
      resumedFrom: this.resumedFrom,
      boost: this.boost || undefined,
      contextOffer: this.contextOffer,
      recentCrew: this.recentCrew(),
      lastLine: this.lastLine(),
      autoCompact: this.autoCompact || undefined,
      surplus: toSurplusInfo(quotaStore().surplus(this.agent, this.budget)),
    };
  }

  /** Auto-mode dispatcher: cheap Haiku triage picks the tier, tier picks model+effort.
   *  First message always triages; follow-ups only when they plausibly outgrow the
   *  current tier. Any routing failure falls through silently — the message must send. */
  private vendorState(a: AgentKind) {
    return {
      route: a === this.agent ? this.autoRoute : this.otherAutoRoute,
      headroom: quotaStore().headroom(a, this.budget),
      presence: modelRegistry().presence(a),
      surplus: quotaStore().surplus(a, this.budget),
    };
  }

  /** Where the triage call runs.
   *
   *  Triage is tiny, stateless and fires on every message, so it is the
   *  cheapest thing to move onto whichever subscription has room. The live
   *  chat cannot cross vendors -- it is bound to one adapter -- but this
   *  one-shot can, which is the first place the harness actually SPENDS the
   *  other account's quota rather than suggesting the user do it by hand.
   *  `candidates` on the light tier is what makes it reachable. */
  private triageTarget(): { agent: AgentKind; model: string; crossed: boolean } {
    const other: AgentKind = this.agent === 'claude' ? 'codex' : 'claude';
    const fallback = { agent: this.agent, model: this.autoRoute.light?.model ?? '', crossed: false };
    try {
      const d = chooseRoute({ tier: 'light', vendors: { [this.agent]: this.vendorState(this.agent), [other]: this.vendorState(other) } });
      if (d.refused || !d.model) return fallback;
      return { agent: d.agent, model: d.model, crossed: d.agent !== this.agent };
    } catch {
      return fallback;
    }
  }

  private async routeFor(text: string): Promise<TriageResult | null> {
    // User-reported 2026-09-23: tapping send in auto mode gave no sign anything
    // was happening until the triage call (a real network round trip) came
    // back. This is the server-side half of the fix -- it fires whenever auto
    // mode calls routeFor at all, retriage or not, so the phone's local,
    // zero-latency "Pip is picking who takes this…" is corroborated rather
    // than contradicted the moment the real status arrives.
    this.pushEvent({
      type: 'status', state: 'working', message: 'Pip is picking who takes this…',
      crew: crewMember(this.agent, this.model, 'dispatcher'), ts: now(),
    });
    if (!text || (this.lastTier && !shouldRetriage(text, this.lastTier))) return null;
    const t = this.triageTarget();
    if (t.crossed) {
      logDecision({ kind: 'route', sessionId: this.id, stage: 'triage', agent: t.agent, model: t.model, crossedFrom: this.agent, reason: 'more headroom on the other subscription' });
    }
    const triaged = await triage(text, t.agent, t.model, (d) => this.ledgerCall(d, 'triage'));
    const { tier, reason } = triaged;
    if (triaged.raw !== undefined) {
      // The classifier's answer could not be used. Record exactly what it said,
      // so the next "unparseable" can be diagnosed instead of guessed at.
      logDecision({ kind: 'route', sessionId: this.id, stage: 'triage-fallback', agent: t.agent, model: t.model, reason, raw: triaged.raw });
    }
    this.lastTier = tier;
    // Quota-aware: the tier triage asked for is modulated by live headroom on
    // THIS session's vendor -- a chat is bound to one adapter, so the other
    // vendor can only be suggested -- and by the surplus/boost toggle.
    const otherAgent: AgentKind = this.agent === 'claude' ? 'codex' : 'claude';
    const mine = this.vendorState(this.agent);
    if (this.boost && !mine.surplus) {
      this.boost = false;
      this.notice('Boost turned off — the surplus window has reset.');
    }
    const decision = chooseRoute({ tier, vendors: { [this.agent]: mine, [otherAgent]: this.vendorState(otherAgent) }, lockAgent: this.agent, boost: this.boost });
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
      return triaged;
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
      const taskKind = classifyKind(text);
      const effortPick = chooseEffort({
        tier: decision.tier, kind: taskKind, agent: this.agent, headroom: mine.headroom.state,
        surplus: this.boost && !!mine.surplus, configured: target.effort ?? null, supported: card?.efforts ?? null,
        // Opus 5.5 and Fable 5.1 have adaptive thinking ALWAYS ON. chooseEffort
        // has handled this since Phase 4b -- it returns 'model chooses its own
        // thinking budget' -- and the branch was unreachable because this call
        // site passed a hardcoded false. Forcing a fixed effort onto a model
        // that budgets its own is the exact thing that code exists to avoid.
        adaptive: card?.adaptiveThinking ?? false,
      });
      const newEffort = effortPick.effort;
      // chooseEffort's reason was computed every turn and dropped on the floor,
      // so the one lever the user never sees moving was also the one the UI
      // never explained -- 'mechanical work needs little thinking', 'clamped to
      // max, the model does not support the requested level'. It rides the
      // 'routed' event, but only when the change actually landed: a reason for
      // a change hysteresis refused would be a claim about nothing.
      let effortReason: string | null = null;
      if (newEffort !== this.effort) {
        const fromEffort = this.effort || null;
        const change = shouldApplyEffort({ current: fromEffort, proposed: newEffort, agent: this.agent, changesSoFar: this.effortChanges });
        if (change.apply) {
          await this.adapter.setEffort(newEffort).catch(() => {});
          this.effort = newEffort;
          this.effortChanges += 1;
          changed = true;
          effortReason = `thinking ${newEffort} \u2014 ${effortPick.reason}`;
        }
        // Logged either way. Routes were recorded and effort was not, so the
        // effort table could never become evidence-backed the way Phase 4b
        // claims; a proposal hysteresis held back is the row most worth having,
        // because it is the only trace that the chooser wanted to move at all.
        logDecision({
          kind: 'effort', sessionId: this.id, agent: this.agent, model: target.model, tier: decision.tier,
          taskKind, from: fromEffort, to: newEffort, applied: change.apply,
          clamped: effortPick.clamped, adaptive: effortPick.adaptive,
          headroom: mine.headroom.state, surplus: this.boost && !!mine.surplus,
          reason: change.apply ? effortPick.reason : change.reason,
        });
      }
      if (changed) {
        const why = [reason, decision.reason, effortReason].filter(Boolean).join('; ');
        this.pushEvent({
          type: 'routed', model: target.model, tier: decision.tier, reason: why,
          // Pip dispatched this, so Pip says it. Until now the routing turn was
          // the only one in the thread with nobody's name on it.
          crew: crewMember(t.agent, t.model, 'dispatcher'),
          // User-reported: a Haiku-routed turn read "...to haiku" -- the raw
          // model id -- instead of naming Moss, the persona that id maps to.
          // The routing target always runs on this session's own agent (only
          // the throwaway triage call above can cross vendors), so this.agent
          // is correct here, not t.agent.
          worker: crewMember(this.agent, target.model, this.currentRole),
          ts: now(),
        });
        this.broadcastMeta();
      }
    } catch (err: any) {
      this.reportError(`Auto-routing to ${target.model} failed (${String(err?.message ?? err)}) — continuing on current model.`);
    }
    return triaged;
  }

  private pushEvent(event: ServerEvent) {
    // Every assistant turn carries who spoke, in what capacity, on which model
    // -- Phase 1's promise. Only consult turns had it; ordinary replies did not.
    // Deltas are left bare (the reducer folds them into the completed turn).
    if (event.type === 'assistant_message' && !event.crew) {
      const model = this.routedModel || (this.model && this.model !== 'auto' ? this.model : this.standardModelFor(this.agent));
      event = { ...event, crew: crewMember(this.agent, model, this.currentRole) };
    }
    if (event.type === 'error') {
      // Turn failures reached the phone and nothing else — when Claude's sign-in
      // broke there was no record of it anywhere on the Mac. Now there is.
      console.warn(`[roost] ${this.agent} session ${this.id.slice(0, 8)}: ${event.message}`);
      if (event.code === 'auth') {
        noteAuthFailure(event.message);
        if (this.sockets.size === 0) {
          sendNotification('claude-auth', 'Claude needs you to sign in', 'Open Roost and tap Sign in to Claude — it works from the phone.', { minIntervalMs: 30 * 60_000 });
        }
      }
    }
    // A reply that arrived is proof the sign-in works; stop showing the warning.
    if (event.type === 'assistant_message' && this.agent === 'claude') clearAuthFailure();
    if (event.type === 'status' && event.state === 'idle' && this.executing && this.pendingVerify) {
      const pv = this.pendingVerify;
      this.executing = false;
      this.pendingVerify = undefined;
      // Deferred a tick so this idle lands in the transcript before "Verifying…".
      setTimeout(() => void this.autoVerify(pv), 0);
    }
    // Phase 4c's last mile. The meter has been emitting pressure and advice all
    // along; nothing ever acted on it or asked. Deferred a tick so the context
    // event is in the transcript before any notice about it.
    if (event.type === 'context') {
      const intent = compactionIntent({
        state: { ...event.context, advice: event.context.advice ?? null },
        auto: this.autoCompact,
        handledAt: this.contextHandledAt,
      });
      if (intent.kind === 'none') {
        if (intent.forget) this.contextHandledAt = null;
      } else if (intent.kind === 'offer') {
        this.contextHandledAt = intent.pressure;
        this.contextOffer = { reason: intent.reason, percent: intent.percent };
        setTimeout(() => this.broadcastMeta(), 0);
      } else if (intent.kind === 'auto') {
        this.contextHandledAt = intent.pressure;
        setTimeout(() => void this.runCompaction(intent.reason, 'auto'), 0);
      }
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
        {
          const triaged = this.autoMode ? await this.routeFor(msg.text) : null;
          // A large task is where the conference earns its keep -- the same
          // size gate that skips ceremony on small work, read the other way.
          // Nothing executes without Proceed, so this costs a plan and a
          // review, not control.
          if (this.escalate && triaged?.size === 'large' && !this.consultRunning && !msg.images?.length) {
            const planner = crewMember(this.agent, this.routedModel ?? this.standardModelFor(this.agent), 'planner').name;
            this.notice(`This looks like a large task (${triaged.reason}) — ${planner} will plan it and the other engine will review before anything runs. Tap Dismiss on the bar to just chat instead.`);
            logDecision({ kind: 'review', sessionId: this.id, stage: 'escalate', tier: triaged.tier, size: triaged.size, reason: triaged.reason });
            await this.runConsult(msg.text);
            break;
          }
          await this.adapter.sendUserMessage(msg.text, msg.images);
          this.broadcastMeta();
        }
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
        // later permission the user never saw. A real full-auto switch exists
        // now too -- 'set_approvals' below -- but it is its own explicit
        // message the client sends deliberately, never a side effect of this one.
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
        this.modeExplicit = true;
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
      case 'context_action': {
        if (msg.action !== 'compact') break;
        this.contextOffer = undefined;
        if (msg.remember) this.autoCompact = true;
        logDecision({ kind: 'gate', sessionId: this.id, rule: 'compact', action: 'accepted', agent: this.agent, remember: !!msg.remember });
        this.broadcastMeta();
        this.onChange?.(); // the remembered setting is worth a persist
        await this.runCompaction('you asked', msg.remember ? 'accepted-remembered' : 'accepted');
        break;
      }
      case 'set_auto_compact':
        // A remembered setting you cannot turn off is a trap, so the switch is
        // two-way. Turning it off also clears the handled level, so the next
        // crossing asks again rather than staying silent about a full context.
        this.autoCompact = !!msg.on;
        if (!this.autoCompact) this.contextHandledAt = null;
        logDecision({ kind: 'gate', sessionId: this.id, rule: 'compact', action: this.autoCompact ? 'auto-on' : 'auto-off', agent: this.agent });
        this.broadcastMeta();
        this.onChange?.();
        break;
      case 'context_dismiss':
        // The level stays recorded as handled, so dismissing means "not now" and
        // not "ask me again next turn". It re-asks when pressure ESCALATES.
        this.contextOffer = undefined;
        logDecision({ kind: 'gate', sessionId: this.id, rule: 'compact', action: 'dismissed', agent: this.agent, pressure: this.contextHandledAt });
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
    const choice = reviewerFor({ agent: this.agent, model: plannerModel }, modelRegistry().all(), (a) => modelRegistry().presence(a), (a) => quotaStore().headroom(a, this.budget).state);
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
  /** The crew hat behind each orchestrator role, so per-PERSONA spend names a
   *  person rather than inheriting the live chat's. Triage is Pip's: the
   *  dispatcher is the one deciding who goes in. */
  private static LEDGER_ROLE: Record<string, CrewRole> = {
    triage: 'dispatcher',
    plan: 'planner',
    reconcile: 'planner',
    review: 'reviewer',
  };

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
      persona: crewMember(d.agent, d.model, Session.LEDGER_ROLE[role] ?? 'executor').name,
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

  /** Compacts the engine's context and says so. Never silent: the meter is about
   *  to drop a long way, and an unexplained drop looks like lost work.
   *
   *  A failure is reported rather than swallowed. Compaction is the one advisory
   *  action that changes the engine's state, so "we tried and it didn't happen"
   *  is information the person needs -- the alternative is a context that keeps
   *  degrading behind a UI that claims it was handled. */
  private async runCompaction(why: string, how: 'auto' | 'accepted' | 'accepted-remembered'): Promise<void> {
    try {
      const res = await this.adapter.compact();
      this.notice(
        how === 'auto'
          ? `Compacting automatically — ${why}. Turn this off in the context meter.`
          : `Compacting — ${why}.`,
      );
      logDecision({ kind: 'gate', sessionId: this.id, rule: 'compact', action: 'ran', agent: this.agent, trigger: how, mechanism: res.how, reason: why });
    } catch (err: any) {
      this.contextHandledAt = null; // it did not happen, so let it ask again
      this.reportError(`Could not compact this ${this.agent} session (${String(err?.message ?? err)}) — the context is still full.`);
      logDecision({ kind: 'gate', sessionId: this.id, rule: 'compact', action: 'failed', agent: this.agent, trigger: how, reason: String(err?.message ?? err) });
    }
  }

  /** The last line said, read backwards off the transcript like recentCrew so it
   *  cannot drift from what happened. Markdown is flattened to one line — the
   *  home card has room for a sentence, not a code block. */
  private lastLine(): { speaker: string | null; color?: string; text: string } | undefined {
    for (let i = this.transcript.length - 1; i >= 0; i--) {
      const e = this.transcript[i] as any;
      if (e.type === 'user_message' && e.text) return { speaker: null, text: oneLine(e.text) };
      if ((e.type === 'assistant_message' || e.type === 'consult') && e.text) {
        return { speaker: e.crew?.name ?? null, color: e.crew?.color, text: oneLine(e.text) };
      }
    }
    return undefined;
  }

  /** Who last worked in this session, newest first, at most three.
   *
   *  Read backwards off the transcript rather than tracked separately, so it can
   *  never drift from what actually happened -- and de-duplicated by NAME rather
   *  than by model, because two models sharing a persona are one character and
   *  seeing the same face twice in a roll-call would look like a bug. */
  private recentCrew(): CrewInfo[] {
    const out: CrewInfo[] = [];
    const seen = new Set<string>();
    for (let i = this.transcript.length - 1; i >= 0 && out.length < 3; i--) {
      const ev = this.transcript[i] as any;
      const c: CrewInfo | undefined = ev?.crew;
      if (!c || seen.has(c.name)) continue;
      seen.add(c.name);
      out.push(c);
    }
    return out;
  }

  /** Announces a model arriving behind an alias that did not change name.
   *
   *  This is the Claude half of Phase 7. The registry diff catches Codex, whose
   *  ids are versioned and carry succession pointers; it cannot catch Claude,
   *  where a new model lands behind `opus` and no id changes at all. Opus 5.5
   *  shipped on 2026-09-22 and the roster was byte-identical before and after. */
  private noteResolved(asked: string, resolved: string): void {
    if (asked === 'auto') return; // not an alias, just the router not having picked yet
    const store = loadAliases();
    const drift = noteResolution(store, { agent: this.agent, alias: asked, resolved, at: now() });
    saveAliases(store);
    if (!drift) return;
    const msg = describeDrift(drift);
    this.notice(msg);
    logDecision({ kind: 'route', sessionId: this.id, stage: 'alias-drift', agent: this.agent, alias: drift.alias, from: drift.from, to: drift.to, reason: msg });
    // Worth a push: a model changing underneath a running session is the kind of
    // thing you want to hear about even when you are not looking at the app.
    if (this.sockets.size === 0) sendNotification(`alias:${this.agent}:${drift.alias}`, `New model · ${this.agent}`, msg, { minIntervalMs: 60 * 60_000 });
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
  /** The person picked this mode; otherwise the configured default applies. */
  modeExplicit?: boolean;
  /** Survives restarts on purpose: "keep doing this" means keep doing it. */
  autoCompact?: boolean;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private config: RoostConfig) {
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
      modeExplicit: s.modeExplicit,
      autoCompact: s.autoCompact,
    }));
    try {
      const path = statePath();
      // Write-then-rename so a crash mid-write can't leave a truncated state file.
      writeFileSync(path + '.tmp', JSON.stringify({ sessions: entries }, null, 2));
      renameSync(path + '.tmp', path);
    } catch (err: any) {
      console.warn('[roost] failed to persist session state:', String(err?.message ?? err));
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
      console.error(`[roost] session state at ${statePath()} is unreadable (${err?.message ?? err}); moved aside to ${aside}`);
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
            modeExplicit: entry.modeExplicit,
          },
          onChange: () => this.scheduleSave(),
        });
        this.sessions.set(session.id, session);
        restored++;
      } catch (err: any) {
        console.warn(`[roost] failed to restore session ${entry.id}:`, String(err?.message ?? err));
      }
    }
    if (restored > 0) console.log(`[roost] restored ${restored} session(s) from before restart`);
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

/** Markdown to a single readable line: code fences and markup dropped, whitespace
 *  collapsed, capped. */
function oneLine(s: string, max = 140): string {
  const flat = s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~\[\]()!|-]{1,3}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat;
}
