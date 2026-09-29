import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { guardDispatch } from '../gate.js';
import { logDecision } from '../decisions.js';
import { authedQuery } from '../claudeAuth.js';
import { JsonRpcProcess } from '../jsonrpc.js';
import { AsyncQueue, truncate } from '../util.js';
import { sanitizeAgentOutput } from '../sanitize.js';
import type { AgentKind, UserImage } from '../protocol.js';
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

/** Codex takes images as files on disk (the same path the chat adapter uses). */
function localImages(images: UserImage[] | undefined): any[] {
  if (!images?.length) return [];
  const dir = join(tmpdir(), 'pocket-uploads');
  mkdirSync(dir, { recursive: true });
  return images.map((img) => {
    const ext = img.mediaType.split('/')[1]?.split('+')[0] || 'png';
    const path = join(dir, `${randomUUID()}.${ext}`);
    writeFileSync(path, Buffer.from(img.data, 'base64'));
    return { type: 'localImage', path };
  });
}

export interface AgentTaskSpec {
  agent: AgentKind;
  model: string;
  effort?: string;
  prompt: string;
  /** Attached by the person; both vendors take them with the prompt. Item 19
   *  (2026-09-24) shipped @-mentions with "images cannot travel this way
   *  yet" -- they can now. */
  images?: UserImage[];
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
  // Quota, presence and the task ceiling are checked BEFORE a process exists.
  try {
    guardDispatch(spec);
  } catch (err) {
    const refused = Promise.reject(err);
    refused.catch(() => {}); // observed here; the caller still sees the rejection
    return { promise: refused, cancel: () => {} };
  }
  const started = Date.now();
  const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxChars = spec.maxChars ?? DEFAULT_MAX_CHARS;
  let cancel: () => void = () => {};

  const raw =
    spec.agent === 'claude' ? runClaude(spec, timeoutMs, (c) => { cancel = c; })
      : runCodex(spec, timeoutMs, (c) => { cancel = c; });

  const base = { kind: 'dispatch' as const, agent: spec.agent, model: spec.model, capability: spec.capability, role: spec.role, taskId: spec.taskId };
  const promise = raw.then(
    (text) => {
      const trimmed = text.trim();
      if (!trimmed) throw new Error(`${spec.agent} dispatch returned no text`);
      const capped = truncate(trimmed, maxChars);
      const { text: clean, findings } = sanitizeAgentOutput(capped);
      const result: AgentTaskResult = {
        text: clean,
        agent: spec.agent,
        model: spec.model,
        ms: Date.now() - started,
        truncated: capped.length < trimmed.length,
        sanitized: findings,
      };
      logDecision({ ...base, ok: true, ms: result.ms, truncated: result.truncated, sanitized: findings.length });
      return result;
    },
    (err) => {
      logDecision({ ...base, ok: false, ms: Date.now() - started, error: String(err?.message ?? err) });
      throw err;
    },
  );

  return { promise, cancel: () => cancel() };
}

function runClaude(spec: AgentTaskSpec, timeoutMs: number, setCancel: (c: () => void) => void): Promise<string> {
  const allowed = new Set(toolsFor(spec.capability));
  // Streaming input mode is required for interrupt() to do anything -- a plain
  // string prompt makes cancel a silent no-op.
  const input = new AsyncQueue<any>();
  const content: any[] = (spec.images ?? []).map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } }));
  content.push({ type: 'text', text: spec.prompt });
  input.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, session_id: '' });
  const q: any = authedQuery({
    prompt: input as AsyncIterable<any>,
    options: {
      cwd: spec.cwd,
      model: spec.model,
      ...(spec.effort ? { effort: spec.effort } : {}),
      // A job asked for by name across vendors is real work, not a quick
      // answer: 24 steps ended "Next phase" mid-way with error_max_turns
      // (2026-09-29). The 20-minute timeout still bounds it.
      maxTurns: spec.capability === 'all' ? 150 : 40,
      // Load NO filesystem settings: a user/project settings file can carry
      // permissions.allow rules that approve tools without ever consulting
      // canUseTool, which would make this capability gate advisory.
      settingSources: [],
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
        reportClaudeUsage(spec, m);
        // Out of steps is not a failure of the work so far: keep what was
        // said and let the person say "keep going".
        if (m.subtype === 'error_max_turns') {
          return `${final || 'I made progress but ran out of steps for one go.'}\n\n_(I hit my step limit for one go — say "keep going" and I'll pick up where I stopped.)_`;
        }
        if (m.is_error === true || (typeof m.subtype === 'string' && m.subtype.startsWith('error'))) {
          throw new Error(`claude dispatch failed: ${typeof m.result === 'string' && m.result ? m.result.slice(0, 300) : m.subtype}`);
        }
        final = typeof m.result === 'string' ? m.result : final;
        break;
      }
    }
    return final;
  })();

  // Clear the loser's timer: left running it pins the event loop for the full
  // timeout after the work is already done.
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<string>((_, rej) => { timer = setTimeout(() => rej(new Error('dispatch timed out')), timeoutMs); });
  return Promise.race([collect, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
    input.close();
    void q.interrupt?.().catch(() => {});
  });
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
  setCancel(() => {
    rpc.kill();
    // Settle `done` now; a killed process sends no turn/completed.
    onNotification('error', { willRetry: false, error: { message: 'dispatch cancelled' } });
  });

  return (async () => {
    try {
      await rpc.request('initialize', {
        clientInfo: { name: 'roost', title: 'Roost', version: '0.1.0' },
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
      let timer: NodeJS.Timeout | undefined;
      const done = new Promise<string>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('dispatch timed out')), timeoutMs);
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
      // If turn/start itself rejects, nothing has subscribed to `done` yet and
      // its timer would reject unobserved later -- an unhandledRejection, which
      // takes the whole server down. Observe it, and always clear the timer.
      done.catch(() => {});
      try {
        await rpc.request('turn/start', {
          threadId,
          ...(spec.effort ? { effort: spec.effort } : {}),
          input: [...localImages(spec.images), { type: 'text', text: spec.prompt, text_elements: [] }],
        }, timeoutMs);
        return await done;
      } finally {
        if (timer) clearTimeout(timer);
      }
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
