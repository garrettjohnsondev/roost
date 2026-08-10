import type { ApprovalSetting, ServerEvent, UserImage } from '../protocol.js';

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
}

export interface AgentAdapter {
  sendUserMessage(text: string, images?: UserImage[]): Promise<void>;
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
