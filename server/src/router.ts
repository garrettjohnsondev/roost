import type { CallDelta } from './agents/types.js';
import { runAgentTask } from './agents/dispatch.js';
import type { AgentKind } from './protocol.js';
import { authedQuery } from './claudeAuth.js';
import { repoRoot } from './config.js';

export type Tier = 'light' | 'standard' | 'heavy';

/** Decision 3's gate input: small = fewer than ~10 files AND fewer than 3
 *  independent pieces. Unknown never counts as small. */
export type TaskSize = 'small' | 'medium' | 'large';

export interface TriageResult {
  tier: Tier;
  size?: TaskSize;
  reason: string;
  /** What the classifier actually said, kept only when its answer could not be
   *  used. A live triage once came back "unparseable" and there was no way to
   *  tell whether the model misbehaved or the call returned nothing — the reply
   *  had been thrown away. */
  raw?: string;
}

const TRIAGE_PROMPT = `You are a dispatcher deciding how capable a coding agent needs to be for a task. Classify into exactly one tier:
- light: trivial — quick questions, one-line edits, renames, lookups, formatting
- standard: normal coding — implement a feature, fix a clear bug, write tests, small refactors
- heavy: complex — architecture/design, large or cross-cutting refactors, gnarly debugging, performance/concurrency work, or the user explicitly asks for thorough/deep work

Also estimate SIZE: small = touches fewer than ~10 files AND fewer than 3 independent pieces of work; large = 10+ files or 3+ independent pieces; medium = in between or unsure.

Reply with ONLY this JSON, nothing else: {"tier":"light|standard|heavy","size":"small|medium|large","reason":"<max 8 words>"}

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
        const size = parsed.size === 'small' || parsed.size === 'medium' || parsed.size === 'large' ? parsed.size : undefined;
        return { tier: parsed.tier, size, reason: String(parsed.reason ?? '').slice(0, 80) };
      }
    } catch {
      /* fall through to keyword scan */
    }
  }
  const keyword = text.match(/\b(light|standard|heavy)\b/i)?.[1]?.toLowerCase() as Tier | undefined;
  if (keyword) return { tier: keyword, reason: 'keyword match' };
  // An empty reply is a failed CALL, not a model that answered badly; saying
  // "unparseable" for both sent the only investigation down the wrong road.
  if (!text.trim()) return { tier: 'standard', reason: 'triage returned nothing — defaulted', raw: '' };
  return { tier: 'standard', reason: 'triage unparseable — defaulted', raw: text.slice(0, 300) };
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
export async function triage(text: string, agent: AgentKind = 'claude', lightModel?: string, onCall?: (d: CallDelta) => void): Promise<TriageResult> {
  // A Codex session must not silently depend on a Claude subscription. On a
  // Codex-only install the Haiku probe failed every time and every task
  // "defaulted" to standard with no one told. Classify on the session's own
  // vendor, on its light tier.
  if (agent === 'codex') {
    try {
      const r = await runAgentTask({
        agent: 'codex', model: lightModel ?? '', effort: 'low', capability: 'read-only', cwd: repoRoot,
        prompt: TRIAGE_PROMPT + text.slice(0, 2000), timeoutMs: TRIAGE_TIMEOUT_MS * 2, maxChars: 400, role: 'triage', onCall,
      }).promise;
      return parseTriage(r.text);
    } catch {
      return { tier: 'standard', reason: 'triage failed — defaulted' };
    }
  }
  const q: any = authedQuery({
    prompt: TRIAGE_PROMPT + text.slice(0, 2000),
    // A classifier needs no CLAUDE.md, skills or MCP servers; loading them only
    // slows the probe and widens what it can do.
    options: { model: lightModel || 'haiku', maxTurns: 1, cwd: repoRoot, settingSources: [] } as any,
  });
  const collect = (async () => {
    let out = '';
    let finalText = '';
    for await (const m of q) {
      if (m.type === 'assistant') {
        for (const block of m.message?.content ?? []) {
          if (block.type === 'text') out += block.text;
        }
      }
      if (m.type === 'result') {
        // The result message carries the final answer too. If no text block
        // arrived — a thinking-only turn, say — this is the answer, not nothing.
        if (typeof m.result === 'string') finalText = m.result;
        // One turn: modelUsage is the per-call figure. Triage used to be
        // invisible to the ledger -- a cost on every routed message, unrecorded.
        if (onCall) {
          for (const [model, u] of Object.entries<any>(m.modelUsage ?? {})) {
            const priced = (u?.costBasis ?? 'list') !== 'unknown' && typeof u?.costUSD === 'number';
            onCall({ agent: 'claude', model, inTok: u?.inputTokens ?? 0, outTok: u?.outputTokens ?? 0, cacheReadTok: u?.cacheReadInputTokens ?? 0, cacheWriteTok: u?.cacheCreationInputTokens ?? 0, reasoningTok: u?.thinkingTokens ?? undefined, costUsd: priced ? u.costUSD : null, costBasis: priced ? 'sdk' : 'unknown' });
          }
        }
        break;
      }
    }
    return out.trim() ? out : finalText;
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
