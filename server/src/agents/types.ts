import type { AgentKind, ApprovalSetting, ServerEvent, UserImage } from '../protocol.js';

/** One agent turn's ACTUAL consumption, already deltaed against whatever the
 *  engine reports cumulatively. Adapters must never pass a running total here:
 *  agent-sync logged Codex's thread-cumulative counter as per-call and recorded
 *  single turns at 15-18M tokens. */
export interface CallDelta {
  agent: AgentKind;
  model: string;
  inTok: number;
  outTok: number;
  cacheReadTok: number;
  cacheWriteTok: number;
  reasoningTok?: number;
  /** Engine-reported dollars when authoritative; null when unknown, never 0. */
  costUsd: number | null;
  costBasis: 'sdk' | 'unknown';
  turnId?: string;
  agentSessionId?: string;
}

export interface AgentAdapterOptions {
  cwd: string;
  model: string;
  effort: string;
  approvals: ApprovalSetting;
  /** Resume an existing agent-side session/thread id. */
  resume?: string;
  emit: (event: ServerEvent) => void;
  /** Called when the underlying agent session id becomes known. */
  onAgentSessionId: (id: string) => void;
  /** Called when the agent reports the actual model it is running. */
  onModelResolved?: (model: string) => void;
  /** Per-call usage, already deltaed. Optional so one-shot consult/probe runs
   *  can opt in without restructuring. */
  onCall?: (delta: CallDelta) => void;
}

export interface AgentAdapter {
  /** `displayText`, when given, is what the transcript shows; `text` is what the engine
   *  receives — lets consult-proceed send a long composed prompt behind a short label. */
  sendUserMessage(text: string, images?: UserImage[], displayText?: string): Promise<void>;
  setModel(model: string): Promise<void>;
  setEffort(effort: string): Promise<void>;
  setApprovals(approvals: ApprovalSetting): Promise<void>;
  resolveApproval(requestId: string, decision: 'allow' | 'allow-session' | 'deny'): void;
  interrupt(): Promise<void>;
  dispose(): void;
}

export interface PendingApproval {
  resolve: (decision: 'allow' | 'allow-session' | 'deny') => void;
}
