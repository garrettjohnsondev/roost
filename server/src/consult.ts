import type { CallDelta } from './agents/types.js';
import { authedQuery } from './claudeAuth.js';
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

export function composePlannerPrompt(task: string, context: string, fuel = ''): string {
  return [
    'You are in PLANNING mode: explore the codebase read-only, change NOTHING.',
    context ? `Recent conversation context:\n${context}\n` : '',
    fuel ? `Fuel (subscription windows, live):\n${fuel}\n` : '',
    `Task to plan:\n${task}`,
    '',
    'Produce a concise implementation plan with EXACTLY these sections, in this order:',
    '## Approach — two or three sentences.',
    '## Files — the files you will touch, one per line, each with why.',
    '## Steps — ordered, each naming the file it touches.',
    '## Acceptance criteria — 3 to 7 bullet points, each a statement that can be CHECKED (a command that passes, a behaviour that can be observed), not a restatement of the steps.',
    '## Risks — unknowns and what would make this plan wrong.',
    fuel
      ? '## Fit — one line: will this plan likely fit in what is left of the tightest window above? If not: name a "First slice" that fits, and a "Remainder" to park on the roadmap; if the other vendor has room, say the remainder could go there.'
      : '',
    'Ground every step in code you actually read. If the task as stated cannot be met, say so under Risks.',
    'No code edits, no commands that modify state. Keep it under 500 words.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** The reviewer is STARVED: task, plan and criteria only. Including the
 *  author's reasoning made cross-context review worse than self-review. */
export function composeCriticPrompt(task: string, plan: string, criteria: string[] = []): string {
  return [
    'Another AI coding agent proposed a plan for this codebase. Review it (you may read files, change NOTHING).',
    `The task:\n${task}`,
    '',
    criteria.length ? `Acceptance criteria the plan must satisfy:\n${criteria.map((c) => `- ${c}`).join('\n')}\n` : '',
    `The proposed plan:\n${plan}`,
    '',
    'Report ONLY correctness problems and requirement gaps: a step that will not work, a criterion the plan does not meet, an assumption the code contradicts.',
    'Do not report style, do not suggest refactors, and do not invent findings to seem useful -- "no problems found" is a valid and useful answer. Be specific and concise (under 250 words).',
    "End with exactly one line: 'VERDICT: SOLID' or 'VERDICT: NEEDS CHANGES'.",
  ]
    .filter(Boolean)
    .join('\n');
}

/** Reconcile: the author filters the reviewer's findings against the task and
 *  the criteria BEFORE anyone acts on them. Without this step, review findings
 *  become scope creep -- a reviewer asked for gaps will find them. */
export function composeReconcilePrompt(task: string, plan: string, critique: string, criteria: string[] = []): string {
  return [
    'You wrote a plan; an independent reviewer critiqued it. Reconcile the two (read-only, change NOTHING).',
    `The task:\n${task}`,
    '',
    criteria.length ? `Acceptance criteria (these outrank both the plan and the review):\n${criteria.map((c) => `- ${c}`).join('\n')}\n` : '',
    `Your plan:\n${plan}`,
    '',
    `The review:\n${critique}`,
    '',
    'For EACH finding in the review decide: ACCEPT (it identifies a real problem with meeting the task or the criteria -- amend the plan) or REJECT (out of scope, contradicts the criteria, already covered, or a matter of taste -- leave the plan alone).',
    'Output the amended plan with the same sections as before (Approach, Files, Steps, Acceptance criteria, Risks), then a final section:',
    '## Reconciliation — one line per finding: ACCEPTED or REJECTED, and why, in under 20 words each.',
    'Do not add work the task did not ask for. Keep it under 600 words.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function composeProceedPrompt(task: string, plan: string, critique: string, criteria: string[] = []): string {
  return [
    `Execute this task:\n${task}`,
    '',
    // Criteria travel WITH the task and are stated to outrank the plan --
    // executors treating a plan as authority over requirements was the failure.
    criteria.length ? `Acceptance criteria -- these outrank the plan; if they conflict, the criteria win and you say so:\n${criteria.map((c) => `- ${c}`).join('\n')}\n` : '',
    `Plan (reviewed and reconciled before execution):\n${plan}`,
    '',
    critique ? `The reviewer's findings, for context (the plan above already reconciles them):\n${critique}\n` : '',
    'Proceed with the implementation now. The harness will run the project gates when you finish; do not edit or run the gate definitions yourself.',
  ]
    .filter(Boolean)
    .join('\n');
}

const READ_ONLY_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebSearch', 'WebFetch', 'TodoWrite', 'Task']);

/** A one-shot is one turn, so its result's modelUsage IS the per-call figure.
 *  costBasis:'unknown' means the SDK guessed the price; that is recorded as
 *  unknown, never as authoritative. */
function claudeDeltas(result: any): CallDelta[] {
  const out: CallDelta[] = [];
  for (const [model, u] of Object.entries<any>(result?.modelUsage ?? {})) {
    const basis = u?.costBasis ?? 'list';
    const priced = basis !== 'unknown' && typeof u?.costUSD === 'number';
    out.push({
      agent: 'claude', model,
      inTok: u?.inputTokens ?? 0, outTok: u?.outputTokens ?? 0,
      cacheReadTok: u?.cacheReadInputTokens ?? 0, cacheWriteTok: u?.cacheCreationInputTokens ?? 0,
      reasoningTok: u?.thinkingTokens ?? undefined,
      costUsd: priced ? u.costUSD : null, costBasis: priced ? 'sdk' : 'unknown',
      agentSessionId: result?.session_id,
    });
  }
  return out;
}

function codexDeltaFromLast(last: any, model: string): CallDelta | null {
  if (!last) return null;
  return {
    agent: 'codex', model,
    inTok: last.inputTokens ?? 0, outTok: last.outputTokens ?? 0,
    cacheReadTok: last.cachedInputTokens ?? 0, cacheWriteTok: 0,
    reasoningTok: last.reasoningOutputTokens ?? undefined,
    costUsd: null, costBasis: 'unknown',
  };
}

async function collectClaude(q: any, onResult?: (m: any) => void): Promise<string> {
  const collect = (async () => {
    let final = '';
    for await (const m of q) {
      if (m.type === 'result') {
        final = typeof m.result === 'string' ? m.result : final;
        onResult?.(m);
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

function codexOneShotCancellable(cwd: string, prompt: string, model: string, onUsage?: (last: any, model: string) => void): { promise: Promise<string>; kill: () => void } {
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
        clientInfo: { name: 'roost', title: 'Roost', version: '0.1.0' },
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
      let lastUsage: any = null;
      let timer: NodeJS.Timeout | undefined;
      const done = new Promise<string>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('consult run timed out')), ONE_SHOT_TIMEOUT_MS);
        onNotification = (method, params) => {
          if (method === 'item/completed' && params?.item?.type === 'agentMessage' && params.item.text) {
            lastMessage = params.item.text;
          }
          if (method === 'thread/tokenUsage/updated') {
            lastUsage = params?.tokenUsage?.last ?? null; // this turn; never `total`
          }
          if (method === 'turn/completed') {
            clearTimeout(timer);
            onUsage?.(lastUsage, started?.thread?.model ?? model);
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
  phase: 'plan' | 'critique' | 'reconcile',
  onCall?: (d: CallDelta) => void,
): ConsultRun {
  let cancel: () => void = () => {};
  const raw =
    agent === 'claude'
      ? (() => {
          // Streaming input mode is required for interrupt() to work at all — a plain
          // string prompt makes cancel a silent no-op (verified against the SDK docs).
          const input = new AsyncQueue<any>();
          input.push({ type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null, session_id: '' });
          const q: any = authedQuery({
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
          return collectClaude(q, (m) => { for (const d of claudeDeltas(m)) onCall?.(d); }).finally(() => input.close());
        })()
      : (() => {
          const { promise, kill } = codexOneShotCancellable(cwd, prompt, model, (last, m) => { const d = codexDeltaFromLast(last, m); if (d) onCall?.(d); });
          cancel = kill;
          return promise;
        })();
  const promise = raw.then((out) => {
    const trimmed = out.trim();
    if (!trimmed) throw new Error(`${agent} consult run returned no text`);
    return truncate(trimmed, phase === 'critique' ? CRITIQUE_CAP : PLAN_CAP);
  });
  return { promise, cancel: () => cancel() };
}
