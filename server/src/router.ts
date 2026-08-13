import { query } from '@anthropic-ai/claude-agent-sdk';
import { repoRoot } from './config.js';

export type Tier = 'light' | 'standard' | 'heavy';

export interface TriageResult {
  tier: Tier;
  reason: string;
}

const TRIAGE_PROMPT = `You are a dispatcher deciding how capable a coding agent needs to be for a task. Classify into exactly one tier:
- light: trivial — quick questions, one-line edits, renames, lookups, formatting
- standard: normal coding — implement a feature, fix a clear bug, write tests, small refactors
- heavy: complex — architecture/design, large or cross-cutting refactors, gnarly debugging, performance/concurrency work, or the user explicitly asks for thorough/deep work

Reply with ONLY this JSON, nothing else: {"tier":"light|standard|heavy","reason":"<max 8 words>"}

Task:
`;

/** Pull a tier out of whatever the triage model actually said — strict JSON first,
 *  keyword fallback second, 'standard' as the safe default. */
export function parseTriage(text: string): TriageResult {
  const jsonMatch = text.match(/\{[^{}]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.tier === 'light' || parsed.tier === 'standard' || parsed.tier === 'heavy') {
        return { tier: parsed.tier, reason: String(parsed.reason ?? '').slice(0, 80) };
      }
    } catch {
      /* fall through to keyword scan */
    }
  }
  const keyword = text.match(/\b(light|standard|heavy)\b/i)?.[1]?.toLowerCase() as Tier | undefined;
  return { tier: keyword ?? 'standard', reason: keyword ? 'keyword match' : 'triage unparseable — defaulted' };
}

const TASK_HINT = /\b(refactor|architect|redesign|rewrite|overhaul|debug|investigate|migrate|deep|thorough|carefully|complex|entire|across|implement|build|create|add|fix)\b/i;

/** Cheap local check for follow-up messages: re-triage only when the message reads like
 *  a NEW task (length or task-verb heuristic) rather than a continuation ("yes, do that").
 *  Applies in both directions — a heavy session gets to route back DOWN when the next
 *  task is trivial, instead of burning top-tier tokens on everything forever; and
 *  continuations stay on the current tier because mid-task model churn hurts more than
 *  a few over-provisioned turns. */
export function shouldRetriage(text: string, _currentTier: Tier): boolean {
  return text.length > 280 || TASK_HINT.test(text);
}

const TRIAGE_TIMEOUT_MS = 20_000;

/** One-shot Haiku classification. Falls back to 'standard' on any failure — a routing
 *  hiccup should never block the actual message. */
export async function triage(text: string): Promise<TriageResult> {
  const q: any = query({
    prompt: TRIAGE_PROMPT + text.slice(0, 2000),
    options: { model: 'haiku', maxTurns: 1, cwd: repoRoot } as any,
  });
  const collect = (async () => {
    let out = '';
    for await (const m of q) {
      if (m.type === 'assistant') {
        for (const block of m.message?.content ?? []) {
          if (block.type === 'text') out += block.text;
        }
      }
      if (m.type === 'result') break;
    }
    return out;
  })();
  try {
    const out = await Promise.race([
      collect,
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('triage timeout')), TRIAGE_TIMEOUT_MS)),
    ]);
    return parseTriage(out);
  } catch {
    return { tier: 'standard', reason: 'triage failed — defaulted' };
  } finally {
    void q.interrupt?.().catch(() => {});
  }
}
