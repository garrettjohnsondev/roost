import { query } from '@anthropic-ai/claude-agent-sdk';
import { JsonRpcProcess } from '../jsonrpc.js';
import { AsyncQueue, truncate } from '../util.js';
import { sanitizeAgentOutput } from '../sanitize.js';
import type { AgentKind } from '../protocol.js';
import type { CallDelta } from './types.js';

/** What a dispatched agent is allowed to do.
 *
 *  A capability MODE rather than a tool allowlist. agent-sync gated on Bash
 *  command prefixes, which is both leakier (a prefix allowlist is a parsing
 *  problem) and weaker (it says nothing about file writes). A mode maps onto
 *  each vendor's own enforcement: Claude's tool gate, Codex's sandbox. */
export type Capability = 'read-only' | 'read-write' | 'execute' | 'all';

const READ_TOOLS = ['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebSearch', 'WebFetch', 'TodoWrite'];
const WRITE_TOOLS = ['Write', 'Edit', 'NotebookEdit'];
const EXEC_TOOLS = ['Bash', 'BashOutput', 'KillShell'];

const CLAUDE_TOOLS: Record<Capability, string[]> = {
  'read-only': READ_TOOLS,
  'read-write': [...READ_TOOLS, ...WRITE_TOOLS],
  execute: [...READ_TOOLS, ...EXEC_TOOLS],
  all: [...READ_TOOLS, ...WRITE_TOOLS, ...EXEC_TOOLS],
};

/** Codex sandbox per capability. `danger-full-access` is deliberately
 *  unreachable from a dispatch: nothing the orchestrator decides on its own
 *  should be able to escape the workspace. */
const CODEX_SANDBOX: Record<Capability, 'read-only' | 'workspace-write'> = {
  'read-only': 'read-only',
  'read-write': 'workspace-write',
  execute: 'workspace-write',
  all: 'workspace-write',
};

export function toolsFor(capability: Capability): string[] {
  return CLAUDE_TOOLS[capability];
}

export function sandboxFor(capability: Capability): 'read-only' | 'workspace-write' {
  return CODEX_SANDBOX[capability];
}

export interface AgentTaskSpec {
  agent: AgentKind;
  model: string;
  effort?: string;
  prompt: string;
  cwd: string;
  capability: Capability;
  /** Ledger attribution. */
  role?: string;
  persona?: string;
  taskId?: string;
  timeoutMs?: number;
  maxChars?: number;
  onCall?: (delta: CallDelta) => void;
}

export interface AgentTaskResult {
  text: string;
  agent: AgentKind;
  model: string;
  ms: number;
  truncated: boolean;
  /** Control structures found and defanged in the output. */
  sanitized: string[];
}

export interface AgentTaskRun {
  promise: Promise<AgentTaskResult>;
  cancel: () => void;
}

const DEFAULT_TIMEOUT_MS = 6 * 60_000;
const DEFAULT_MAX_CHARS = 12_000;

/** Run one throwaway agent with a clean context and a cancel handle.
 *
 *  The context isolation is the point: a subagent reads a lot and returns a
 *  little, so the caller's window stays clean. It also means the subagent
 *  re-pays its own system prompt, so dispatch saves CONTEXT reliably and
 *  tokens only sometimes. */
export function runAgentTask(spec: AgentTaskSpec): AgentTaskRun {
  const started = Date.now();
  const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxChars = spec.maxChars ?? DEFAULT_MAX_CHARS;
  let cancel: () => void = () => {};

  const raw =
    spec.agent === 'claude' ? runClaude(spec, timeoutMs, (c) => { cancel = c; })
      : runCodex(spec, timeoutMs, (c) => { cancel = c; });

  const promise = raw.then((text) => {
    const trimmed = text.trim();
    if (!trimmed) throw new Error(`${spec.agent} dispatch returned no text`);
    const capped = truncate(trimmed, maxChars);
    const { text: clean, findings } = sanitizeAgentOutput(capped);
    return {
      text: clean,
      agent: spec.agent,
      model: spec.model,
      ms: Date.now() - started,
      truncated: capped.length < trimmed.length,
      sanitized: findings,
    };
  });

  return { promise, cancel: () => cancel() };
}

function runClaude(spec: AgentTaskSpec, timeoutMs: number, setCancel: (c: () => void) => void): Promise<string> {
  const allowed = new Set(toolsFor(spec.capability));
  // Streaming input mode is required for interrupt() to do anything -- a plain
  // string prompt makes cancel a silent no-op.
  const input = new AsyncQueue<any>();
  input.push({ type: 'user', message: { role: 'user', content: spec.prompt }, parent_tool_use_id: null, session_id: '' });
  const q: any = query({
    prompt: input as AsyncIterable<any>,
    options: {
      cwd: spec.cwd,
      model: spec.model,
      ...(spec.effort ? { effort: spec.effort } : {}),
      maxTurns: 24,
      canUseTool: async (toolName: string) =>
        allowed.has(toolName)
          ? { behavior: 'allow', updatedInput: undefined as any }
          : { behavior: 'deny', message: `This agent is ${spec.capability}; ${toolName} is not permitted.` },
    } as any,
  });
  setCancel(() => { input.close(); void q.interrupt?.().catch(() => {}); });

  const collect = (async () => {
    let final = '';
    for await (const m of q) {
      if (m.type === 'assistant') {
        for (const block of m.message?.content ?? []) if (block.type === 'text') final = block.text;
      }
      if (m.type === 'result') {
        final = typeof m.result === 'string' ? m.result : final;
        reportClaudeUsage(spec, m);
        break;
      }
    }
    return final;
  })();

  return Promise.race([
    collect,
    new Promise<string>((_, rej) => setTimeout(() => rej(new Error('dispatch timed out')), timeoutMs)),
  ]).finally(() => { input.close(); void q.interrupt?.().catch(() => {}); });
}

/** A dispatch is one turn, so its usage is already per-call -- no delta needed. */
function reportClaudeUsage(spec: AgentTaskSpec, result: any): void {
  if (!spec.onCall) return;
  const mu = result?.modelUsage ?? {};
  for (const [model, u] of Object.entries<any>(mu)) {
    spec.onCall({
      agent: 'claude',
      model,
      inTok: u?.inputTokens ?? 0,
      outTok: u?.outputTokens ?? 0,
      cacheReadTok: u?.cacheReadInputTokens ?? 0,
      cacheWriteTok: u?.cacheCreationInputTokens ?? 0,
      reasoningTok: u?.thinkingTokens ?? undefined,
      costUsd: typeof u?.costUSD === 'number' ? u.costUSD : null,
      costBasis: typeof u?.costUSD === 'number' ? 'sdk' : 'unknown',
      agentSessionId: result?.session_id,
    });
  }
}

function runCodex(spec: AgentTaskSpec, timeoutMs: number, setCancel: (c: () => void) => void): Promise<string> {
  let onNotification: (method: string, params: any) => void = () => {};
  const rpc = new JsonRpcProcess('codex', ['app-server', '-c', 'mcp_servers={}'], spec.cwd, {
    onRequest: async (method) => {
      // A dispatch is unattended. An approval request means the capability mode
      // and the sandbox disagree; refusing is safer than guessing yes.
      throw new Error(`dispatch cannot answer ${method}`);
    },
    onNotification: (method, params) => onNotification(method, params),
    onExit: () => {},
  });
  setCancel(() => rpc.kill());

  return (async () => {
    try {
      await rpc.request('initialize', {
        clientInfo: { name: 'pocket', title: 'Pocket', version: '0.1.0' },
        capabilities: null,
      });
      rpc.notify('initialized');
      const started: any = await rpc.request('thread/start', {
        cwd: spec.cwd,
        model: spec.model || null,
        approvalPolicy: 'never',
        sandbox: sandboxFor(spec.capability),
      });
      const threadId = started?.thread?.id;
      if (!threadId) throw new Error('codex dispatch thread failed to start');

      let lastMessage = '';
      // Usage arrives on its OWN notification, not on turn/completed -- reading
      // it off the completion params silently produced no ledger entry at all.
      let lastUsage: any = null;
      const done = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('dispatch timed out')), timeoutMs);
        onNotification = (method, params) => {
          if (method === 'item/completed' && params?.item?.type === 'agentMessage' && params.item.text) {
            lastMessage = params.item.text;
          }
          if (method === 'thread/tokenUsage/updated') {
            // `last` is this turn. `total` is thread-cumulative and must never
            // be logged as a call -- that is the 15-18M-token phantom.
            lastUsage = params?.tokenUsage?.last ?? null;
          }
          if (method === 'turn/completed') {
            clearTimeout(timer);
            reportCodexUsage(spec, started?.thread?.model ?? spec.model, lastUsage);
            resolve(lastMessage);
          }
          if (method === 'error' && params?.willRetry === false) {
            clearTimeout(timer);
            reject(new Error(params?.error?.message ?? 'codex dispatch error'));
          }
        };
      });
      await rpc.request('turn/start', {
        threadId,
        ...(spec.effort ? { effort: spec.effort } : {}),
        input: [{ type: 'text', text: spec.prompt, text_elements: [] }],
      }, timeoutMs);
      return await done;
    } finally {
      rpc.kill();
    }
  })();
}

function reportCodexUsage(spec: AgentTaskSpec, model: string, u: any): void {
  if (!spec.onCall || !u) return;
  spec.onCall({
    agent: 'codex',
    model: model || spec.model,
    inTok: u.inputTokens ?? 0,
    outTok: u.outputTokens ?? 0,
    cacheReadTok: u.cachedInputTokens ?? 0,
    cacheWriteTok: 0,
    reasoningTok: u.reasoningOutputTokens ?? undefined,
    costUsd: null,
    costBasis: 'unknown',
  });
}
