import { randomUUID } from 'node:crypto';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { now, type ApprovalSetting, type ServerEvent, type UserImage } from '../protocol.js';
import { AsyncQueue, truncate } from '../util.js';
import type { AgentAdapter, AgentAdapterOptions, PendingApproval } from './types.js';

const APPROVAL_TO_PERMISSION_MODE: Record<ApprovalSetting, string> = {
  ask: 'default',
  'auto-edits': 'acceptEdits',
  'full-auto': 'bypassPermissions',
};

export class ClaudeAdapter implements AgentAdapter {
  private input = new AsyncQueue<any>();
  private q: any;
  private pending = new Map<string, PendingApproval>();
  private approvals: ApprovalSetting;
  private disposed = false;

  constructor(private opts: AgentAdapterOptions) {
    this.approvals = opts.approvals;
    this.start();
  }

  private emit(e: ServerEvent) {
    this.opts.emit(e);
  }

  private start() {
    const options: Record<string, unknown> = {
      cwd: this.opts.cwd,
      model: this.opts.model || undefined,
      permissionMode: APPROVAL_TO_PERMISSION_MODE[this.approvals],
      includePartialMessages: true,
      resume: this.opts.resume,
      // Load the same settings the interactive CLI uses (CLAUDE.md, skills, MCP servers).
      settingSources: ['user', 'project', 'local'],
      effort: this.opts.effort || undefined,
      canUseTool: async (toolName: string, toolInput: Record<string, unknown>, _extra: unknown) => {
        const decision = await this.requestApproval(toolName, toolInput);
        if (decision === 'allow-session') {
          void this.setApprovals('full-auto');
        }
        return decision === 'deny'
          ? { behavior: 'deny', message: 'Denied by user from Pocket.' }
          : { behavior: 'allow', updatedInput: toolInput };
      },
    };

    this.q = query({ prompt: this.input as AsyncIterable<any>, options: options as any });
    void this.pump();
  }

  private async pump() {
    try {
      for await (const message of this.q) this.handle(message);
      if (!this.disposed) this.emit({ type: 'status', state: 'idle', ts: now() });
    } catch (err: any) {
      if (!this.disposed) {
        this.emit({ type: 'error', message: `Claude session error: ${err?.message ?? err}`, ts: now() });
        this.emit({ type: 'status', state: 'error', message: String(err?.message ?? err), ts: now() });
      }
    }
  }

  private handle(m: any) {
    switch (m.type) {
      case 'system':
        if (m.subtype === 'init' && m.session_id) this.opts.onAgentSessionId(m.session_id);
        break;
      case 'stream_event': {
        const ev = m.event;
        if (ev?.type === 'content_block_delta') {
          if (ev.delta?.type === 'text_delta' && ev.delta.text) {
            this.emit({ type: 'assistant_delta', delta: ev.delta.text, ts: now() });
          } else if (ev.delta?.type === 'thinking_delta' && ev.delta.thinking) {
            this.emit({ type: 'thinking_delta', delta: ev.delta.thinking, ts: now() });
          }
        }
        break;
      }
      case 'assistant': {
        for (const block of m.message?.content ?? []) {
          if (block.type === 'text' && block.text) {
            this.emit({ type: 'assistant_message', text: block.text, ts: now() });
          } else if (block.type === 'tool_use') {
            this.emit({
              type: 'tool_start',
              toolId: block.id ?? randomUUID(),
              name: block.name ?? 'tool',
              detail: truncate(JSON.stringify(block.input ?? {}), 300),
              ts: now(),
            });
          }
        }
        break;
      }
      case 'user': {
        const content = m.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_result') {
              this.emit({
                type: 'tool_end',
                toolId: block.tool_use_id ?? '',
                name: '',
                ok: !block.is_error,
                detail: undefined,
                ts: now(),
              });
            }
          }
        }
        break;
      }
      case 'result': {
        const usage = m.usage ?? {};
        this.emit({
          type: 'usage',
          usage: {
            inputTokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
            outputTokens: usage.output_tokens ?? 0,
            costUsd: m.total_cost_usd,
          },
          ts: now(),
        });
        this.emit({ type: 'status', state: 'idle', ts: now() });
        break;
      }
    }
  }

  private requestApproval(toolName: string, toolInput: Record<string, unknown>): Promise<'allow' | 'allow-session' | 'deny'> {
    const requestId = randomUUID();
    return new Promise((resolve) => {
      this.pending.set(requestId, { resolve: resolve as PendingApproval['resolve'] });
      this.emit({
        type: 'approval_request',
        requestId,
        title: `Claude wants to use ${toolName}`,
        detail: truncate(JSON.stringify(toolInput, null, 2), 2000),
        ts: now(),
      });
    });
  }

  resolveApproval(requestId: string, decision: 'allow' | 'allow-session' | 'deny'): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    this.emit({ type: 'approval_resolved', requestId, decision, ts: now() });
    pending.resolve(decision);
  }

  async sendUserMessage(text: string, images?: UserImage[]): Promise<void> {
    const content: any[] = [];
    for (const img of images ?? []) {
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
    }
    if (text) content.push({ type: 'text', text });
    this.emit({ type: 'user_message', text, imageCount: images?.length ?? 0, ts: now() });
    this.emit({ type: 'status', state: 'working', ts: now() });
    this.input.push({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: '',
    });
  }

  async setModel(model: string): Promise<void> {
    if (typeof this.q?.setModel === 'function') await this.q.setModel(model);
    else throw new Error('setModel is not supported by the installed Claude Agent SDK version');
  }

  async setEffort(effort: string): Promise<void> {
    if (typeof this.q?.setEffort === 'function') {
      await this.q.setEffort(effort);
    } else if (typeof this.q?.applyFlagSettings === 'function') {
      await this.q.applyFlagSettings({ effortLevel: effort });
    } else {
      throw new Error('Changing effort mid-session is not supported by the installed SDK; it will apply on the next session.');
    }
  }

  async setApprovals(approvals: ApprovalSetting): Promise<void> {
    this.approvals = approvals;
    if (typeof this.q?.setPermissionMode === 'function') {
      await this.q.setPermissionMode(APPROVAL_TO_PERMISSION_MODE[approvals]);
    } else {
      throw new Error('setPermissionMode is not supported by the installed Claude Agent SDK version');
    }
  }

  async interrupt(): Promise<void> {
    if (typeof this.q?.interrupt === 'function') await this.q.interrupt();
  }

  dispose(): void {
    this.disposed = true;
    for (const [id, pending] of this.pending) {
      pending.resolve('deny');
      this.pending.delete(id);
    }
    this.input.close();
    void this.q?.interrupt?.().catch(() => {});
  }
}
