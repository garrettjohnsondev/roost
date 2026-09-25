// Shared wire protocol between the Roost server and the phone UI.
// The web app keeps a mirrored copy in web/src/types.ts.

export type AgentKind = 'claude' | 'codex';

/** Generic approval posture, mapped per-agent:
 *  claude: ask -> 'default', auto-edits -> 'acceptEdits', full-auto -> 'bypassPermissions'
 *  codex:  ask -> 'on-request', auto-edits -> 'on-request', full-auto -> 'never'
 */
export type ApprovalSetting = 'ask' | 'auto-edits' | 'full-auto';

export interface UserImage {
  mediaType: string; // e.g. image/png
  data: string; // base64, no data: prefix
}

/** chat: one agent, no ceremony. auto: triage picks model and effort per message.
 *  plan: read-only, every message yields a plan file. build: the full conference. */
export type SessionMode = 'chat' | 'auto' | 'plan' | 'build';

/** A conference turn, or a turn from a member asked for by name ('mention'),
 *  or the briefing-and-continue turn when a full context hands the job to a
 *  fresh one ('handoff'). */
/** Who executes a consulted plan: the vendor with more headroom ('auto'), or
 *  a named vendor. A session is bound to one adapter; the other vendor builds
 *  as a one-shot with the plan as its brief. */
export type Builder = 'auto' | 'claude' | 'codex';

export type ConsultPhase = 'plan' | 'critique' | 'reconcile' | 'mention' | 'handoff';

export type ClientMessage =
  | { type: 'user_message'; text: string; images?: UserImage[] }
  | { type: 'approval_response'; requestId: string; decision: 'allow' | 'allow-session' | 'deny' }
  | { type: 'set_model'; model: string }
  | { type: 'set_effort'; effort: string }
  | { type: 'set_approvals'; approvals: ApprovalSetting }
  | { type: 'set_title'; title: string }
  | { type: 'consult'; text: string }
  | { type: 'consult_proceed' }
  | { type: 'consult_dismiss' }
  /** Pip proposes, you dispose: go ahead with the plan-and-review, or just chat. */
  | { type: 'escalation_response'; go: boolean }
  | { type: 'set_boost'; on: boolean }
  | { type: 'verify'; review?: boolean; criteria?: string }
  | { type: 'set_mode'; mode: SessionMode }
  | { type: 'set_builder'; builder: Builder }
  | { type: 'park_remainder' }
  | { type: 'set_sticky'; name: string | null }
  | { type: 'context_action'; action: 'compact' | 'handoff'; remember?: boolean; to?: string }
  | { type: 'context_dismiss' }
  | { type: 'set_auto_compact'; on: boolean }
  | { type: 'interrupt' };

/** Expanded detail for a tool call, shown when the user taps its chip. */
export interface ToolExpand {
  path?: string;
  before?: string;
  after?: string;
  raw?: string;
}

/** A window about to reset with capacity left -- the "spend it before it
 *  resets" banner. */
export interface SurplusInfo {
  agent: AgentKind;
  label: string;
  minutesLeft: number;
  headroomPct: number;
  /** Epoch ms, so the countdown can tick on the phone between broadcasts. */
  resetsAt?: number;
  /** Every weekly window for this vendor -- for Claude, all-models AND the
   *  Fable-scoped one -- so the card shows the whole week, not one number. */
  weekly?: Array<{ label: string; usedPercent: number | null; resetsAt: number | null }>;
}

/** One gate command the harness ran: command, exit code and output. Evidence,
 *  never a claim. */
export interface EvidenceRecord {
  command: string;
  cwd: string;
  exitCode: number | null;
  signal?: string | null;
  stdoutTail: string;
  stderrTail: string;
  ms: number;
  startedAt: number;
  timedOut: boolean;
}

export interface ImageCheck {
  path: string;
  ok: boolean;
  reason: string;
  bytes: number | null;
  uniqueColours: number | null;
  sha?: string;
}

export interface VerifyReport {
  taskId?: string;
  passed: boolean;
  /** Nothing was checked: the project defines no gates and no images were
   *  given. Not a pass, and not a failure either -- shown as NOT VERIFIED. */
  unverified?: boolean;
  /** The gate definitions changed during the task -- the result cannot be trusted. */
  tampered: boolean;
  gates: EvidenceRecord[];
  images: ImageCheck[];
  review?: { agent: AgentKind; model: string; strength: string; text: string };
  fingerprint: string;
  summary: string;
  startedAt: number;
  ms: number;
}

export interface SessionMeta {
  /** Who the live agent is right now, for the header and assistant bubbles. */
  crew?: CrewInfo;
  id: string;
  agent: AgentKind;
  cwd: string;
  title: string;
  model: string;
  effort: string;
  approvals: ApprovalSetting;
  createdAt: number;
  updatedAt: number;
  /** Current agent state — lets lists show which sessions are actively working. */
  state: 'idle' | 'working' | 'connecting' | 'error';
  /** The home-screen scene this session's project asks for (`## scene` in its
   *  .roost/project.md), if any. */
  scene?: string;
  /** Pip sized the last message as large and is asking before the expensive
   *  crew start (Control board): the message waits on this answer. */
  escalation?: { reason: string; planner: string; reviewer: string };
  /** When model is 'auto': the concrete model the triage router last picked. */
  routedModel?: string;
  /** True while a completed consult awaits the user's Proceed/Dismiss decision. */
  consultPending?: boolean;
  mode: SessionMode;
  /** The person picked the mode; otherwise it is the configured default. */
  modeExplicit?: boolean;
  /** The plan file for the pending consult, when there is one. */
  planPath?: string;
  /** The pending plan names a Remainder (its Fit section said it will not all fit). */
  planHasRemainder?: boolean;
  /** Asked for by name: messages without an @ keep going to this member
   *  until cleared (2026-09-24). */
  sticky?: string;
  builder?: Builder;
  /** Armed when the engine's context is degrading and the person has not been
   *  asked yet at this level. Mirrors consultPending: server decides, UI renders. */
  contextOffer?: { reason: string; percent: number | null };
  /** "Keep doing this automatically" — remembered across restarts. */
  autoCompact?: boolean;
  /** Who last worked here, newest first, at most three — the crew the UI wakes
   *  when you open the session. */
  recentCrew?: CrewInfo[];
  /** The last thing said in this session and who said it, for the home screen's
   *  conversation card. Speaker is a crew name, or null when it was you. */
  lastLine?: { speaker: string | null; color?: string; text: string };
  /** Underlying agent session/thread id, once known (resumable later). */
  agentSessionId?: string;
  /** Set only when this session was created via resume — the id it was resumed from.
   *  Distinct from agentSessionId, which every session eventually gets (fresh or not). */
  resumedFrom?: string;
  /** "Use the good models" is on for this session. Clears when the surplus does. */
  boost?: boolean;
  surplus?: SurplusInfo | null;
}

export interface CrewInfo {
  /** Who: stable per (suite, model). */
  name: string;
  /** What hat they are wearing on this turn. */
  role: string;
  roleLabel: string;
  tier: 'flagship' | 'worker';
  /** Brand colour for the chip and the monogram avatar. */
  color: string;
  /** Letter shown when no custom avatar image is set. */
  initial: string;
  /** Optional custom image filename under <dataDir>/avatars/. */
  avatar?: string;
  /** Drawn sprite set name, when this persona has one. */
  sprite?: string;
  agent: AgentKind;
  model: string;
  /** The thinking effort this turn ran at (Control board). Absent when the
   *  model budgets its own thinking or none is set -- no meter, not a zero. */
  effort?: string;
  /** Why effort moved, on the first turn after it did: "Stepped down from
   *  xhigh. …". chooseEffort's reason, spent where the turn is. */
  effortNote?: string;
}

export interface ContextInfo {
  agent: AgentKind;
  /** null means unknown — render "no data", never a bar at 0%. */
  usedTokens: number | null;
  maxTokens: number | null;
  percent: number | null;
  pressure: 'clear' | 'filling' | 'degrading' | 'critical' | 'unknown';
  overLimit?: { tokensOver: number; kind: 'hard_limit' | 'compaction_window' };
  categories?: Array<{ name: string; tokens: number; kind?: string }>;
  /** Cheapest-first suggestion: dispatch a subagent, compact, or hand off. */
  advice?: { action: 'dispatch' | 'compact' | 'handoff'; reason: string } | null;
  observedAt: number;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  contextPct?: number;
}

export type ServerEvent =
  | { type: 'replay'; events: ServerEvent[]; meta: SessionMeta }
  | { type: 'session_meta'; meta: SessionMeta }
  | { type: 'user_message'; text: string; imageCount: number; ts: number }
  | { type: 'assistant_delta'; delta: string; crew?: CrewInfo; ts: number }
  | { type: 'assistant_message'; text: string; crew?: CrewInfo; ts: number }
  | { type: 'thinking_delta'; delta: string; ts: number }
  | { type: 'tool_start'; toolId: string; name: string; detail: string; expand?: ToolExpand; ts: number }
  | { type: 'tool_end'; toolId: string; name: string; detail?: string; ok: boolean; ts: number }
  | { type: 'approval_request'; requestId: string; title: string; detail: string; ts: number }
  | { type: 'approval_resolved'; requestId: string; decision: string; ts: number }
  | { type: 'routed'; model: string; tier: string; reason: string; crew?: CrewInfo; worker?: CrewInfo; ts: number }
  | { type: 'consult'; phase: ConsultPhase; agent: AgentKind; text: string; crew?: CrewInfo; from?: CrewInfo; reviewStrength?: string; ts: number }
  | { type: 'verify'; report: VerifyReport; ts: number }
  | { type: 'usage'; usage: UsageInfo; ts: number }
  | { type: 'context'; context: ContextInfo; ts: number }
  | { type: 'status'; state: 'idle' | 'working' | 'connecting' | 'error'; message?: string; crew?: CrewInfo; ts: number }
  /** A crew member levelled up or earned a milestone, on this turn (item 40). */
  | { type: 'milestone'; crew: CrewInfo; label: string; detail: string; level?: number; ts: number }
  | { type: 'error'; message: string; code?: 'auth' | 'context' | 'gate'; ts: number };

export const now = () => Date.now();
