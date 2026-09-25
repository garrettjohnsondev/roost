// Mirror of server/src/protocol.ts — keep in sync.

export type AgentKind = 'claude' | 'codex';
export type ApprovalSetting = 'ask' | 'auto-edits' | 'full-auto';

export interface UserImage {
  mediaType: string;
  data: string;
}

/** chat: one agent, no ceremony. auto: triage picks model and effort per message.
 *  plan: read-only, every message yields a plan file. build: the full conference. */
export type SessionMode = 'chat' | 'auto' | 'plan' | 'build';
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
  state: 'idle' | 'working' | 'connecting' | 'error';
  routedModel?: string;
  consultPending?: boolean;
  mode: SessionMode;
  /** The person picked the mode; otherwise it is the configured default. */
  modeExplicit?: boolean;
  /** The plan file for the pending consult, when there is one. */
  planPath?: string;
  planHasRemainder?: boolean;
  /** Asked for by name: messages without an @ keep going to this member
   *  until cleared (2026-09-24). */
  sticky?: string;
  builder?: Builder;
  contextOffer?: { reason: string; percent: number | null };
  autoCompact?: boolean;
  /** Who last worked here, newest first, at most three — the crew the UI wakes
   *  when you open the session. */
  recentCrew?: CrewInfo[];
  /** The last thing said in this session and who said it, for the home screen's
   *  conversation card. Speaker is a crew name, or null when it was you. */
  lastLine?: { speaker: string | null; color?: string; text: string };
  agentSessionId?: string;
  resumedFrom?: string;
  /** "Use the good models" is on for this session. Clears when the surplus does. */
  boost?: boolean;
  surplus?: SurplusInfo | null;
}

export interface GitSummary {
  files: number;
  ahead: number;
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
  | { type: 'error'; message: string; code?: 'auth' | 'context' | 'gate'; ts: number };

export interface ModelOption {
  id: string;
  label: string;
  efforts?: string[];
  resolvedModel?: string;
}

export interface AgentConfig {
  models: ModelOption[];
  defaultModel: string;
  efforts: string[];
}

export interface NotificationConfig {
  url: string;
  topic: string;
}

export interface RoostConfigResponse {
  projects: string[];
  primaryVolume: string | null;
  sessionIdleTimeoutHours: number;
  notifications: NotificationConfig;
  claude: AgentConfig;
  codex: AgentConfig;
}

export interface RecentProject {
  path: string;
  lastAgent: AgentKind;
  lastActivity: number;
  lastTitle: string;
  lastResumeId: string;
}

/** A crew member's identity, as stored and edited. Mirrors server Persona. */
export interface Persona {
  /** Case-insensitive substring matched against the model id. '' = suite default. */
  match: string;
  suite?: AgentKind;
  name: string;
  tier: 'flagship' | 'worker';
  color: string;
  avatar?: string;
  /** Drawn sprite set name, when this persona has one. */
  sprite?: string;
}

export interface WeightEstimate {
  agent: AgentKind;
  key: string;
  model: string;
  /** null until enough single-model samples exist. Never a guess. */
  pctPerMillionTokens: number | null;
  samples: number;
  tokens: number;
  pctMoved: number;
  confidence: 'none' | 'low' | 'medium' | 'high';
  note: string;
}

export interface ModelCardWire {
  agent: AgentKind;
  id: string;
  displayName: string;
  description: string;
  efforts: string[];
  isVendorDefault: boolean;
  supersededBy: string | null;
  hidden: boolean;
  suggested: { tier: 'light' | 'standard' | 'heavy' | null; why: string };
}

export interface ModelsResponse {
  fetchedAt: number;
  models: ModelCardWire[];
  issues: Array<{ agent: string; tier: string; model: string; problem: string; suggestion: string | null }>;
  capabilities: { vendors: AgentKind[]; crossVendorReview: boolean; reviewLabel: string };
}

export interface DecisionsSummary {
  total: number;
  sinceMs: number;
  routes: number;
  dispatches: { total: number; ok: number; failed: number; meanMs: number | null };
  reviews: { total: number; skippedBySizeGate: number; byStrength: Record<string, number> };
  gates: { oneWriter: number };
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

export interface UsageWindow {
  key: string;
  label: string;
  /** null means UNKNOWN. It is never zero and never headroom — render the words
   *  "no data" and no bar, never a green bar at 0%. */
  usedPercent: number | null;
  resetsAt: number | null;
  windowDurationMins: number | null;
  status?: string;
  observedAt: number;
  source: string;
}

export interface AgentUsage {
  windows: UsageWindow[];
  planType?: string;
  /** null means the provider did not say. It must never render as "allowed". */
  usageAllowed: boolean | null;
  error?: string;
  headroom?: 'room' | 'tight' | 'gated' | 'exhausted' | 'unknown' | 'stale';
}

export interface UsageSnapshot {
  claude: AgentUsage;
  codex: AgentUsage;
  fetchedAt: number;
}

export interface PreviewMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface PreviewFile {
  path: string;
  action: 'created' | 'edited' | 'deleted' | 'touched';
  before?: string;
  after?: string;
  extra?: number;
}

export interface PreviewResult {
  messages: PreviewMessage[];
  files: PreviewFile[];
}

export interface GitFile {
  path: string;
  status: string;
  additions?: number;
  deletions?: number;
  untracked: boolean;
}

export interface GitStatusResult {
  isRepo: boolean;
  branch?: string;
  ahead?: number;
  behind?: number;
  hasCommits: boolean;
  files: GitFile[];
}

export type ChatItem =
  | { kind: 'user'; text: string; imageCount: number; ts: number }
  | { kind: 'assistant'; text: string; complete: boolean; ts: number; crew?: CrewInfo }
  | { kind: 'verify'; report: VerifyReport; ts: number }
  | { kind: 'thinking'; text: string; open: boolean; ts: number }
  | { kind: 'tool'; toolId: string; name: string; detail: string; expand?: ToolExpand; done: boolean; ok?: boolean; endDetail?: string; ts: number }
  | { kind: 'approval'; requestId: string; title: string; detail: string; decision?: string; ts: number }
  | { kind: 'routed'; model: string; tier: string; reason: string; crew?: CrewInfo; worker?: CrewInfo; ts: number }
  | { kind: 'consult'; phase: ConsultPhase; agent: AgentKind; text: string; crew?: CrewInfo; from?: CrewInfo; ts: number; reviewStrength?: string }
  | { kind: 'error'; text: string; code?: 'auth' | 'context' | 'gate'; ts: number };

/** You, in the thread. Mirrors server/src/me.ts. */
export interface Me {
  name: string;
  avatar?: string;
  color: string;
}

/** "See the project you are building, from the phone" (docs/PREVIEW.md,
 *  roadmap 28). Named `Live`, not `Preview` -- that name is already the
 *  read-only recap of a past session (PreviewResult above). */
export type LiveState = 'starting' | 'running' | 'stopped' | 'error';
export interface LiveInfo {
  configured: boolean;
  state: LiveState;
  kind?: 'command' | 'static';
  url?: string;
  error?: string;
  output?: string[];
  startedAt?: number;
}
