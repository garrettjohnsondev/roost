/** Whether Codex's TokenUsageBreakdown.inputTokens already INCLUDES
 *  cachedInputTokens is not stated in the generated protocol types, and the
 *  answer changes cost by up to 10x (cache reads bill at ~1/10 of input).
 *
 *  Both readings are handled in one place: if inputTokens is at least as large
 *  as cachedInputTokens we assume inclusive and subtract; otherwise the fields
 *  are clearly exclusive and we pass them through. The second branch also proves
 *  the assumption wrong, so it warns once rather than silently mis-billing. */
let warned = false;

export function splitCodexInput(inputTokens: number, cachedInputTokens: number): { uncached: number; cached: number } {
  const input = Math.max(0, Number(inputTokens) || 0);
  const cached = Math.max(0, Number(cachedInputTokens) || 0);
  if (!cached) return { uncached: input, cached: 0 };
  if (input >= cached) return { uncached: input - cached, cached };
  if (!warned) {
    warned = true;
    console.warn(`[pocket] codex inputTokens(${input}) < cachedInputTokens(${cached}) — fields are exclusive, not inclusive. Treating input as uncached.`);
  }
  return { uncached: input, cached };
}

export function __resetSplitWarningForTests(): void {
  warned = false;
}
