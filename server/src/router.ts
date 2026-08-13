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

const UPGRADE_HINT = /\b(refactor|architect|redesign|rewrite|overhaul|debug|investigate|migrate|deep|thorough|carefully|complex|entire|across)\b/i;
const TIER_RANK: Record<Tier, number> = { light: 0, standard: 1, heavy: 2 };

/** Cheap local check for follow-up messages: only bother re-triaging when the new
 *  message plausibly outgrows the current tier — keeps triage cost off quick replies. */
export function shouldRetriage(text: string, currentTier: Tier): boolean {
  if (currentTier === 'heavy') return false; // nowhere to go but down; stay put
  return text.length > 280 || UPGRADE_HINT.test(text);
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
