import { composeReconcilePrompt } from './consult.js';
import { pathParts } from './platform.js';
import { writePlan, extractCriteria, newTaskId, type PlanFile } from './plans.js';
import type { AskLevel, AskQuestion, Builder, SessionMode, UserImage } from './protocol.js';
import { askGuidance } from './ask.js';
import { treeFingerprint } from './treeState.js';
import { verifyTask, gatesFrom, gateFingerprint } from './verify.js';
import { loadProjectKnowledge } from './projectFile.js';
import { detectCheck } from './deploy.js';
import { getGitStatus, gitCommit } from './git.js';
import { TurnTally, recordTurn } from './turnStats.js';
import { quotaStore } from './quota.js';
import { refreshUsageSoon } from './usage.js';
import { companionFor, noteLife, readLedgerRows, readLife } from './companions.js';
import { isGateRefusal } from './gate.js';
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
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WebSocket } from 'ws';
import { now, type AgentKind, type ApprovalSetting, type ClientMessage, type ServerEvent, type SessionMeta, type CrewInfo } from './protocol.js';
import { truncate } from './util.js';
import type { AgentAdapter, CallDelta } from './agents/types.js';
import { ClaudeAdapter } from './agents/claude.js';
import { CodexAdapter } from './agents/codex.js';
import { extractOnDeck, noteOnDeck } from './onDeck.js';
import { dataDir, statePath, type AutoRouteConfig, type RoostConfig } from './config.js';
import { sendNotification } from './notify.js';
import { shouldRetriage, triage, type Tier, type TriageResult } from './router.js';
import { TranscriptWriter, lastState, readTranscript, removeTranscript } from './transcripts.js';
import { composeHandoffPrompt, composeMentionPrompt, modelForPersona, parseMention } from './mentions.js';
import { runAgentTask, type AgentTaskRun } from './agents/dispatch.js';
import { allPersonas, personaFor } from './crew.js';
import { autoTitle, isWeakName, jobName, startsNewJob } from './naming.js';
import { callLedger } from './ledger.js';
import { crewMember, type CrewRole } from './crew.js';
import { estimateCost } from './pricing.js';
import { composeCriticPrompt, composePlannerPrompt, composeProceedPrompt, startConsultStep, type ConsultRun } from './consult.js';

const TRANSCRIPT_CAP = 5000;

/** When this server process started. */
const BOOT = Date.now();

/** Why this process booted, if it was a deploy: finish-deploy (scripts/
 *  service.mjs) writes releases/restart.json right before it restarts Roost.
 *  A marker written moments before THIS boot means the restart was that
 *  deploy -- not a crash, and not an older release. (It replaced guessing
 *  from release timestamps, which stopped working once deploys learned to
 *  wait for the turn to finish first, 2026-09-27.) */
export function deployRestart(boot = BOOT, dir = dataDir()): { commit: string; subject: string; smoke: string } | null {
  try {
    const m = JSON.parse(readFileSync(join(dir, 'releases', 'restart.json'), 'utf8'));
    const gap = boot - Date.parse(m?.at);
    if (!(gap >= 0 && gap < 3 * 60_000)) return null;
    return { commit: String(m.commit ?? ''), subject: String(m.subject ?? ''), smoke: String(m.smoke ?? '') };
  } catch {
    return null;
  }
}

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
    ask?: AskLevel;
      titleAuto?: boolean;
    jobAsk?: string;
    jobsDone?: string[];
      builder?: Builder;
    sticky?: string;
    sessionAllowedTools?: string[];
  };
  onChange?: () => void;
}

/** Called when a job's checks pass with changes (games wave 1: work earns coins). */
let onJobShipped: ((crew?: string) => void) | undefined;
export function setJobShippedHook(fn: (crew?: string) => void): void { onJobShipped = fn; }

export class Session {
  readonly id: string;
  readonly createdAt: number;
  updatedAt: number;
  title: string;
  agentSessionId?: string;
  readonly resumedFrom?: string;
  private transcript: ServerEvent[] = [];
  private readonly transcriptWriter: TranscriptWriter;
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
  /** A Proceed has been sent and the worker is building the plan. A message
   *  that arrives now is an ADDITION to the work in flight, not a new job. */
  private proceeding = false;
  /** Messages sent while the planner was still drafting. They cannot go to the
   *  worker (nothing executes before Proceed) and cannot start a second
   *  conference (one is running), so they wait, visibly, and ride the plan. */
  private held: Array<{ text: string; images?: UserImage[] }> = [];
  private activeConsult?: ConsultRun;
  /** A turn sent to a member of the OTHER vendor by name: a one-shot with its own cancel. */
  private activeMention?: AgentTaskRun;
  /** The last plan written in this session, for a handoff briefing after Proceed cleared pendingConsult. */
  private lastPlanPath?: string;
  /** A consulted plan is being built as a one-shot on the other vendor. Its
   *  own idles are not the end of the build; the gate runs when it returns. */
  private crossBuild = false;
  /** Re-sends the header meta when the "Spend it" picture changes, once a
   *  minute: it had shown one thing and never updated live (2026-09-24). */
  private surplusTimer?: ReturnType<typeof setInterval>;
  private lastSurplusKey = '';
  /** Naming after the work (naming.ts). titleAuto is false once a person types a title. */
  builder: Builder = 'auto';
  sticky?: string;
  titleAuto = true;
  jobAsk?: string;
  jobsDone: string[] = [];
  /** Tools granted "for this session" (the adapter's Set, mirrored here so a
   *  restart can hand them back instead of asking again -- 2026-09-26: approved
   *  once, then asked again the very next turn, because the restart that turn
   *  triggered reset the in-memory grant with nothing to restore it from. */
  sessionAllowedTools: string[];
  private turnTally = new TurnTally();
  /** Crew turns in the open job, and the crew's first line about it -- the
   *  name when the ask itself names nothing. */
  private jobTurns = 0;
  /** Everyone who spoke in the open job: whose gate it was (item 40). */
  private jobCrew = new Set<string>();
  private jobWork?: string;
  private lastEventTs = 0;
  /** Set by the manager: a fresh usage reading landed, so every open session
   *  re-sends its fuel and surplus instead of waiting for the minute timer. */
  onUsageRead?: () => void;
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
  /** How much the crew talks it over with you first (AskLevel). */
  ask: AskLevel = 'quick';
  /** A question from the crew waiting on your reply, if any. */
  private pendingQuestion?: { requestId: string; questions: AskQuestion[] };
  /** The approval being asked right now, for meta().needsYou. */
  private pendingApprovalId?: string;
  /** Armed offer awaiting a tap, and the pressure level we last asked at, so the
   *  card appears once per escalation instead of after every turn. */
  private contextOffer?: { reason: string; percent: number | null };
  /** Tokens the engine last said this conversation occupies. */
  private contextTokens: number | null = null;
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
  /** A large message Pip has proposed planning, waiting on Go ahead / Just chat. */
  private escalationOffer?: { text: string; reason: string; planner: string; reviewer: string };
  /** The adapter echoes a delivered message; one already echoed while it
   *  waited on Pip's question must not appear twice. */
  private echoed?: string;
  /** Why effort last moved, shown once on the next turn. */
  private effortNote?: string;
  private maxReviewRounds = 1;
  private autoProceed = false;
  private verifyAfterProceed = true;
  /** Set on Proceed; consumed when the executor's turn ends. */
  private pendingVerify?: { taskId?: string; criteria?: string[]; review: boolean };
  /** A job that edited files is checked when it ends (2026-09-25: the
   *  VERIFIED stamp never landed because direct work never ran a gate). */
  private editedThisTurn = false;
  /** The tree as it was when you last sent something (treeState.ts). */
  private treeAtTurnStart: Promise<string | null> | null = null;
  private checking = false;
  /** Bumped by every message you send, so a check that outlives its turn
   *  does not mark the next turn idle. */
  private turnSeq = 0;
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
    this.ask = opts.restore?.ask ?? 'quick';
    this.titleAuto = opts.restore?.titleAuto ?? (this.title === 'New session');
    this.builder = opts.restore?.builder ?? 'auto';
    this.sticky = opts.restore?.sticky;
    this.sessionAllowedTools = opts.restore?.sessionAllowedTools ?? [];
    this.jobAsk = opts.restore?.jobAsk;
    this.jobsDone = opts.restore?.jobsDone ?? [];
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
    // Only auto routes. A routed model restored into a chat/plan session is a
    // leftover (this is how "default" outlived a restart, item 32).
    if (!this.autoMode) this.routedModel = undefined;
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
    this.transcriptWriter = new TranscriptWriter(this.id);
    this.surplusTimer = setInterval(() => {
      const key = JSON.stringify(toSurplusInfo(quotaStore().surplus(this.agent, this.budget)));
      if (key !== this.lastSurplusKey) {
        this.lastSurplusKey = key;
        this.broadcastMeta();
      }
    }, 60_000);
    this.surplusTimer.unref?.();
    if (opts.restore) {
      // The thread as the phone last saw it, back from disk -- then a line
      // saying what happened, because a restart mid-turn ends that turn and
      // nothing else in the thread would say so.
      this.transcript = readTranscript(this.id, TRANSCRIPT_CAP);
      const cut = lastState(this.transcript) === 'working';
      const at = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const deploy = deployRestart();
      if (this.transcript.length) {
        setTimeout(() => {
          this.notice(deploy
            // The deploy now waits for the turn to finish, so the crew's own
            // reply already said what shipped; this just confirms it's live.
            ? `Deployed at ${at}: ${deploy.subject} (${deploy.commit})${deploy.smoke === 'passed' ? ' — checks passed, it\'s live.' : ' — it\'s live.'}${cut ? ' The turn that was still running was ended by the restart; if there was more to do, just say so.' : ''}`
            : cut
              ? `Roost restarted at ${at} — the turn that was running was cut off. The thread above is what happened before; say "continue" to pick it back up.`
              : `Roost restarted at ${at}. The thread above is what happened before.`);
          if (cut) this.pushEvent({ type: 'status', state: 'idle', ts: now() });
        }, 0);
      }
    }
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
      allowedTools: this.sessionAllowedTools,
      onAllowedToolsChange: (tools: string[]) => {
        this.sessionAllowedTools = tools;
        this.onChange?.(); // worth a persist -- this is exactly what must survive a restart
      },
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
        else {
          this.model = model;
          this.routedModel = undefined;
        }
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

  /** `## scene` in the project's .roost/project.md names the home-screen set
   *  this project prefers (docs/SCENES.md "scenes tied to the project"). Read
   *  when asked, never cached: the file is the person's to edit. */
  private get projectScene(): string | undefined {
    const id = loadProjectKnowledge(this.cwd).sections.scene?.trim().split(/\s+/)[0];
    return id ? id.toLowerCase() : undefined;
  }

  /** The plan changed (#44): new routes, and the next message is sized afresh. */
  applyRoutes(routes: RoostConfig['autoRoute']): void {
    this.autoRoute = routes[this.agent];
    this.otherAutoRoute = routes[this.agent === 'claude' ? 'codex' : 'claude'];
    this.standardModelFor = (a: AgentKind) => routes[a].standard.model;
    this.lastTier = undefined;
  }

  private speakingCrewName(): string | undefined {
    try { return crewMember(this.agent, this.speakingModel(), this.currentRole).name; } catch { return undefined; }
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
      scene: this.projectScene,
      escalation: this.escalationOffer ? { reason: this.escalationOffer.reason, planner: this.escalationOffer.planner, reviewer: this.escalationOffer.reviewer } : undefined,
      crew: crewMember(this.agent, this.speakingModel(), this.currentRole),
      routedModel: this.routedModel,
      consultPending: this.pendingConsult ? true : undefined,
      needsYou: this.pendingApprovalId || this.pendingQuestion || this.pendingConsult ? true : undefined,
      mode: this.mode,
      modeExplicit: this.modeExplicit || undefined,
      planPath: this.pendingConsult?.planPath,
      planHasRemainder: this.pendingConsult ? hasRemainder(this.pendingConsult) : undefined,
      builder: this.builder,
      sticky: this.sticky,
      agentSessionId: this.agentSessionId,
      resumedFrom: this.resumedFrom,
      boost: this.boost || undefined,
      contextOffer: this.contextOffer,
      recentCrew: this.recentCrew(),
      lastLine: this.lastLine(),
      autoCompact: this.autoCompact || undefined,
      ask: this.ask,
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
    if (triaged.auth) {
      // Not a routing failure: Claude is signed out. Say so where the sign-in
      // card is, and file it apart from genuine parse failures.
      noteAuthFailure(triaged.raw ?? reason);
      this.reportError(`Pip could not size this — ${triaged.raw ?? 'Claude is not signed in'}`, 'auth');
      logDecision({ kind: 'route', sessionId: this.id, stage: 'triage-auth', agent: t.agent, model: t.model, reason, raw: triaged.raw });
    } else if (triaged.raw !== undefined) {
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
    // A long conversation is never moved DOWN onto a smaller model: the whole
    // session travels with it, and Haiku answered "prompt too long" to a chat
    // that had outgrown it (2026-09-24). Past this size, stay where it fits.
    const LONG_CONVERSATION = 120_000;
    const rank = (m: string | undefined) => {
      const r = this.autoRoute;
      return m === r.heavy.model ? 2 : m === r.standard.model ? 1 : m === r.light.model ? 0 : 1;
    };
    const smaller = rank(target.model) < rank(this.routedModel ?? this.model);
    if (smaller && this.contextTokens != null && this.contextTokens > LONG_CONVERSATION) {
      const current = this.routedModel ?? this.model;
      logDecision({ kind: 'route', sessionId: this.id, stage: 'long-conversation', agent: this.agent, kept: current, wanted: target.model, tokens: this.contextTokens });
      this.notice(`Kept ${crewMember(this.agent, current, 'chat').name}: this conversation (${Math.round(this.contextTokens / 1000)}k tokens) is too long to move to a smaller model.`);
      return triaged;
    }
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
          this.effortNote = effortNoteFor(fromEffort, newEffort, effortPick.reason);
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
      const model = this.speakingModel();
      event = { ...event, crew: { ...crewMember(this.agent, model, this.currentRole), effort: this.effort || undefined, effortNote: this.effortNote } };
      this.effortNote = undefined;
    }
    if (event.type === 'user_message' && this.echoed !== undefined && event.text === this.echoed) {
      this.echoed = undefined;
      return;
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
    // Work pays too (games wave 1): a job whose checks passed earns coins and
    // may drop a crate. Set by index.ts; unset in tests.
    if (event.type === 'verify' && event.report.passed && event.report.changed) onJobShipped?.(this.speakingCrewName());
    // What's on deck for this project (#46), in the crew's own words.
    if (event.type === 'assistant_message' && event.text) {
      const next = extractOnDeck(event.text);
      if (next) noteOnDeck(this.cwd, { text: next, at: now(), crew: event.crew?.name, sessionId: this.id });
    }
    if (event.type === 'approval_request' && !event.crew) {
      // Asked in the thread as a text from whoever wants it (2026-09-25).
      event = { ...event, crew: crewMember(this.agent, this.speakingModel(), this.currentRole) };
    }
    if (event.type === 'approval_request') this.pendingApprovalId = event.requestId;
    if (event.type === 'approval_resolved' && this.pendingApprovalId === event.requestId) this.pendingApprovalId = undefined;
    if (event.type === 'status' && event.state === 'idle') this.pendingApprovalId = undefined;
    if (event.type === 'question') {
      if (!event.crew) event = { ...event, crew: crewMember(this.agent, this.speakingModel(), this.currentRole) };
      this.pendingQuestion = { requestId: event.requestId, questions: event.questions };
      if (this.sockets.size === 0) sendNotification(`question:${this.id}`, `${event.crew?.name ?? 'The crew'} has a question`, event.questions[0]?.question ?? '');
    }
    if (event.type === 'question_answered' && this.pendingQuestion?.requestId === event.requestId) this.pendingQuestion = undefined;
    if (event.type === 'tool_start' && /edit|write|patch|create|delete|rename|notebook/i.test(event.name)) this.editedThisTurn = true;
    const turnEnded = event.type === 'status' && event.state === 'idle' && !this.inNotice && !this.crossBuild;
    if (turnEnded) this.proceeding = false;
    // Did the code map earn its keep? One row per finished turn (turnStats.ts).
    this.turnTally.observe(event);
    if (turnEnded) {
      const row = this.turnTally.finish({ at: now(), sessionId: this.id, agent: this.agent, model: this.speakingModel() || undefined, mapped: true, source: 'live' });
      if (row) recordTurn(row);
    }
    if (turnEnded && !this.checking && !(this.executing && this.pendingVerify)) {
      // Did this turn change the project? Git says, however the files were
      // written; the edit-tool flag is the fallback outside a repository.
      const byTool = this.editedThisTurn;
      const before = this.treeAtTurnStart;
      this.editedThisTurn = false;
      void (async () => {
        const start = before ? await before : null;
        const end = start != null ? await treeFingerprint(this.cwd) : null;
        const changed = start != null && end != null ? start !== end : byTool;
        if (!changed) return;
        this.treeAtTurnStart = Promise.resolve(end);
        await this.autoCheck();
      })();
    }
    if (turnEnded && this.executing && this.pendingVerify) {
      const pv = this.pendingVerify;
      this.executing = false;
      this.pendingVerify = undefined;
      // Deferred a tick so this idle lands in the transcript before "Verifying…".
      setTimeout(() => void this.autoVerify(pv), 0);
    }
    // Phase 4c's last mile. The meter has been emitting pressure and advice all
    // along; nothing ever acted on it or asked. Deferred a tick so the context
    // event is in the transcript before any notice about it.
    if (event.type === 'context') this.contextTokens = event.context.usedTokens ?? this.contextTokens;
    if (event.type === 'context' && event.context.percent != null) {
      // "And afterwards, every time" (Context board): after a compaction, the
      // next real reading says where it landed, next to where it started.
      if (this.compactedFrom != null) {
        const who = crewMember(this.agent, this.routedModel ?? this.model, this.currentRole).name;
        this.notice(`${who} is at ${event.context.percent}% after compacting (was ${this.compactedFrom}%).`);
        this.compactedFrom = null;
      }
      this.contextPct = event.context.percent;
    }
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
        // 2026-09-24: with "keep doing this" remembered, the compaction ran and
        // the offer box stayed up. Only the tap path cleared it; this path
        // never did. A compaction that is happening is an offer answered.
        if (this.contextOffer) {
          this.contextOffer = undefined;
          setTimeout(() => this.broadcastMeta(), 0);
        }
        setTimeout(() => void this.runCompaction(intent.reason, 'auto'), 0);
      }
    }
    // Jobs, for the name: the open job starts at its first ask and closes when
    // its gates pass. The title follows unless a person set one. (The client
    // folds the same jobs into its own view; this only names things.)
    if (event.type === 'user_message' && event.text && !event.text.startsWith('▶') && this.jobAsk && this.jobTurns > 0
        && startsNewJob(event.text, event.ts - this.lastEventTs)) {
      // Item 31: the next task ends this job, verified or not.
      this.jobsDone.push(this.jobLabel());
      this.jobCrew.clear();
      this.jobAsk = event.text;
      this.jobWork = undefined;
      this.jobTurns = 0;
      this.retitle();
    } else if (event.type === 'user_message' && event.text && !event.text.startsWith('▶') && !this.jobAsk) {
      this.jobAsk = event.text;
      this.jobWork = undefined;
      this.jobTurns = 0;
      this.retitle();
    } else if (event.type === 'user_message' && event.text && this.jobAsk && isWeakName(jobName(this.jobAsk)) && !isWeakName(jobName(event.text))) {
      // The opener named nothing ("proceed with the remaining"); the first
      // ask that does names the job.
      this.jobAsk = event.text;
      this.retitle();
    } else if (event.type === 'verify' && event.report.passed && this.jobAsk) {
      this.jobsDone.push(this.jobLabel());
      this.jobAsk = undefined;
      this.jobTurns = 0;
      this.retitle();
    }
    if ((event.type === 'assistant_message' || event.type === 'consult') && event.crew?.name) this.jobCrew.add(event.crew.name);
    if (event.type === 'verify' && !event.report.unverified && this.jobCrew.size) {
      // The companions' diary: a gate passed or failed on THEIR job.
      noteLife({ at: event.ts, kind: 'verify', names: [...this.jobCrew], passed: event.report.passed, job: this.jobAsk ? this.jobLabel() : undefined, sessionId: this.id });
      const who = [...this.jobCrew].map((n) => this.crewByName(n)).filter((c): c is CrewInfo => !!c);
      setTimeout(() => this.celebrate(who, event.ts), 0);
      if (event.report.passed) this.jobCrew.clear();
    }
    if ((event.type === 'assistant_message' || event.type === 'consult') && event.text && this.jobAsk) {
      this.jobTurns++;
      if (!this.jobWork) {
        this.jobWork = event.text.replace(/[`*_#>]/g, '').split(/(?<=[.!?])\s|\n/)[0];
        if (isWeakName(jobName(this.jobAsk))) this.retitle();
      }
    }
    if (event.type === 'user_message' || event.type === 'assistant_message' || event.type === 'consult' || event.type === 'tool_start') {
      this.lastEventTs = event.ts;
    }
    this.transcript.push(event);
    this.transcriptWriter.append(event);
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
    if (event.type === 'status' && this.lastStatus === 'working' && event.state === 'idle') {
      void refreshUsageSoon(this.cwd).then((ran) => {
        if (ran) this.onUsageRead?.();
      });
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

  /** Re-send meta (fuel, surplus) after a reading changed underneath it. */
  refreshMeta(): void {
    this.broadcastMeta();
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
      case 'user_message': {
        // A question waiting on you: whatever you text back is the answer, the
        // way it would be in any group chat.
        if (this.pendingQuestion && msg.text?.trim()) {
          const q = this.pendingQuestion;
          const answers = Object.fromEntries(q.questions.map((x, i) => [x.question, i === 0 ? msg.text.trim() : `(answered together with the first question: ${msg.text.trim()})`]));
          if (this.adapter.answerQuestion?.(q.requestId, answers)) break;
          this.pendingQuestion = undefined;
        }
        this.turnSeq++;
        this.editedThisTurn = false;
        // Only a turn that starts from rest takes a fresh reading: a message
        // that joins a running turn keeps the turn's starting point.
        if (this.lastStatus !== 'working' || !this.treeAtTurnStart) this.treeAtTurnStart = treeFingerprint(this.cwd);
        // Recovered 2026-09-24: a message sent while a plan was being built
        // ("Don't stop your initial plan, these are additions") was triaged by
        // Pip and then never delivered anywhere -- it survives only inside the
        // triage prompt. Every path below now ends in one of three visible
        // outcomes: delivered to the worker, held with a notice, or an error
        // that names the message as undelivered. Never silence.
        if (this.escalationOffer) {
          // A new message while Pip's question waits answers it: just chat.
          await this.answerEscalation(false, 'lapsed');
        }
        if (this.proceeding) {
          // The worker is mid-build. This joins the turn -- which is what the
          // composer has promised all along.
          await this.deliver(msg.text, msg.images);
          break;
        }
        {
          // "@Nell, look at this": the names are the interface. Same vendor:
          // this session switches to that member's model for the turn. Other
          // vendor: a one-shot on that vendor, with the recent conversation as
          // context, landing in the thread as that member's turn.
          const mention = parseMention(msg.text, [...allPersonas().map((p) => p.name), 'Pip']);
          if (mention?.name === 'Pip') {
            // @Pip hands routing back to the dispatcher.
            this.sticky = undefined;
            this.onChange?.();
            this.broadcastMeta();
          } else if (mention) {
            // Asked for by name, and kept: "I @Ollie on purpose... if I reply
            // again without the @, it just goes to Pip" (2026-09-24).
            this.sticky = mention.name;
            this.onChange?.();
            await this.askByName(mention.name, mention.text, msg.images, 'mention');
            break;
          } else if (this.sticky) {
            await this.askByName(this.sticky, msg.text, msg.images, 'mention', undefined, true);
            break;
          }
        }
        if (this.mode === 'plan' || this.mode === 'build') {
          if (this.consultRunning) {
            this.hold(msg.text, msg.images);
            break;
          }
          // Plan: a plan file, nothing executes. Build: the full conference,
          // then the Proceed gate (or autoProceed, off by default).
          await this.runConsult(msg.text, { planOnly: this.mode === 'plan' });
          break;
        }
        let triaged: TriageResult | null = null;
        if (this.autoMode) {
          // Routing is advice about WHERE to send; it must never decide WHETHER.
          try {
            triaged = await this.routeFor(msg.text);
          } catch (err: any) {
            this.reportError(`Routing failed (${String(err?.message ?? err)}) — sending on the current model.`);
          }
        }
        // A large task is where the conference earns its keep -- the same
        // size gate that skips ceremony on small work, read the other way.
        // Nothing executes without Proceed, so this costs a plan and a
        // review, not control.
        // Pip proposes, you dispose (Control board): he says it out loud and
        // waits. It used to start the plan and review at once -- the expensive
        // crew already running by the time you could say no.
        if (this.escalate && triaged?.size === 'large' && !this.consultRunning && !msg.images?.length) {
          const other: AgentKind = this.agent === 'claude' ? 'codex' : 'claude';
          const planner = crewMember(this.agent, this.routedModel ?? this.standardModelFor(this.agent), 'planner').name;
          const reviewer = crewMember(other, this.standardModelFor(other), 'reviewer').name;
          this.escalationOffer = { text: msg.text, reason: triaged.reason, planner, reviewer };
          this.pushEvent({ type: 'user_message', text: msg.text, imageCount: 0, ts: now() });
          logDecision({ kind: 'review', sessionId: this.id, stage: 'escalate', action: 'offered', tier: triaged.tier, size: triaged.size, reason: triaged.reason });
          this.pushEvent({ type: 'status', state: 'idle', ts: now() });
          this.broadcastMeta();
          break;
        }
        await this.deliver(msg.text, msg.images);
        break;
      }
      case 'question_answer': {
        const q = this.pendingQuestion;
        if (!q || q.requestId !== msg.requestId) break;
        const answers = msg.answers && typeof msg.answers === 'object' ? Object.fromEntries(Object.entries(msg.answers).map(([k, v]) => [String(k), String(v)])) : null;
        if (!this.adapter.answerQuestion?.(msg.requestId, answers)) this.pendingQuestion = undefined;
        break;
      }
      case 'set_ask': {
        const a = msg.ask;
        if (a !== 'off' && a !== 'quick' && a !== 'talk' && a !== 'grill') break;
        this.ask = a;
        logDecision({ kind: 'gate', sessionId: this.id, rule: 'ask', action: a });
        this.broadcastMeta();
        break;
      }
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
          this.titleAuto = false;
          this.onChange?.();
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
        this.activeMention?.cancel();
        await this.adapter.interrupt();
        break;
      case 'consult':
        await this.runConsult(msg.text);
        break;
      case 'consult_proceed': {
        const consult = this.pendingConsult;
        if (!consult) break;
        this.pendingConsult = undefined;
        // Recovered 2026-09-24: "there was also a delay when I clicked
        // proceed." The bar stayed up, dead, through a whole triage round
        // trip, because the cleared pendingConsult was not broadcast until
        // after the send. Say it left, now; then route.
        this.broadcastMeta();
        if (this.autoMode) {
          try {
            await this.routeFor(consult.task);
          } catch (err: any) {
            this.reportError(`Routing failed (${String(err?.message ?? err)}) — proceeding on the current model.`);
          }
        }
        // Verification runs when this turn ends: gates always, the diff
        // reviewer in build mode. Armed here, fired from pushEvent on the
        // idle that ends the build -- the adapter's, or the one-shot's.
        if (this.verifyAfterProceed) {
          this.pendingVerify = { taskId: consult.taskId, criteria: consult.criteria, review: this.mode === 'build' };
          this.executing = true;
        }
        const prompt = composeProceedPrompt(consult.task, consult.plan, consult.critique, consult.criteria ?? []);
        const display = `▶ Proceed with the consulted plan: ${truncate(consult.task, 120)}`;
        // Item 23 (2026-09-24): "if Claude builds and Codex only reviews, the
        // Codex subscription is wasted." The builder is the vendor with more
        // headroom unless the person named one. The other vendor builds as a
        // one-shot briefed with the plan; the gates run on it the same way.
        const pick = this.chooseBuilder();
        logDecision({ kind: 'route', sessionId: this.id, stage: 'build', agent: pick.agent, builder: this.builder, reason: pick.reason });
        if (pick.agent !== this.agent) {
          const name = personaFor(pick.agent, this.otherAutoRoute.heavy.model).name;
          this.notice(`Pip sent the build to ${name} on ${pick.agent} — ${pick.reason}.`);
          this.proceeding = true;
          this.crossBuild = true;
          try {
            await this.askByName(name, display, undefined, 'build', prompt);
          } finally {
            this.crossBuild = false;
            this.proceeding = false;
          }
          const pv = this.pendingVerify;
          if (this.executing && pv) {
            this.executing = false;
            this.pendingVerify = undefined;
            await this.autoVerify(pv);
          }
          break;
        }
        await this.adapter.sendUserMessage(prompt, undefined, display);
        this.proceeding = true;
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
          if (report.passed) await this.autoCommitIfDirty();
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
        // Leaving plan mode lifts the look-don't-touch it put on a named crew member (#37).
        if (m !== 'plan') await this.adapter.setReadOnly?.(false);
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
        if (msg.action === 'handoff') {
          // Phase 4c's "fresh session seeded from the plan file", as a turn:
          // the other vendor's flagship (or a named member) is briefed from
          // the plan and the recent thread and continues the job with a clean
          // window. This session's own context is left as it is.
          this.contextOffer = undefined;
          this.broadcastMeta();
          const other = this.agent === 'claude' ? 'codex' : 'claude';
          const to = msg.to ?? personaFor(other, this.otherAutoRoute.heavy.model).name;
          logDecision({ kind: 'gate', sessionId: this.id, rule: 'compact', action: 'handoff', agent: this.agent, to });
          await this.askByName(to, '', undefined, 'handoff');
          break;
        }
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
      case 'set_sticky':
        this.sticky = msg.name ?? undefined;
        this.onChange?.();
        this.broadcastMeta();
        break;
      case 'set_builder':
        this.builder = msg.builder;
        this.onChange?.();
        this.broadcastMeta();
        break;
      case 'park_remainder': {
        // The planner's Fit section named a Remainder that will not fit the
        // window. Park it in the project's ROADMAP.md, dated, with the task,
        // so it is not lost when the first slice ships.
        const c = this.pendingConsult;
        const rem = c ? remainderOf(c) : null;
        if (!c || !rem) {
          this.notice('The plan names no remainder to park.');
          break;
        }
        const file = join(this.cwd, 'ROADMAP.md');
        const stamp = new Date().toISOString().slice(0, 10);
        const block = `\n\n## Parked ${stamp} — ${truncate(c.task, 80)}\n\n${rem.trim()}\n`;
        try {
          appendFileSync(file, (existsSync(file) ? '' : '# Roadmap\n') + block);
          this.notice(`Parked the remainder in ${pathParts(file).slice(-2).join('/')}.`);
          logDecision({ kind: 'review', sessionId: this.id, stage: 'park', taskId: c.taskId });
        } catch (err: any) {
          this.reportError(`Could not park the remainder (${String(err?.message ?? err)}).`);
        }
        break;
      }
      case 'consult_dismiss':
        this.pendingConsult = undefined;
        this.broadcastMeta();
        break;
      case 'escalation_response':
        await this.answerEscalation(!!msg.go, msg.go ? 'accepted' : 'declined');
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
      this.reportError(`${this.agent} ${h.reason}.`, 'gate');
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
      this.activeConsult = startConsultStep(this.agent, this.cwd, composePlannerPrompt(task, context, this.fuelNote()), plannerModel, 'plan', (d) => this.ledgerCall(d, 'plan'));
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
        this.lastPlanPath = path;
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
      this.lastPlanPath = path;
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
    // Anything sent while the planner was drafting rides the plan from here:
    // folded into the task so Proceed carries it, and said out loud so the
    // person reviewing the plan knows their additions are in it.
    if (this.held.length) {
      const held = this.held.splice(0);
      const additions = held.map((h) => h.text).filter(Boolean);
      if (this.pendingConsult && additions.length) {
        this.pendingConsult.task += `\n\nAdditions sent while planning:\n${additions.map((a) => `- ${a}`).join('\n')}`;
        this.notice(`${additions.length === 1 ? 'Your addition' : `${additions.length} additions`} sent while planning will go with the plan when you tap Proceed.`);
      } else if (additions.length) {
        // No plan to ride -- the consult failed or was cancelled. Start again
        // with the additions as the task, rather than dropping them.
        await this.runConsult(additions.join('\n\n'), opts);
        return;
      }
    }
    if (this.autoProceed && this.mode === 'build' && this.pendingConsult && !opts.planOnly) {
      await this.handleClientMessage({ type: 'consult_proceed' });
    }
  }

  /** Who builds a consulted plan (item 23). A named vendor wins when it is
   *  present; 'auto' takes the other vendor only when its headroom is
   *  strictly better and known -- missing data is never a reason to move. */
  chooseBuilder(): { agent: AgentKind; reason: string } {
    const other: AgentKind = this.agent === 'claude' ? 'codex' : 'claude';
    const mine = this.vendorState(this.agent);
    const theirs = this.vendorState(other);
    if (this.builder !== 'auto') {
      if (this.builder === this.agent) return { agent: this.agent, reason: `you chose ${this.agent}` };
      if (theirs.presence === 'absent') return { agent: this.agent, reason: `you chose ${other}, but it is not signed in` };
      return { agent: other, reason: `you chose ${other}` };
    }
    const rank: Record<string, number> = { room: 0, tight: 1, unknown: 2, stale: 2, gated: 3, exhausted: 4 };
    const a = rank[mine.headroom.state] ?? 2;
    const b = rank[theirs.headroom.state] ?? 2;
    const known = theirs.headroom.state === 'room' || theirs.headroom.state === 'tight';
    if (theirs.presence !== 'absent' && known && b < a) {
      return { agent: other, reason: `${this.agent} is ${mine.headroom.state} (${mine.headroom.reason}); ${other} has ${theirs.headroom.state === 'room' ? 'room' : 'more room'}` };
    }
    return { agent: this.agent, reason: mine.headroom.state === 'room' ? `${this.agent} has room` : `no better-known headroom elsewhere` };
  }

  /** Send a turn to a crew member by name. `promptOverride` carries a
   *  composed brief (a Proceed) instead of the person's text. */
  private async askByName(name: string, text: string, images: UserImage[] | undefined, how: 'mention' | 'handoff' | 'build', promptOverride?: string, quiet = false): Promise<void> {
    const persona = allPersonas().find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (!persona) {
      this.reportError(`No crew member called ${name}.`);
      return;
    }
    const suite: AgentKind = persona.suite ?? this.agent;
    if (!quiet) noteLife({ at: Date.now(), kind: 'asked', names: [name], sessionId: this.id });
    const route = suite === this.agent ? this.autoRoute : this.otherAutoRoute;
    const { model, exact } = modelForPersona(persona, suite, modelRegistry().all(), route);
    if (!exact) this.notice(`${name}'s usual model is not in the roster right now — using ${model}.`);

    // Plan mode wins (#37, decided 2026-09-29): a name you asked for still
    // answers, but in plan mode they plan and wait for your go -- nothing is
    // edited or run. It used to route around plan mode, with full auto on.
    const planOnly = this.mode === 'plan' && how === 'mention';
    if (suite === this.agent && how === 'mention') await this.adapter.setReadOnly?.(planOnly);
    const planHint = planOnly ? "(Plan mode is on: read and think, then reply with a plan. Don't edit files or run anything that changes the project — wait for the owner to say go.)" : '';
    if (suite === this.agent && how === 'mention') {
      // Same vendor: this session becomes theirs for the turn. Auto mode
      // re-triages on the next message (lastTier cleared).
      if (model !== (this.autoMode ? this.routedModel ?? this.model : this.model)) {
        await this.adapter.setModel(model);
        // Outside auto there is no routed model -- the session's own model is
        // what changed. Writing routedModel here left a stale one behind that
        // every later reply was signed from.
        if (this.autoMode) this.routedModel = model;
        else this.model = model;
        this.lastTier = undefined;
      }
      if (!quiet) this.notice(`${name} takes this one — you asked by name.${planOnly ? ' Plan mode: they plan, nothing changes until you say go.' : ''}`);
      await this.deliver(text, images, planHint);
      return;
    }

    // Other vendor (or a handoff): a one-shot on that vendor, with the recent
    // thread as context. It lands as that member's turn. Images cannot travel
    // this way yet; say so rather than drop them silently.
    // Images travel with the prompt on both vendors (dispatch.ts localImages /
    // base64 blocks) -- the old notice that they could not is gone for good.
    const member = crewMember(suite, model, how === 'mention' ? 'chat' : 'executor');
    const context = this.transcript
      .filter((e) => e.type === 'user_message' || e.type === 'assistant_message' || e.type === 'consult')
      .slice(how === 'handoff' ? -12 : -6)
      .map((e: any) => `${e.type === 'user_message' ? 'User' : (e.crew?.name ?? 'Agent')}: ${truncate(e.text, how === 'handoff' ? 500 : 300)}`)
      .join('\n');
    if (text || images?.length) this.pushEvent({ type: 'user_message', text, imageCount: images?.length ?? 0, ts: now() });
    const fromMember = crewMember(this.agent, this.routedModel ?? this.model, this.currentRole);
    const from = fromMember.name;
    const prompt = promptOverride ?? (how === 'handoff'
      ? composeHandoffPrompt(name, from, context, this.pendingConsult?.planPath ?? this.lastPlanPath)
      : composeMentionPrompt(name, planHint ? `${text}\n\n${planHint}` : text, context)) + (how === 'mention' && askGuidance(this.ask) ? `\n\n${askGuidance(this.ask)}` : '');
    this.pushEvent({ type: 'status', state: 'working', message: how === 'handoff' ? `${name} is picking the job up from ${from}…` : how === 'build' ? `${name} is building the plan…` : `${name} is on it…`, crew: member, ts: now() });
    const run = runAgentTask({
      agent: suite, model, prompt, images, cwd: this.cwd, capability: planOnly ? 'read-only' : 'all', role: how, persona: name,
      timeoutMs: 20 * 60_000, maxChars: 24_000, onCall: (d) => this.ledgerCall(d, how),
    });
    this.activeMention = run;
    try {
      const r = await run.promise;
      // A handoff names who stepped back as well as who stepped in, so the
      // thread can show the pass itself (§12a) rather than a lone new face.
      this.pushEvent({ type: 'consult', phase: how === 'build' ? 'handoff' : how, agent: suite, crew: member, from: how === 'handoff' ? fromMember : undefined, text: sanitizeAgentOutput(r.text).text, ts: now() });
      logDecision({ kind: 'dispatch', sessionId: this.id, stage: how, agent: suite, model, persona: name, ms: r.ms });
    } catch (err: any) {
      // A quota refusal is not a crash — it should look refused, not read like
      // one (§12a). The gate already logged why; the person just needs to see it.
      if (isGateRefusal(err)) this.reportError(`${name}: ${err.message}`, 'gate');
      else this.reportError(`${name} could not take this (${String(err?.message ?? err)}).`);
    } finally {
      if (this.activeMention === run) this.activeMention = undefined;
      this.pushEvent({ type: 'status', state: 'idle', ts: now() });
      this.broadcastMeta();
    }
  }

  /** What the planner is told about fuel, so a plan can be sized to what is
   *  left. 2026-09-24: "Pip and Ollie make a plan. They recognise this may
   *  push us to the session limit. Then we check if Codex can continue; if
   *  not, propose slicing the plan, or park the rest on the roadmap." Read
   *  from the same store the gauge reads; never a guess, and absent when the
   *  store has nothing fresh. */
  private fuelNote(): string {
    const lines: string[] = [];
    for (const agent of ['claude', 'codex'] as AgentKind[]) {
      const h = quotaStore().headroom(agent, this.budget);
      if (h.state === 'unknown' || h.state === 'stale' || h.worstPercent == null) continue;
      const w = h.worstWindow;
      const mins = w?.resetsAt ? Math.max(0, Math.round((w.resetsAt - now()) / 60_000)) : null;
      const when = mins == null ? '' : mins >= 60 ? `, resets in ${Math.floor(mins / 60)}h ${mins % 60}m` : `, resets in ${mins}m`;
      lines.push(`${agent}${agent === this.agent ? ' (this session)' : ''}: ${w?.label ?? 'window'} ${h.worstPercent}% used${when} — ${h.state}`);
    }
    return lines.join('\n');
  }

  /** The model that is actually speaking, as a persona sees it: routed in
   *  auto, the session's own model otherwise -- and an alias ("default",
   *  "opus") read through to what the engine resolved it to, so one model is
   *  one name everywhere (item 32). */
  private speakingModel(): string {
    const m = this.autoMode ? this.routedModel ?? this.standardModelFor(this.agent) : this.model || this.standardModelFor(this.agent);
    const card = modelRegistry().get(this.agent, m);
    return card?.resolvedId || m;
  }

  /** Moments (item 40): after a call or a gate result, compare each member's
   *  record with and without the event that just landed. A level or a
   *  milestone crossed by THIS event is said in the thread; history never is,
   *  so replaying a session or restarting the server celebrates nothing. */
  private celebrate(members: CrewInfo[], eventAt?: number): void {
    try {
      const ledger = readLedgerRows();
      const life = readLife();
      const now = Date.now();
      const last = ledger[ledger.length - 1]?.at;
      for (const m of members) {
        const input = { names: [m.name], now, working: new Set<string>(), usedPercent: () => ({ percent: null, vendor: '' }) };
        // "Before" drops the newest record: the gate that just landed, or the call just written.
        const before = companionFor(m.name, {
          ...input,
          ledger: eventAt == null ? ledger.filter((r) => !(r.at === last && r.persona === m.name)) : ledger,
          life: eventAt == null ? life : life.filter((e) => e.at !== eventAt),
        });
        const after = companionFor(m.name, { ...input, ledger, life });
        if (after.level > before.level) {
          this.pushEvent({ type: 'milestone', crew: m, label: `Level ${after.level}`, detail: `${m.name} reached level ${after.level}.`, level: after.level, ts: now });
        }
        for (const ms of after.milestones) {
          if (ms.earnedAt && !before.milestones.find((b) => b.id === ms.id)?.earnedAt) {
            this.pushEvent({ type: 'milestone', crew: m, label: ms.label, detail: `${m.name} earned ${ms.label} — ${ms.how}.`, ts: now });
          }
        }
      }
    } catch {
      /* a celebration must never cost a turn */
    }
  }

  private crewByName(name: string): CrewInfo | undefined {
    for (let i = this.transcript.length - 1; i >= 0; i--) {
      const c = (this.transcript[i] as any).crew as CrewInfo | undefined;
      if (c?.name === name) return c;
    }
    return undefined;
  }

  /** The open job's name: the ask, or -- when the ask names nothing -- the
   *  crew's first line about the work. The same rule the board uses. */
  private jobLabel(): string {
    const ask = this.jobAsk ? jobName(this.jobAsk) : '';
    if (ask && !isWeakName(ask)) return ask;
    const work = this.jobWork ? jobName(this.jobWork) : '';
    return work && !isWeakName(work) ? work : ask || 'Untitled job';
  }

  private retitle(): void {
    if (!this.titleAuto) return;
    const next = autoTitle(this.jobAsk ? this.jobLabel() : undefined, this.jobsDone, 60, true);
    if (next === this.title) return;
    this.title = next;
    this.onChange?.();
    setTimeout(() => this.broadcastMeta(), 0);
  }

  private async answerEscalation(go: boolean, how: 'accepted' | 'declined' | 'lapsed'): Promise<void> {
    const offer = this.escalationOffer;
    if (!offer) return;
    this.escalationOffer = undefined;
    this.broadcastMeta();
    logDecision({ kind: 'review', sessionId: this.id, stage: 'escalate', action: how });
    if (go) {
      await this.runConsult(offer.text);
    } else {
      this.echoed = offer.text;
      await this.deliver(offer.text);
    }
  }

  private async deliver(text: string, images?: UserImage[], extra = ''): Promise<void> {
    const note = [askGuidance(this.ask), extra].filter(Boolean).join('\n\n');
    await this.adapter.sendUserMessage(note ? `${text}\n\n${note}` : text, images, note ? text : undefined);
    this.broadcastMeta();
  }

  private hold(text: string, images?: UserImage[]): void {
    this.held.push({ text, images });
    // Echoed into the thread so it is visibly received, with what happens next.
    this.pushEvent({ type: 'user_message', text, imageCount: images?.length ?? 0, ts: now() });
    const planner = crewMember(this.agent, this.routedModel ?? this.standardModelFor(this.agent), 'planner').name;
    this.notice(`${planner} is still drafting the plan — this will go with it when you tap Proceed.`);
  }

  /** Runs when the executor's turn ends after a Proceed: the project gates,
   *  and in build mode the fresh-context diff reviewer with the criteria. */
  /** After a turn that edited files: run the project's own checks -- its
   *  `## gates`, else what deploy detection reads as its check (tests, else a
   *  build, else a typecheck). Commands only, never a model: no quota. A
   *  project with no check at all is left alone rather than stamped "not
   *  verified" after every edit. The result is the thread's verify row, which
   *  the phase bar reads -- a pass is the VERIFIED stamp. */
  private async autoCheck(): Promise<void> {
    if (this.checking) return;
    const gates = gatesFrom(loadProjectKnowledge(this.cwd));
    const fallback = gates.length ? null : detectCheck(this.cwd).check;
    const checks = gates.length ? undefined : fallback ? [fallback] : null;
    if (checks === null) return;
    this.checking = true;
    const seq = this.turnSeq;
    this.pushEvent({ type: 'status', state: 'working', message: 'Checking the work — running the project gates…', ts: now() });
    try {
      const report = await verifyTask({ cwd: this.cwd, taskId: this.id, fingerprintAtStart: this.gateFingerprintAtStart, checks });
      this.pushEvent({ type: 'verify', report: { ...report, changed: true }, ts: now() });
      if (report.passed) await this.autoCommitIfDirty();
      if (this.sockets.size === 0 && !report.passed) sendNotification(`verify:${this.id}`, `Checks failed · ${this.title}`, report.summary);
    } catch (err: any) {
      this.reportError(`The checks failed to run: ${String(err?.message ?? err)}`);
    } finally {
      this.checking = false;
      // A new turn may have started while the checks ran; it owns the status.
      if (seq === this.turnSeq) this.pushEvent({ type: 'status', state: 'idle', ts: now() });
    }
  }

  /** A passing check used to leave the work sitting uncommitted until you
   *  opened the Changes sheet yourself -- the actual cause of "I coded and
   *  said deploy and it wasn't committing" (2026-09-25). Once the gates
   *  pass, commit whatever the agent left dirty, with the job's own name as
   *  the message. A crew member that already committed its own work leaves
   *  nothing dirty here, so this is a backstop, not a second commit. */
  private async autoCommitIfDirty(): Promise<void> {
    try {
      const status = await getGitStatus(this.cwd);
      if (!status.isRepo || !status.files.length) return;
      const message = this.jobLabel();
      // Who did it, in the commit itself -- the project's history (the Map)
      // shows their faces; transcripts don't outlive sessions, git does.
      const crew = [...this.jobCrew];
      const out = await gitCommit(this.cwd, crew.length ? `${message}\n\nRoost-Crew: ${crew.join(', ')}` : message);
      this.notice(`Committed: ${message} — ${out.split('\n')[0]}`);
    } catch (err: any) {
      this.notice(`Passed, but couldn't commit: ${String(err?.message ?? err)}`);
    }
  }

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
      if (report.passed) await this.autoCommitIfDirty();
      if (this.sockets.size === 0) sendNotification(`verify:${this.id}`, `${report.passed ? 'Verified' : report.unverified ? 'Not verified' : 'Verification FAILED'} · ${this.title}`, report.summary);
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
    this.celebrate([crewMember(d.agent, d.model, Session.LEDGER_ROLE[role] ?? 'executor')]);
  }

  /** Compacts the engine's context and says so. Never silent: the meter is about
   *  to drop a long way, and an unexplained drop looks like lost work.
   *
   *  A failure is reported rather than swallowed. Compaction is the one advisory
   *  action that changes the engine's state, so "we tried and it didn't happen"
   *  is information the person needs -- the alternative is a context that keeps
   *  degrading behind a UI that claims it was handled. */
  private contextPct: number | null = null;
  private compactedFrom: number | null = null;

  private async runCompaction(why: string, how: 'auto' | 'accepted' | 'accepted-remembered'): Promise<void> {
    try {
      const at = this.contextPct;
      const res = await this.adapter.compact();
      this.compactedFrom = at;
      // Belt and braces: whatever path got here, the offer it answers is gone.
      if (this.contextOffer) {
        this.contextOffer = undefined;
        this.broadcastMeta();
      }
      // Automatic never means silent: it says what it did and what went.
      const who = crewMember(this.agent, this.routedModel ?? this.model, this.currentRole).name;
      const where = at != null ? ` at ${at}%` : '';
      this.notice(
        `${how === 'auto' ? 'Compacted automatically' : 'Compacted'}${where} — ${why}. What ${who} remembers of the older turns is now a summary; your view of the thread is unchanged.` +
          (how === 'auto' ? ' Turn this off in the context meter.' : ''),
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
  /** True while a notice is being pushed. A notice repeats the current state
   *  (often 'idle') to carry its message, so it must never be read as "the
   *  turn just ended" -- 2026-09-24 it fired the gate the instant Proceed
   *  handed a build to another vendor, 63s before the build finished. */
  private inNotice = false;
  /** The status event's message is the transient "doing now" line under the
   *  sprite -- the next status event with no message of its own erases it,
   *  often within seconds. A notice is worth keeping, so it ALSO lands as its
   *  own permanent item in the thread (2026-09-26: "you never sent me a
   *  message" -- true, this text used to only ever pass through the line
   *  that erases itself). */
  notice(message: string) {
    this.inNotice = true;
    try {
      this.pushEvent({ type: 'status', state: this.lastStatus, message, ts: now() });
      this.pushEvent({ type: 'notice', text: message, ts: now() });
    } finally {
      this.inNotice = false;
    }
  }

  reportError(message: string, code?: 'auth' | 'context' | 'gate') {
    this.pushEvent({ type: 'error', message, code, ts: now() });
  }

  /** Closes the underlying agent process and every attached socket. `reason` reaches the
   *  client as the WebSocket close reason (code 4010) so the UI can explain why, instead
   *  of the socket just silently dying and retrying forever. */
  /** `forget` removes the on-disk thread too: a session closed on purpose is
   *  gone; one lost to a restart is not, and is read back by restore(). */
  dispose(reason = 'Closed', opts: { forget?: boolean } = {}) {
    if (this.surplusTimer) clearInterval(this.surplusTimer);
    this.adapter.dispose();
    for (const ws of this.sockets) ws.close(4010, reason);
    this.sockets.clear();
    this.transcriptWriter.flush();
    if (opts.forget) removeTranscript(this.id);
  }

  /** For shutdown: write what is buffered, keep the file. */
  flushTranscript(): void {
    this.transcriptWriter.flush();
  }
}

function toSurplusInfo(s: Surplus | null): SurplusInfo | null {
  if (!s) return null;
  const weekly = quotaStore()
    .windows(s.agent)
    .filter((w) => (w.windowDurationMins ?? 0) >= 7 * 24 * 60)
    .map((w) => ({ label: w.label, usedPercent: w.usedPercent, resetsAt: w.resetsAt ?? null }));
  return { agent: s.agent, label: s.window.label, minutesLeft: s.minutesLeft, headroomPct: s.headroomPct, resetsAt: s.window.resetsAt ?? undefined, weekly };
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
  ask?: AskLevel;
  autoCompact?: boolean;
  builder?: Builder;
  sticky?: string;
  titleAuto?: boolean;
  jobAsk?: string;
  jobsDone?: string[];
  sessionAllowedTools?: string[];
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
        session.dispose(`Closed automatically after ${hours}h of inactivity`, { forget: true });
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
    for (const s of this.sessions.values()) s.flushTranscript?.();
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
      ask: s.ask,
      titleAuto: s.titleAuto,
      builder: s.builder,
      sticky: s.sticky,
      jobAsk: s.jobAsk,
      jobsDone: s.jobsDone,
      sessionAllowedTools: s.sessionAllowedTools,
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
            autoCompact: entry.autoCompact,
            ask: entry.ask,
            titleAuto: entry.titleAuto,
            builder: entry.builder,
            sticky: entry.sticky,
            jobAsk: entry.jobAsk,
            jobsDone: entry.jobsDone,
            sessionAllowedTools: entry.sessionAllowedTools,
          },
          onChange: () => this.scheduleSave(),
        });
        this.sessions.set(session.id, session);
        session.onUsageRead = () => this.fuelChanged();
        restored++;
      } catch (err: any) {
        console.warn(`[roost] failed to restore session ${entry.id}:`, String(err?.message ?? err));
      }
    }
    if (restored > 0) console.log(`[roost] restored ${restored} session(s) from before restart`);
    this.saveNow();
  }

  /** A usage reading landed: every open session re-sends its fuel now. */
  private fuelChanged(): void {
    for (const s of this.sessions.values()) s.refreshMeta();
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
    session.onUsageRead = () => this.fuelChanged();
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

  /** A new plan's ladder (#44) reaches open chats too, from their next message. */
  applyRoutes(routes: RoostConfig['autoRoute']): void {
    for (const s of this.sessions.values()) s.applyRoutes(routes);
  }

  list(): SessionMeta[] {
    return [...this.sessions.values()].map((s) => s.meta()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  close(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.dispose('Closed', { forget: true });
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

/** The planner's "Remainder": the part of a Fit section it said will not
 *  fit the window. Looked for in the reconciled plan first, then the plan. */
function remainderOf(c: ConsultState): string | null {
  for (const text of [c.plan]) {
    const m = text.match(/(?:^|\n)\s*(?:#{1,4}\s*|\*\*)?Remainder\b[:*\s—-]*\n?([\s\S]*?)(?=\n\s*(?:#{1,4}\s|\*\*[A-Z])|$)/i);
    if (m && m[1].trim()) return m[1];
  }
  return null;
}
function hasRemainder(c: ConsultState): boolean {
  return remainderOf(c) !== null;
}

const EFFORT_RANK: Record<string, number> = { minimal: 0, low: 1, medium: 2, high: 3, xhigh: 4, max: 5, ultra: 6 };

/** "Stepped down from xhigh. Quota is tight, …" -- the Control board's line
 *  under the name, on the first turn after effort moved. */
export function effortNoteFor(from: string | null, to: string, reason: string): string {
  const why = reason ? reason.charAt(0).toUpperCase() + reason.slice(1) : '';
  const a = from ? EFFORT_RANK[from] : undefined;
  const b = EFFORT_RANK[to];
  const step = a === undefined || b === undefined ? '' : b < a ? `Stepped down from ${from}.` : b > a ? `Stepped up from ${from}.` : '';
  return [step, why ? `${why}.` : ''].filter(Boolean).join(' ').replace(/\.\.$/, '.');
}
