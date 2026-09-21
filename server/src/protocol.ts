// Shared wire protocol between the Pocket server and the phone UI.
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

/** Expanded detail for a tool call, shown when the user taps its chip. */
export interface ToolExpand {
  path?: string;
  before?: string;
  after?: string;
  raw?: string;
}

export interface SessionMeta {
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
  /** When model is 'auto': the concrete model the triage router last picked. */
  routedModel?: string;
  /** True while a completed consult awaits the user's Proceed/Dismiss decision. */
  consultPending?: boolean;
  /** Underlying agent session/thread id, once known (resumable later). */
  agentSessionId?: string;
  /** Set only when this session was created via resume — the id it was resumed from.
   *  Distinct from agentSessionId, which every session eventually gets (fresh or not). */
  resumedFrom?: string;
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
  | { type: 'assistant_delta'; delta: string; ts: number }
  | { type: 'assistant_message'; text: string; ts: number }
  | { type: 'thinking_delta'; delta: string; ts: number }
  | { type: 'tool_start'; toolId: string; name: string; detail: string; expand?: ToolExpand; ts: number }
  | { type: 'tool_end'; toolId: string; name: string; detail?: string; ok: boolean; ts: number }
  | { type: 'approval_request'; requestId: string; title: string; detail: string; ts: number }
  | { type: 'approval_resolved'; requestId: string; decision: string; ts: number }
  | { type: 'routed'; model: string; tier: string; reason: string; ts: number }
  | { type: 'consult'; phase: 'plan' | 'critique'; agent: AgentKind; text: string; ts: number }
  | { type: 'usage'; usage: UsageInfo; ts: number }
  | { type: 'context'; context: ContextInfo; ts: number }
  | { type: 'status'; state: 'idle' | 'working' | 'connecting' | 'error'; message?: string; ts: number }
  | { type: 'error'; message: string; ts: number };

export const now = () => Date.now();
