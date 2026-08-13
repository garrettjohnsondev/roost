import { query } from '@anthropic-ai/claude-agent-sdk';
import { JsonRpcProcess } from './jsonrpc.js';
import { truncate } from './util.js';
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

async function claudeOneShot(cwd: string, prompt: string, model: string): Promise<string> {
  const q: any = query({
    prompt,
    options: {
      cwd,
      model,
      maxTurns: 12,
      canUseTool: async (toolName: string) =>
        READ_ONLY_TOOLS.has(toolName)
          ? { behavior: 'allow', updatedInput: undefined as any }
          : { behavior: 'deny', message: 'Consult runs are read-only.' },
    } as any,
  });
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

async function codexOneShot(cwd: string, prompt: string, model: string): Promise<string> {
  const rpc = new JsonRpcProcess('codex', ['app-server'], cwd, {
    onRequest: async () => {
      throw new Error('consult runs are read-only');
    },
    onNotification: () => {},
    onExit: () => {},
  });
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
    const done = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('consult run timed out')), ONE_SHOT_TIMEOUT_MS);
      (rpc as any).handlers.onNotification = (method: string, params: any) => {
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
    await rpc.request('turn/start', { threadId, input: [{ type: 'text', text: prompt, text_elements: [] }] }, ONE_SHOT_TIMEOUT_MS);
    return await done;
  } finally {
    rpc.kill();
  }
}

export async function runConsultStep(
  agent: AgentKind,
  cwd: string,
  prompt: string,
  model: string,
  phase: 'plan' | 'critique',
): Promise<string> {
  const out = agent === 'claude' ? await claudeOneShot(cwd, prompt, model) : await codexOneShot(cwd, prompt, model);
  const trimmed = out.trim();
  if (!trimmed) throw new Error(`${agent} consult run returned no text`);
  return truncate(trimmed, phase === 'plan' ? PLAN_CAP : CRITIQUE_CAP);
}
