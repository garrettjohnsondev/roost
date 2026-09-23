import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { dataDir } from './config.js';

/** $/MTok. cacheRead/cacheWrite default to Anthropic-style multiples of input
 *  (0.1x read, 1.25x write) when a row doesn't state them. */
export interface Price {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** Where a price came from. 'unknown' is a real answer and must stay visible:
 *  agent-sync's price table ended in a catch-all row, so every unmatched Codex
 *  model silently priced as Sonnet and every downstream figure was wrong. */
export type PriceBasis = 'sdk' | 'override' | 'table' | 'unknown';

export interface PriceLookup {
  price: Price | null;
  basis: PriceBasis;
  matched?: string;
}

export interface PricedTokens {
  inTok: number;
  outTok: number;
  cacheReadTok?: number;
  cacheWriteTok?: number;
}

/** First hit wins, so narrower patterns come first. There is deliberately NO
 *  catch-all: an unmatched model returns basis 'unknown' and costs null. */
/** Rates from the official model table, read 2026-09-22, in $/MTok.
 *
 *  The previous three rows were stale in two different ways and both produced
 *  confident wrong numbers rather than honest nulls: sonnet was priced at 3/15
 *  against a published 2/10, and ONE row matched /opus|fable/ at 15/75 while
 *  those are two models at 4/20 and 10/50 — overstating Opus by nearly 4x.
 *
 *  Each pattern matches two things and nothing else: the pinned id
 *  (`claude-opus-5-5`) and the BARE ALIAS anchored at the start (`opus`,
 *  `opus[1m]`), because Roost's own registry exposes Claude as aliases and a
 *  version-only pattern would leave every real call unpriced.
 *
 *  A legacy model — `claude-opus-5`, `claude-sonnet-4-5`, `claude-fable-5` —
 *  deliberately matches NOTHING and comes back `unknown` with a null cost. That
 *  is the correct answer rather than a gap: this file does not have their
 *  published rates, and an alias-shaped pattern that swallowed them would price
 *  a legacy Opus at its successor's rate. Claude reports its own authoritative
 *  cost per call anyway; this table is the fallback for when it does not. */
const PRICE_TABLE: Array<{ match: RegExp; label: string } & Price> = [
  { match: /haiku-4-5|^haiku/i, label: 'claude-haiku-4-5', input: 1, output: 5, cacheRead: 0.1 },
  { match: /sonnet-5|^sonnet/i, label: 'claude-sonnet-5', input: 2, output: 10, cacheRead: 0.2 },
  // Cache reads are NOT a flat 10% of input: the published rate is 2.5% on
  // Fable 5.1 and 5% on Opus 5.5. The generic fallback below would have charged
  // both at 10%, overstating a cached Fable read by 4x — and cached reads are
  // most of the input on a long agent session, so it is not a rounding error.
  { match: /fable-5-1|^fable/i, label: 'claude-fable-5-1', input: 10, output: 50, cacheRead: 0.25 },
  { match: /opus-5-5|^opus/i, label: 'claude-opus-5-5', input: 4, output: 20, cacheRead: 0.2 },
];

interface OverrideRow extends Price {
  match: string;
}

let overrideCache: { rows: OverrideRow[]; from: string | null; at: number } | null = null;
const OVERRIDE_TTL_MS = 30_000;

function readRows(file: string): OverrideRow[] | null {
  try {
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((r) => r && typeof r.match === 'string' && typeof r.input === 'number' && typeof r.output === 'number');
  } catch {
    return null;
  }
}

/** Where to look for rates carried over from agent-sync. Explicit and overridable
 *  because an implicit read of $HOME makes pricing depend on the machine — set
 *  ROOST_LEGACY_PRICES='' to disable it entirely (tests do). */
export function legacyPricesPath(): string {
  return (process.env.ROOST_LEGACY_PRICES ?? process.env.POCKET_LEGACY_PRICES) ?? join(homedir(), '.agent-sync', 'prices.json');
}

/** User-supplied rates beat the table. Reads <dataDir>/prices.json, falling back
 *  to the legacy agent-sync file so rates measured there carry over without
 *  re-entry. */
export function priceOverrides(): { rows: OverrideRow[]; from: string | null } {
  if (overrideCache && Date.now() - overrideCache.at < OVERRIDE_TTL_MS) return overrideCache;
  const primary = join(dataDir(), 'prices.json');
  const legacy = legacyPricesPath();
  let rows = readRows(primary);
  let from: string | null = rows ? primary : null;
  if (!rows && legacy) {
    rows = readRows(legacy);
    from = rows ? legacy : null;
  }
  overrideCache = { rows: rows ?? [], from, at: Date.now() };
  return overrideCache;
}

export function resetPriceCache(): void {
  overrideCache = null;
}

export function priceFor(model: string | undefined | null): PriceLookup {
  const m = String(model ?? '').trim();
  if (!m) return { price: null, basis: 'unknown' };

  for (const row of priceOverrides().rows) {
    let re: RegExp;
    try {
      re = new RegExp(row.match, 'i');
    } catch {
      continue;
    }
    if (re.test(m)) {
      return { price: { input: row.input, output: row.output, cacheRead: row.cacheRead, cacheWrite: row.cacheWrite }, basis: 'override', matched: row.match };
    }
  }

  const hit = PRICE_TABLE.find((p) => p.match.test(m));
  if (hit) return { price: { input: hit.input, output: hit.output, cacheRead: hit.cacheRead, cacheWrite: hit.cacheWrite }, basis: 'table', matched: hit.label };

  return { price: null, basis: 'unknown' };
}

/** Never returns 0 for "we don't know" — that conflation is what produced
 *  agent-sync's fictional savings numbers. Unknown prices return null. */
export function estimateCost(model: string | undefined | null, t: PricedTokens): { usd: number | null; basis: PriceBasis } {
  const { price, basis } = priceFor(model);
  if (!price) return { usd: null, basis: 'unknown' };
  const cacheRead = price.cacheRead ?? price.input * 0.1;
  const cacheWrite = price.cacheWrite ?? price.input * 1.25;
  const usd =
    (t.inTok / 1e6) * price.input +
    (t.outTok / 1e6) * price.output +
    ((t.cacheReadTok ?? 0) / 1e6) * cacheRead +
    ((t.cacheWriteTok ?? 0) / 1e6) * cacheWrite;
  return { usd: +usd.toFixed(6), basis };
}
