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
  | { type: 'interrupt' };

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
  agentSessionId?: string;
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
  | { type: 'tool_start'; toolId: string; name: string; detail: string; ts: number }
  | { type: 'tool_end'; toolId: string; name: string; detail?: string; ok: boolean; ts: number }
  | { type: 'approval_request'; requestId: string; title: string; detail: string; ts: number }
  | { type: 'approval_resolved'; requestId: string; decision: string; ts: number }
  | { type: 'usage'; usage: UsageInfo; ts: number }
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

export interface PocketConfigResponse {
  projects: string[];
  primaryVolume: string | null;
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

export interface UsageWindow {
  label: string;
  usedPercent?: number;
  resetsAt?: number;
  status?: string;
}

export interface AgentUsage {
  windows: UsageWindow[];
  planType?: string;
  error?: string;
}

export interface UsageSnapshot {
  claude: AgentUsage;
  codex: AgentUsage;
  fetchedAt: number;
}

export type ChatItem =
  | { kind: 'user'; text: string; imageCount: number; ts: number }
  | { kind: 'assistant'; text: string; complete: boolean; ts: number }
  | { kind: 'thinking'; text: string; open: boolean; ts: number }
  | { kind: 'tool'; toolId: string; name: string; detail: string; done: boolean; ok?: boolean; endDetail?: string; ts: number }
  | { kind: 'approval'; requestId: string; title: string; detail: string; decision?: string; ts: number }
  | { kind: 'error'; text: string; ts: number };
