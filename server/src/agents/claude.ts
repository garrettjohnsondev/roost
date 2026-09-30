import { describeToolUse } from '../approvalWords.js';
import { randomUUID } from 'node:crypto';
import { authedQuery, isAuthFailure } from '../claudeAuth.js';
import { now, type ApprovalSetting, type ServerEvent, type ToolExpand, type UserImage } from '../protocol.js';
import { noteClaudeRateLimit } from '../usage.js';
import { claudeDeltas } from '../usageDelta.js';
import { fromClaudeContextUsage, measuredContext, isContextOverflow, withAdvice } from '../context.js';
import { AsyncQueue, truncate } from '../util.js';
import type { AgentAdapter, AgentAdapterOptions, CallDelta, PendingApproval } from './types.js';
import { toolDetail } from '../toolDetail.js';
import { CODEMAP_SERVER, codemapServer, isCodemapTool } from '../codemapTool.js';

const EXPAND_SNIPPET = 4000;

/** Full-detail payload for the tap-to-expand tool chip. */
function toolExpand(name: string, input: any): ToolExpand {
  const path = input?.file_path ?? input?.notebook_path ?? input?.path;
  if (name === 'Edit') {
    return { path, before: truncate(String(input?.old_string ?? ''), EXPAND_SNIPPET), after: truncate(String(input?.new_string ?? ''), EXPAND_SNIPPET) };
  }
  if (name === 'MultiEdit') {
    const edits = Array.isArray(input?.edits) ? input.edits : [];
    return {
      path,
      before: truncate(edits.map((e: any) => e?.old_string ?? '').join('\n···\n'), EXPAND_SNIPPET),
      after: truncate(edits.map((e: any) => e?.new_string ?? '').join('\n···\n'), EXPAND_SNIPPET),
    };
  }
  if (name === 'Write') {
    return { path, after: truncate(String(input?.content ?? ''), EXPAND_SNIPPET) };
  }
  if (name === 'Bash') {
    return { raw: truncate(String(input?.command ?? ''), EXPAND_SNIPPET) };
  }
  return { path, raw: truncate(JSON.stringify(input ?? {}, null, 2), EXPAND_SNIPPET) };
}

const APPROVAL_TO_PERMISSION_MODE: Record<ApprovalSetting, string> = {
  ask: 'default',
  'auto-edits': 'acceptEdits',
  'full-auto': 'bypassPermissions',
};

export class ClaudeAdapter implements AgentAdapter {
  private input = new AsyncQueue<any>();
  private q: any;
  private pending = new Map<string, PendingApproval>();
  /** Tools the user approved "for this session". Seeded from a prior process's
   *  grants (opts.allowedTools) so a restart doesn't ask again for something
   *  already settled. */
  private sessionAllowedTools: Set<string>;
  private approvals: ApprovalSetting;
  private disposed = false;
  /** Last seen cumulative modelUsage, per model key. The SDK documents
   *  total_cost_usd and modelUsage as RUNNING TOTALS in streaming-input
   *  sessions ("read the latest result rather than summing across results"),
   *  so per-call truth is the diff between consecutive results. */
  private lastModelUsage = new Map<string, any>();
  private sessionCostUsd = 0;
  /** Calls whose cost the SDK could only guess. One of these makes the session
   *  total unknown -- summing a guess as 0 presents a partial as a real figure. */
  private sessionUnpriced = 0;
  private sessionInTok = 0;
  private sessionOutTok = 0;

  constructor(private opts: AgentAdapterOptions) {
    this.approvals = opts.approvals;
    this.sessionAllowedTools = new Set(opts.allowedTools ?? []);
    this.start();
    // The CLI engine starts lazily on the first message; the session is ready for input now.
    this.emit({ type: 'status', state: 'idle', ts: now() });
  }

  private emit(e: ServerEvent) {
    this.opts.emit(e);
  }

  private start() {
    const options: Record<string, unknown> = {
      cwd: this.opts.cwd,
      model: this.opts.model || undefined,
      permissionMode: APPROVAL_TO_PERMISSION_MODE[this.approvals],
      // Required by the SDK to ever honor 'bypassPermissions', including switching into it
      // mid-session via setPermissionMode. Safe here: Roost only requests that mode when the
      // user explicitly taps "Full auto" in the UI — this doesn't change what's reachable.
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      resume: this.opts.resume,
      // Load the same settings the interactive CLI uses (CLAUDE.md, skills, MCP servers).
      settingSources: ['user', 'project', 'local'],
      // Roost's own code map (codemap.ts), in-process: one lookup instead of a
      // grep/read loop, for every install with no setup (2026-09-27).
      mcpServers: { [CODEMAP_SERVER]: codemapServer(this.opts.cwd) },
      effort: this.opts.effort || undefined,
      canUseTool: async (toolName: string, toolInput: Record<string, unknown>, _extra: unknown) => {
        // A question is not a permission (2026-09-25). Claude's AskUserQuestion
        // reached the phone as "Claude wants to use AskUserQuestion" with raw
        // JSON; allowing it ran the tool with no answers, and the question was
        // never seen. It is asked in the thread as a text now, and whatever you
        // reply is the answer -- in every approval mode, full auto included.
        if (toolName === 'AskUserQuestion') {
          const answers = await this.askInThread(toolInput);
          if (!answers) return { behavior: 'deny', message: 'The user skipped these questions. Carry on with your best judgement and say what you assumed.' };
          return { behavior: 'allow', updatedInput: { ...toolInput, answers } };
        }
        if (this.sessionAllowedTools.has(toolName)) return { behavior: 'allow', updatedInput: toolInput };
        // The code map only reads an index Roost built itself -- a permission
        // prompt for it would cost the very back-and-forth it exists to save.
        if (isCodemapTool(toolName)) return { behavior: 'allow', updatedInput: toolInput };
        const decision = await this.requestApproval(toolName, toolInput);
        // Remember the TOOL. Switching the session to bypassPermissions here
        // silently widened every later permission the user never saw.
        if (decision === 'allow-session') {
          this.sessionAllowedTools.add(toolName);
          this.opts.onAllowedToolsChange?.([...this.sessionAllowedTools]);
        }
        if (decision === 'allow' || decision === 'allow-session') return { behavior: 'allow', updatedInput: toolInput };
        return { behavior: 'deny', message: 'Denied by user from Roost.' };
      },
    };

    this.q = authedQuery({ prompt: this.input as AsyncIterable<any>, options: options as any });
    void this.pump();
  }

  private async pump() {
    try {
      for await (const message of this.q) this.handle(message);
      if (!this.disposed) this.emit({ type: 'status', state: 'idle', ts: now() });
    } catch (err: any) {
      if (!this.disposed) {
        const msg = `Claude session error: ${err?.message ?? err}`;
        this.emit({ type: 'error', message: msg, ...(isAuthFailure(msg) ? { code: 'auth' as const } : {}), ts: now() });
        this.emit({ type: 'status', state: 'error', message: String(err?.message ?? err), ts: now() });
      }
    }
  }

  private handle(m: any) {
    switch (m.type) {
      case 'system':
        if (m.subtype === 'init') {
          if (m.session_id) this.opts.onAgentSessionId(m.session_id);
          if (m.model) this.opts.onModelResolved?.(m.model);
        }
        break;
      case 'rate_limit_event':
        // Free usage-panel refresh as a side effect of normal chatting.
        if (m.rate_limit_info) noteClaudeRateLimit(m.rate_limit_info);
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
        // Mid-turn too (item 33): a 20-minute turn used to read one number
        // and then jump. Throttled; summary detail is a local estimate.
        // What the last model call actually sent is the true size of the
        // window (subagents have their own windows, so only the main thread).
        const u = m.message?.usage;
        if (u && !m.parent_tool_use_id) {
          const sent = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
          if (sent > 0) this.lastSentTokens = sent;
        }
        if (Date.now() - this.contextAt > 20_000) void this.reportContext();
        for (const block of m.message?.content ?? []) {
          if (block.type === 'text' && block.text) {
            this.emit({ type: 'assistant_message', text: block.text, ts: now() });
          } else if (block.type === 'tool_use') {
            this.emit({
              type: 'tool_start',
              toolId: block.id ?? randomUUID(),
              name: block.name ?? 'tool',
              // Whole commands: a test run after a long script was cut off at 300
              // characters and never read as a test (the thread clips it visually).
              detail: truncate(toolDetail(block.name ?? '', block.input), 4000),
              expand: toolExpand(block.name ?? '', block.input),
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
        this.emitCallDeltas(m);
        // subtype 'error_*' or is_error means the turn stopped early or ended on
        // an API error. Reporting that as an ordinary idle completion hid every
        // terminal failure behind a blank assistant turn.
        if (m.is_error === true || (typeof m.subtype === 'string' && m.subtype.startsWith('error'))) {
          const why = typeof m.result === 'string' && m.result ? m.result : String(m.subtype ?? 'unknown error');
          const msg = `Claude turn failed: ${truncate(why, 500)}`;
          // An auth failure is a different problem with a different fix, and the
          // phone can now fix it — so it is marked, not buried in a generic error.
          const code = isAuthFailure(why) ? ('auth' as const) : isContextOverflow(why) ? ('context' as const) : undefined;
          this.emit({ type: 'error', message: msg, ...(code ? { code } : {}), ts: now() });
        }
        this.emit({
          type: 'usage',
          usage: {
            inputTokens: this.sessionInTok,
            outputTokens: this.sessionOutTok,
            // Summed from per-call deltas rather than read off m.total_cost_usd,
            // so the chat bar and the ledger can never disagree.
            costUsd: this.sessionUnpriced === 0 && this.sessionCostUsd > 0 ? this.sessionCostUsd : undefined,
          },
          ts: now(),
        });
        this.emit({ type: 'status', state: 'idle', ts: now() });
        void this.reportContext();
        break;
      }
    }
  }

  /** getContextUsage is a STABLE SDK call (unlike the usage one) and
   *  detail:'summary' answers from the last response plus local estimates --
   *  no per-category token-count requests -- so it is cheap enough to run after
   *  every turn. Failures are silent: a missing meter must never break a chat. */
  private contextAt = 0;
  /** Tokens the last main-thread model call sent (2026-09-30: after a
   *  /compact, getContextUsage kept answering 60% while the real window was
   *  ~43k tokens, and "60% after compacting (was 60%)" went out). */
  private lastSentTokens: number | null = null;
  private async reportContext(): Promise<void> {
    this.contextAt = Date.now();
    try {
      if (typeof this.q?.getContextUsage !== 'function') return;
      const resp = await this.q.getContextUsage({ detail: 'summary' });
      const ctx = withAdvice(measuredContext(fromClaudeContextUsage(resp), this.lastSentTokens));
      if (ctx) this.emit({ type: 'context', context: ctx, ts: now() });
    } catch {
      /* the meter is advisory */
    }
  }

  /** Cumulative -> per-call, via the shared delta math in usageDelta.ts. */
  private emitCallDeltas(m: any): void {
    for (const d of claudeDeltas(this.lastModelUsage, m?.modelUsage)) {
      if (d.priced) this.sessionCostUsd = +(this.sessionCostUsd + d.costUsd).toFixed(6);
      else this.sessionUnpriced += 1;
      this.sessionInTok += d.inTok + d.cacheReadTok + d.cacheWriteTok;
      this.sessionOutTok += d.outTok;
      this.opts.onCall?.({
        agent: 'claude',
        model: d.model,
        inTok: d.inTok,
        outTok: d.outTok,
        cacheReadTok: d.cacheReadTok,
        cacheWriteTok: d.cacheWriteTok,
        reasoningTok: d.reasoningTok || undefined,
        costUsd: d.priced ? +d.costUsd.toFixed(6) : null,
        costBasis: d.priced ? 'sdk' : 'unknown',
        agentSessionId: m?.session_id,
      });
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
        words: describeToolUse(toolName, toolInput, this.opts.cwd),
        ts: now(),
      });
    });
  }

  private questions = new Map<string, (answers: Record<string, string> | null) => void>();

  private askInThread(input: Record<string, unknown>): Promise<Record<string, string> | null> {
    const raw = Array.isArray((input as any).questions) ? (input as any).questions : [];
    const questions = raw
      .filter((q: any) => q && typeof q.question === 'string')
      .map((q: any) => ({
        question: String(q.question),
        header: typeof q.header === 'string' ? q.header : undefined,
        options: Array.isArray(q.options) ? q.options.filter((o: any) => o && typeof o.label === 'string').map((o: any) => ({ label: String(o.label), description: typeof o.description === 'string' ? o.description : undefined })) : [],
        multiSelect: !!q.multiSelect,
      }));
    if (!questions.length) return Promise.resolve(null);
    const requestId = randomUUID();
    return new Promise((resolve) => {
      this.questions.set(requestId, resolve);
      this.emit({ type: 'question', requestId, questions, ts: now() });
    });
  }

  answerQuestion(requestId: string, answers: Record<string, string> | null): boolean {
    const resolve = this.questions.get(requestId);
    if (!resolve) return false;
    this.questions.delete(requestId);
    this.emit({ type: 'question_answered', requestId, answers, ts: now() });
    resolve(answers);
    return true;
  }

  resolveApproval(requestId: string, decision: 'allow' | 'allow-session' | 'deny'): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    this.emit({ type: 'approval_resolved', requestId, decision, ts: now() });
    pending.resolve(decision);
  }

  async sendUserMessage(text: string, images?: UserImage[], displayText?: string): Promise<void> {
    const content: any[] = [];
    for (const img of images ?? []) {
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
    }
    if (text) content.push({ type: 'text', text });
    this.emit({ type: 'user_message', text: displayText ?? text, imageCount: images?.length ?? 0, ts: now() });
    this.emit({ type: 'status', state: 'working', ts: now() });
    this.input.push({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: '',
    });
  }

  /** The Claude Agent SDK exposes no programmatic compaction -- it offers only
   *  OBSERVATION (SDKStatus 'compacting', SDKCompactBoundaryMessage, the
   *  Pre/PostCompact hooks). So the mechanism is the `/compact` command, pushed
   *  through the input stream.
   *
   *  Deliberately NOT routed through sendUserMessage: that emits a user_message,
   *  and a "/compact" bubble in the transcript would read as though the person
   *  had typed it. They did not -- they tapped a card, or they turned the setting
   *  on once and forgot about it. */
  async compact(): Promise<{ how: string }> {
    this.emit({ type: 'status', state: 'working', ts: now() });
    this.input.push({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: '/compact' }] },
      parent_tool_use_id: null,
      session_id: '',
    });
    return { how: 'the /compact command' };
  }

  async setModel(model: string): Promise<void> {
    if (typeof this.q?.setModel === 'function') await this.q.setModel(model);
    else throw new Error('setModel is not supported by the installed Claude Agent SDK version');
  }

  async setEffort(effort: string): Promise<void> {
    if (typeof this.q?.applyFlagSettings !== 'function') {
      throw new Error('Changing effort mid-session is not supported by the installed SDK; it will apply on the next session.');
    }
    // '' means "Auto" in Roost's UI; the SDK clears the flag-level override with null.
    await this.q.applyFlagSettings({ effortLevel: (effort || null) as any });
  }

  private readOnly = false;
  /** Plan mode (#37): the SDK's own 'plan' permission mode -- it can read and
   *  think but not edit or run anything that changes the project. */
  async setReadOnly(on: boolean): Promise<void> {
    if (this.readOnly === on) return;
    this.readOnly = on;
    if (typeof this.q?.setPermissionMode === 'function') await this.q.setPermissionMode(on ? 'plan' : APPROVAL_TO_PERMISSION_MODE[this.approvals]);
  }

  async setApprovals(approvals: ApprovalSetting): Promise<void> {
    this.approvals = approvals;
    if (this.readOnly) return; // plan mode holds until it is lifted
    if (typeof this.q?.setPermissionMode === 'function') {
      await this.q.setPermissionMode(APPROVAL_TO_PERMISSION_MODE[approvals]);
    } else {
      throw new Error('setPermissionMode is not supported by the installed Claude Agent SDK version');
    }
  }

  async interrupt(): Promise<void> {
    // Stop also withdraws a question still waiting on you.
    for (const id of [...this.questions.keys()]) this.answerQuestion(id, null);
    if (typeof this.q?.interrupt === 'function') await this.q.interrupt();
  }

  dispose(): void {
    this.disposed = true;
    for (const [, resolve] of this.questions) resolve(null);
    this.questions.clear();
    for (const [id, pending] of this.pending) {
      pending.resolve('deny');
      this.pending.delete(id);
    }
    this.input.close();
    void this.q?.interrupt?.().catch(() => {});
  }
}
