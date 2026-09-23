import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { now, type ApprovalSetting, type ServerEvent, type ToolExpand, type UserImage } from '../protocol.js';
import { noteCodexRateLimits } from '../usage.js';
import { codexDelta, type CodexRaw } from '../usageDelta.js';
import { fromCodexTokenUsage, withAdvice } from '../context.js';
import { truncate } from '../util.js';
import { JsonRpcProcess } from '../jsonrpc.js';
import type { AgentAdapter, AgentAdapterOptions, CallDelta, PendingApproval } from './types.js';

const EXPAND_SNIPPET = 4000;

// Wire strings verified against `codex app-server generate-ts` for codex-cli 0.146.0.
const APPROVAL_TO_POLICY: Record<ApprovalSetting, string> = {
  ask: 'on-request',
  'auto-edits': 'on-request', // file changes are auto-accepted in onServerRequest instead
  'full-auto': 'never',
};

type CodexDecision = 'accept' | 'acceptForSession' | 'decline';

export class CodexAdapter implements AgentAdapter {
  private rpc: JsonRpcProcess;
  private threadId: string | null = null;
  private activeTurnId: string | null = null;
  private ready: Promise<void>;
  private pending = new Map<string, { resolve: (d: CodexDecision) => void }>();
  private itemNames = new Map<string, string>();
  private model: string;
  private effort: string;
  private approvals: ApprovalSetting;
  private contextWindow: number | null = null;
  private disposed = false;
  /** tokenUsage.total is THREAD-cumulative. agent-sync recorded it verbatim as a
   *  per-call figure and logged single turns at 15-18M tokens; the delta against
   *  the previous notification is the only honest per-call number. */
  private lastTotal: CodexRaw | null = null;
  /** The model actually running this thread, resolved from thread/start. A record
   *  must never carry model:'' -- that is what made every Codex call price as
   *  Sonnet through agent-sync's catch-all row. */
  private resolvedModel = '';

  constructor(private opts: AgentAdapterOptions) {
    this.model = opts.model;
    this.effort = opts.effort;
    this.approvals = opts.approvals;
    this.emit({ type: 'status', state: 'connecting', ts: now() });
    this.rpc = new JsonRpcProcess('codex', ['app-server'], opts.cwd, {
      onRequest: (method, params) => this.onServerRequest(method, params),
      onNotification: (method, params) => this.onNotification(method, params),
      onExit: (code, stderrTail) => {
        if (this.disposed) return;
        this.emit({ type: 'error', message: `codex app-server exited (code ${code}). ${stderrTail ? 'stderr: ' + truncate(stderrTail, 500) : ''}`, ts: now() });
        this.emit({ type: 'status', state: 'error', message: 'codex exited', ts: now() });
      },
    });
    this.ready = this.init();
    this.ready.catch((err) => {
      this.emit({ type: 'error', message: `Failed to start Codex: ${err?.message ?? err}`, ts: now() });
      this.emit({ type: 'status', state: 'error', message: String(err?.message ?? err), ts: now() });
    });
  }

  private emit(e: ServerEvent) {
    this.opts.emit(e);
  }

  private async init(): Promise<void> {
    await this.rpc.request('initialize', {
      clientInfo: { name: 'pocket', title: 'Pocket', version: '0.1.0' },
      capabilities: null,
    });
    this.rpc.notify('initialized');

    const params: Record<string, unknown> = {
      cwd: this.opts.cwd,
      model: this.model || null,
      approvalPolicy: APPROVAL_TO_POLICY[this.approvals],
      sandbox: 'workspace-write',
    };
    const result = this.opts.resume
      ? await this.rpc.request('thread/resume', { threadId: this.opts.resume, ...params })
      : await this.rpc.request('thread/start', params);

    this.threadId = result?.thread?.id ?? result?.threadId ?? null;
    if (!this.threadId) throw new Error(`codex thread/start returned no thread id: ${truncate(JSON.stringify(result), 300)}`);
    this.opts.onAgentSessionId(this.threadId);
    if (result?.model) {
      if (!this.model) this.model = result.model;
      this.resolvedModel = String(result.model);
      this.opts.onModelResolved?.(result.model);
    }
    this.emit({ type: 'status', state: 'idle', ts: now() });
  }

  /** Cumulative -> per-call, via the shared delta math in usageDelta.ts. */
  private emitCallDelta(total: any, last: any, turnId?: string): void {
    if (!this.opts.onCall) return;
    const { delta, next } = codexDelta(this.lastTotal, total, last);
    this.lastTotal = next;
    if (!delta) return;
    const model = this.model || this.resolvedModel;
    if (!model) return; // never record an unattributable call

    this.opts.onCall({
      agent: 'codex',
      model,
      inTok: delta.inTok,
      outTok: delta.outTok,
      cacheReadTok: delta.cacheReadTok,
      cacheWriteTok: delta.cacheWriteTok,
      reasoningTok: delta.reasoningTok || undefined,
      // The app-server reports no dollars; the ledger prices from the model id
      // and returns null when no rate row exists.
      costUsd: null,
      costBasis: 'unknown',
      turnId,
      agentSessionId: this.threadId ?? undefined,
    });
  }

  private async onServerRequest(method: string, params: any): Promise<any> {
    if (method === 'item/commandExecution/requestApproval' || method === 'execCommandApproval') {
      const decision = await this.requestApproval(
        `Codex wants to run a command`,
        [params?.command, params?.reason, params?.cwd ? `in ${params.cwd}` : '']
          .filter(Boolean)
          .join('\n'),
      );
      return { decision };
    }
    if (method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval') {
      // Codex has no approval policy that means "edits yes, commands ask", so
      // 'auto-edits' mapped to the same policy as 'ask' and the toggle did
      // nothing. Honour it here, at the one request type it is about.
      if (this.approvals === 'auto-edits') return { decision: 'accept' };
      const decision = await this.requestApproval(
        'Codex wants to change files',
        [params?.reason, params?.grantRoot ? `grant root: ${params.grantRoot}` : ''].filter(Boolean).join('\n') || 'Apply proposed file changes',
      );
      return { decision };
    }
    if (method === 'item/permissions/requestApproval') {
      const decision = await this.requestApproval('Codex requests permissions', truncate(JSON.stringify(params ?? {}, null, 2), 1500));
      return { decision };
    }
    // Anything we don't understand: refuse rather than hang the server.
    throw new Error(`Pocket does not handle server request ${method}`);
  }

  private requestApproval(title: string, detail: string): Promise<CodexDecision> {
    const requestId = randomUUID();
    return new Promise((resolve) => {
      this.pending.set(requestId, { resolve });
      this.emit({ type: 'approval_request', requestId, title, detail, ts: now() });
    });
  }

  resolveApproval(requestId: string, decision: 'allow' | 'allow-session' | 'deny'): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    this.emit({ type: 'approval_resolved', requestId, decision, ts: now() });
    // Strict: only the two affirmative decisions accept; anything else declines.
    pending.resolve(decision === 'allow' ? 'accept' : decision === 'allow-session' ? 'acceptForSession' : 'decline');
  }

  private onNotification(method: string, params: any) {
    switch (method) {
      case 'item/agentMessage/delta':
        if (params?.delta) this.emit({ type: 'assistant_delta', delta: params.delta, ts: now() });
        break;
      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta':
        if (params?.delta) this.emit({ type: 'thinking_delta', delta: params.delta, ts: now() });
        break;
      case 'thread/compacted':
        // The engine compacted -- whether we asked or it decided on its own.
        // Saying so matters: the context meter is about to drop by a lot, and an
        // unexplained drop looks like a bug or like lost work.
        this.emit({ type: 'status', state: 'idle', message: 'Context compacted — the thread was summarized to free room.', ts: now() });
        break;
      case 'item/started': {
        const item = params?.item;
        if (!item) break;
        const described = this.describeItem(item);
        if (described) {
          this.itemNames.set(item.id, described.name);
          this.emit({ type: 'tool_start', toolId: item.id, name: described.name, detail: described.detail, expand: described.expand, ts: now() });
        }
        break;
      }
      case 'item/completed': {
        const item = params?.item;
        if (!item) break;
        if (item.type === 'agentMessage' && item.text) {
          this.emit({ type: 'assistant_message', text: item.text, ts: now() });
        } else if (this.itemNames.has(item.id)) {
          // A declined or failed item is not ok. exitCode == null used to count
          // as success, so a command the user refused showed a green check.
          const declined = item.status === 'declined' || item.status === 'failed' || item.status === 'rejected';
          const ok = declined ? false : item.type === 'commandExecution' ? item.exitCode === 0 || item.exitCode == null : item.status !== 'failed';
          const detail = item.type === 'commandExecution' && item.exitCode != null ? `exit ${item.exitCode}` : undefined;
          this.emit({ type: 'tool_end', toolId: item.id, name: this.itemNames.get(item.id)!, ok, detail, ts: now() });
          this.itemNames.delete(item.id);
        }
        break;
      }
      case 'turn/started':
        this.activeTurnId = params?.turn?.id ?? null;
        this.emit({ type: 'status', state: 'working', ts: now() });
        break;
      case 'turn/completed': {
        this.activeTurnId = null;
        // TurnCompletedNotification carries turn.status ('completed' |
        // 'interrupted' | 'failed' | 'inProgress') and turn.error. A failed turn
        // used to resolve as an ordinary idle completion with nothing said.
        const status = params?.turn?.status;
        if (status === 'failed') {
          const why = params?.turn?.error?.message ?? 'unknown error';
          this.emit({ type: 'error', message: `Codex turn failed: ${truncate(String(why), 500)}`, ts: now() });
        }
        this.emit({ type: 'status', state: 'idle', message: status === 'interrupted' ? 'Stopped.' : undefined, ts: now() });
        break;
      }
      case 'error': {
        // The engine hit an error; willRetry says whether it is giving up.
        // Either way the user must see it -- it used to go nowhere.
        const msg = params?.error?.message ?? params?.message ?? 'unknown error';
        this.emit({ type: 'error', message: `Codex: ${truncate(String(msg), 500)}${params?.willRetry ? ' (retrying)' : ''}`, ts: now() });
        if (params?.willRetry === false) {
          this.activeTurnId = null;
          this.emit({ type: 'status', state: 'idle', ts: now() });
        }
        break;
      }
      case 'account/rateLimits/updated':
        // Free usage-panel refresh as a side effect of normal chatting.
        noteCodexRateLimits(params?.rateLimits);
        break;
      case 'thread/tokenUsage/updated': {
        const usage = params?.tokenUsage ?? {};
        const total = usage.total ?? {};
        const input = total.inputTokens ?? total.input_tokens ?? 0;
        const output = total.outputTokens ?? total.output_tokens ?? 0;
        if (usage.modelContextWindow) this.contextWindow = usage.modelContextWindow;
        const last = usage.last ?? {};
        const lastTotal = (last.inputTokens ?? last.input_tokens ?? 0) + (last.outputTokens ?? last.output_tokens ?? 0);

        this.emitCallDelta(total, last, params?.turnId);

        // Context pressure from data already in hand — no extra call.
        const ctx = withAdvice(fromCodexTokenUsage(last, this.contextWindow));
        if (ctx) this.emit({ type: 'context', context: ctx, ts: now() });

        this.emit({
          type: 'usage',
          usage: {
            inputTokens: input,
            outputTokens: output,
            contextPct: this.contextWindow ? Math.min(100, Math.round((lastTotal / this.contextWindow) * 100)) : undefined,
          },
          ts: now(),
        });
        break;
      }
      case 'error':
        this.emit({ type: 'error', message: params?.error?.message ?? truncate(JSON.stringify(params ?? {}), 300), ts: now() });
        break;
      default:
        break; // plenty of notifications we render nothing for
    }
  }

  private describeItem(item: any): { name: string; detail: string; expand?: ToolExpand } | null {
    switch (item.type) {
      case 'commandExecution':
        return {
          name: 'shell',
          detail: truncate(item.command ?? '', 300),
          expand: { raw: truncate(item.command ?? '', EXPAND_SNIPPET) },
        };
      case 'fileChange': {
        const changes = item.changes ?? [];
        return {
          name: 'edit',
          detail: truncate(changes.map((c: any) => c.path ?? '').join(', '), 300),
          expand: {
            path: changes.map((c: any) => c.path ?? '').join(', '),
            // Codex logs real unified diffs on fileChange items — pass them through.
            raw: truncate(changes.map((c: any) => c.diff ?? '').filter(Boolean).join('\n'), EXPAND_SNIPPET) || undefined,
          },
        };
      }
      case 'mcpToolCall':
        return {
          name: `${item.server}:${item.tool}`,
          detail: truncate(JSON.stringify(item.arguments ?? {}), 300),
          expand: { raw: truncate(JSON.stringify(item.arguments ?? {}, null, 2), EXPAND_SNIPPET) },
        };
      case 'webSearch':
        return { name: 'web search', detail: truncate(item.query ?? '', 300) };
      default:
        return null;
    }
  }

  async sendUserMessage(text: string, images?: UserImage[], displayText?: string): Promise<void> {
    await this.ready;
    if (!this.threadId) throw new Error('Codex thread is not ready');
    const input: any[] = [];
    for (const img of images ?? []) {
      const dir = join(tmpdir(), 'pocket-uploads');
      mkdirSync(dir, { recursive: true });
      const ext = img.mediaType.split('/')[1]?.split('+')[0] || 'png';
      const path = join(dir, `${randomUUID()}.${ext}`);
      writeFileSync(path, Buffer.from(img.data, 'base64'));
      input.push({ type: 'localImage', path });
    }
    if (text) input.push({ type: 'text', text, text_elements: [] });
    this.emit({ type: 'user_message', text: displayText ?? text, imageCount: images?.length ?? 0, ts: now() });
    this.emit({ type: 'status', state: 'working', ts: now() });
    // A message sent while a turn is running steers that turn (what the VS Code extension
    // does) rather than racing a second turn/start against it, which the server rejects.
    const request = this.activeTurnId
      ? this.rpc.request('turn/steer', { threadId: this.threadId, input, expectedTurnId: this.activeTurnId }, 60_000)
      : this.rpc.request('turn/start', {
          threadId: this.threadId,
          input,
          approvalPolicy: APPROVAL_TO_POLICY[this.approvals],
          model: this.model || null,
          effort: this.effort || null,
        }, 10 * 60_000);
    void request.catch((err) => {
      this.emit({ type: 'error', message: `Codex turn failed: ${err?.message ?? err}`, ts: now() });
      this.emit({ type: 'status', state: 'idle', ts: now() });
    });
  }

  /** A real RPC, unlike Claude's. Verified against
   *  `codex app-server generate-json-schema` for codex-cli 0.154.0:
   *  method `thread/compact/start`, params `{ threadId }`, empty response, and
   *  the engine follows with a `thread/compacted` notification. */
  async compact(): Promise<{ how: string }> {
    if (!this.threadId) throw new Error('no Codex thread to compact yet');
    await this.rpc.request('thread/compact/start', { threadId: this.threadId });
    return { how: 'thread/compact/start' };
  }

  async setModel(model: string): Promise<void> {
    this.model = model; // applied on the next turn/start
  }

  async setEffort(effort: string): Promise<void> {
    this.effort = effort; // applied on the next turn/start
  }

  async setApprovals(approvals: ApprovalSetting): Promise<void> {
    this.approvals = approvals; // applied on the next turn/start
  }

  async interrupt(): Promise<void> {
    if (!this.threadId) return;
    // TurnInterruptParams is { threadId, turnId } -- turnId is REQUIRED. Sent
    // without it the request was rejected, the rejection swallowed, and idle
    // emitted anyway: Stop silently did nothing while the UI said it worked.
    if (!this.activeTurnId) {
      this.emit({ type: 'status', state: 'idle', ts: now() });
      return;
    }
    try {
      await this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId: this.activeTurnId });
      this.emit({ type: 'status', state: 'idle', ts: now() });
    } catch (err: any) {
      this.emit({ type: 'error', message: `Stop failed: ${err?.message ?? err}`, ts: now() });
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const [id, pending] of this.pending) {
      pending.resolve('decline');
      this.pending.delete(id);
    }
    this.rpc.kill();
  }
}
