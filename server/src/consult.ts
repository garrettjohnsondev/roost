import { query } from '@anthropic-ai/claude-agent-sdk';
import { JsonRpcProcess } from './jsonrpc.js';
import { AsyncQueue, truncate } from './util.js';
import type { AgentKind } from './protocol.js';

/** Buzz-style pre-execution conference: the session's agent drafts a plan (read-only),
 *  the OTHER agent critiques it, and the user decides before anything executes. Both
 *  runs are one-shot throwaway processes so the real session's context stays clean —
 *  the plan+critique travel into execution inside the composed proceed prompt. */

const PLAN_CAP = 8000;
const CRITIQUE_CAP = 6000;
const ONE_SHOT_TIMEOUT_MS = 4 * 60_000;

export function composePlannerPrompt(task: string, context: string): string {
  return [
    'You are in PLANNING mode: explore the codebase read-only, change NOTHING.',
    context ? `Recent conversation context:\n${context}\n` : '',
    `Task to plan:\n${task}`,
    '',
    'Produce a concise implementation plan: the approach, files to touch, ordered steps, and risks/unknowns.',
    'No code edits, no commands that modify state. Keep it under 400 words.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function composeCriticPrompt(task: string, plan: string): string {
  return [
    "Another AI coding agent proposed a plan for this codebase. Review it critically (you may read files, change NOTHING).",
    `The task:\n${task}`,
    '',
    `The proposed plan:\n${plan}`,
    '',
    'Critique it: flag risks, missing steps, wrong assumptions, and simpler alternatives. Be specific and concise (under 250 words).',
    "End with exactly one line: 'VERDICT: SOLID' or 'VERDICT: NEEDS CHANGES'.",
  ].join('\n');
}

export function composeProceedPrompt(task: string, plan: string, critique: string): string {
  return [
    `Execute this task:\n${task}`,
    '',
    `Plan (from a pre-execution consult):\n${plan}`,
    '',
    `Independent reviewer critique:\n${critique}`,
    '',
    'Proceed with the implementation now, following the plan and incorporating the critique wherever it genuinely improves it.',
  ].join('\n');
}

const READ_ONLY_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebSearch', 'WebFetch', 'TodoWrite', 'Task']);

async function collectClaude(q: any): Promise<string> {
  const collect = (async () => {
    let final = '';
    for await (const m of q) {
      if (m.type === 'result') {
        final = typeof m.result === 'string' ? m.result : final;
        break;
      }
      if (m.type === 'assistant') {
        for (const block of m.message?.content ?? []) {
          if (block.type === 'text') final = block.text; // keep the latest full text block
        }
      }
    }
    return final;
  })();
  try {
    return await Promise.race([
      collect,
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('consult run timed out')), ONE_SHOT_TIMEOUT_MS)),
    ]);
  } finally {
    void q.interrupt?.().catch(() => {});
  }
}

function codexOneShotCancellable(cwd: string, prompt: string, model: string): { promise: Promise<string>; kill: () => void } {
  let onNotification: (method: string, params: any) => void = () => {};
  // mcp_servers={} — a consult is read-only exploration; MCP startup only adds delay.
  const rpc = new JsonRpcProcess('codex', ['app-server', '-c', 'mcp_servers={}'], cwd, {
    onRequest: async () => {
      throw new Error('consult runs are read-only');
    },
    onNotification: (method, params) => onNotification(method, params),
    onExit: () => {},
  });
  const promise = (async () => {
    try {
      await rpc.request('initialize', {
        clientInfo: { name: 'pocket', title: 'Pocket', version: '0.1.0' },
        capabilities: null,
      });
      rpc.notify('initialized');
      const started = await rpc.request('thread/start', {
        cwd,
        model: model || null,
        approvalPolicy: 'never',
        sandbox: 'read-only',
      });
      const threadId = started?.thread?.id;
      if (!threadId) throw new Error('codex consult thread failed to start');

      let lastMessage = '';
      let timer: NodeJS.Timeout | undefined;
      const done = new Promise<string>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('consult run timed out')), ONE_SHOT_TIMEOUT_MS);
        onNotification = (method, params) => {
          if (method === 'item/completed' && params?.item?.type === 'agentMessage' && params.item.text) {
            lastMessage = params.item.text;
          }
          if (method === 'turn/completed') {
            clearTimeout(timer);
            resolve(lastMessage);
          }
          if (method === 'error' && params?.willRetry === false) {
            clearTimeout(timer);
            reject(new Error(params?.error?.message ?? 'codex consult error'));
          }
        };
      });
      // A rejected turn/start left `done` unobserved with a live timer -- an
      // unhandledRejection minutes later. Observe it and always clear the timer.
      done.catch(() => {});
      try {
        await rpc.request('turn/start', { threadId, input: [{ type: 'text', text: prompt, text_elements: [] }] }, ONE_SHOT_TIMEOUT_MS);
        return await done;
      } finally {
        if (timer) clearTimeout(timer);
      }
    } finally {
      rpc.kill();
    }
  })();
  // Killing the process alone left `done` waiting for a turn/completed that
  // would never arrive: Stop appeared to hang for the full timeout.
  const kill = () => {
    rpc.kill();
    onNotification('error', { willRetry: false, error: { message: 'consult cancelled' } });
  };
  return { promise, kill };
}

export interface ConsultRun {
  promise: Promise<string>;
  cancel: () => void;
}

/** Starts a consult step and hands back a cancel handle, so a user Stop can actually
 *  kill the one-shot process instead of leaving it burning tokens in the background. */
export function startConsultStep(
  agent: AgentKind,
  cwd: string,
  prompt: string,
  model: string,
  phase: 'plan' | 'critique',
): ConsultRun {
  let cancel: () => void = () => {};
  const raw =
    agent === 'claude'
      ? (() => {
          // Streaming input mode is required for interrupt() to work at all — a plain
          // string prompt makes cancel a silent no-op (verified against the SDK docs).
          const input = new AsyncQueue<any>();
          input.push({ type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null, session_id: '' });
          const q: any = query({
            prompt: input as AsyncIterable<any>,
            options: {
              cwd,
              model,
              maxTurns: 12,
              // The SDK loads ALL filesystem settings when this is omitted, and a
              // settings file's permissions.allow rules approve tools without ever
              // consulting canUseTool -- which made "read-only" advisory.
              settingSources: [],
              canUseTool: async (toolName: string) =>
                READ_ONLY_TOOLS.has(toolName)
                  ? { behavior: 'allow', updatedInput: undefined as any }
                  : { behavior: 'deny', message: 'Consult runs are read-only.' },
            } as any,
          });
          cancel = () => {
            input.close();
            void q.interrupt?.().catch(() => {});
          };
          return collectClaude(q).finally(() => input.close());
        })()
      : (() => {
          const { promise, kill } = codexOneShotCancellable(cwd, prompt, model);
          cancel = kill;
          return promise;
        })();
  const promise = raw.then((out) => {
    const trimmed = out.trim();
    if (!trimmed) throw new Error(`${agent} consult run returned no text`);
    return truncate(trimmed, phase === 'plan' ? PLAN_CAP : CRITIQUE_CAP);
  });
  return { promise, cancel: () => cancel() };
}
