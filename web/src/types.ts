// Mirror of server/src/protocol.ts — keep in sync.

export type AgentKind = 'claude' | 'codex';
export type ApprovalSetting = 'ask' | 'auto-edits' | 'full-auto';

export interface UserImage {
  mediaType: string;
  data: string;
}

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
  | { type: 'interrupt' };

export interface ToolExpand {
  path?: string;
  before?: string;
  after?: string;
  raw?: string;
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
  agentSessionId?: string;
  resumedFrom?: string;
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
  | { type: 'routed'; model: string; tier: string; reason: string; ts: number }
  | { type: 'consult'; phase: 'plan' | 'critique'; agent: AgentKind; text: string; crew?: CrewInfo; reviewStrength?: string; ts: number }
  | { type: 'usage'; usage: UsageInfo; ts: number }
  | { type: 'context'; context: ContextInfo; ts: number }
  | { type: 'status'; state: 'idle' | 'working' | 'connecting' | 'error'; message?: string; ts: number }
  | { type: 'error'; message: string; ts: number };

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

export interface PocketConfigResponse {
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
  | { kind: 'thinking'; text: string; open: boolean; ts: number }
  | { kind: 'tool'; toolId: string; name: string; detail: string; expand?: ToolExpand; done: boolean; ok?: boolean; endDetail?: string; ts: number }
  | { kind: 'approval'; requestId: string; title: string; detail: string; decision?: string; ts: number }
  | { kind: 'routed'; model: string; tier: string; reason: string; ts: number }
  | { kind: 'consult'; phase: 'plan' | 'critique'; agent: AgentKind; text: string; crew?: CrewInfo; ts: number; reviewStrength?: string }
  | { kind: 'error'; text: string; ts: number };
