import type { AgentKind } from './protocol.js';

/** Percent-of-window per token, measured -- the only honest cost currency on a
 *  flat-rate subscription. Tokens reported by a turn are NOT proportional to
 *  window burn (26 image-generation turns reporting ~270k tokens moved the
 *  Codex weekly window by 1%), so this is fitted from the quota history
 *  against the ledger rather than derived from a price table.
 *
 *  Method: every pair of consecutive quota observations for one window is an
 *  interval; the calls that fell inside it, if they were all on ONE model,
 *  are a sample of (tokens, percentage points). Sums, not means of ratios, so
 *  intervals that moved 0% still count -- they say the cost is below the
 *  window's resolution. Resets (percent fell) and long gaps (other machines'
 *  usage dominates) are skipped. Below three samples the answer is null. */

export interface HistoryRow {
  at: number;
  agent: AgentKind;
  key: string;
  usedPercent: number;
}

export interface CallRow {
  at: number;
  agent: AgentKind;
  model: string;
  inTok: number;
  outTok: number;
  cacheReadTok: number;
  cacheWriteTok: number;
}

export type Confidence = 'none' | 'low' | 'medium' | 'high';

export interface WeightEstimate {
  agent: AgentKind;
  key: string;
  model: string;
  /** null until there are enough single-model samples. Never 0 by default. */
  pctPerMillionTokens: number | null;
  samples: number;
  tokens: number;
  pctMoved: number;
  confidence: Confidence;
  note: string;
}

export interface WeightOptions {
  minSamples?: number;
  maxGapMs?: number;
}

const tokensOf = (c: CallRow) => c.inTok + c.outTok + c.cacheReadTok + c.cacheWriteTok;

export function estimateWeights(history: HistoryRow[], calls: CallRow[], opts: WeightOptions = {}): WeightEstimate[] {
  const minSamples = opts.minSamples ?? 3;
  const maxGapMs = opts.maxGapMs ?? 6 * 3600_000;
  const byWindow = new Map<string, HistoryRow[]>();
  for (const h of history) {
    if (typeof h.usedPercent !== 'number') continue;
    const k = `${h.agent}|${h.key}`;
    byWindow.set(k, [...(byWindow.get(k) ?? []), h]);
  }
  const sortedCalls = [...calls].sort((a, b) => a.at - b.at);
  const acc = new Map<string, { agent: AgentKind; key: string; model: string; tokens: number; pct: number; samples: number }>();

  for (const rows of byWindow.values()) {
    rows.sort((a, b) => a.at - b.at);
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1];
      const b = rows[i];
      const dPct = b.usedPercent - a.usedPercent;
      if (dPct < 0) continue; // the window reset inside this interval
      if (b.at - a.at > maxGapMs) continue; // too long: other machines' use dominates
      const inside = sortedCalls.filter((c) => c.agent === a.agent && c.at > a.at && c.at <= b.at);
      if (!inside.length) continue;
      const models = new Set(inside.map((c) => c.model));
      if (models.size !== 1) continue; // mixed intervals need a regression; not yet
      const model = inside[0].model;
      const tokens = inside.reduce((s, c) => s + tokensOf(c), 0);
      if (!tokens) continue;
      const k = `${a.agent}|${a.key}|${model}`;
      const cur = acc.get(k) ?? { agent: a.agent, key: a.key, model, tokens: 0, pct: 0, samples: 0 };
      cur.tokens += tokens;
      cur.pct += dPct;
      cur.samples += 1;
      acc.set(k, cur);
    }
  }

  const out: WeightEstimate[] = [];
  for (const v of acc.values()) {
    let confidence: Confidence = 'none';
    let pctPerMillionTokens: number | null = null;
    let note: string;
    if (v.samples < minSamples) {
      note = `${v.samples} sample${v.samples === 1 ? '' : 's'} — need ${minSamples}`;
    } else if (v.pct === 0) {
      note = `window did not move across ${v.tokens.toLocaleString()} tokens — cost is below the window's 1% resolution`;
    } else {
      pctPerMillionTokens = +((v.pct / v.tokens) * 1_000_000).toFixed(3);
      confidence = v.samples >= 30 ? 'high' : v.samples >= 10 ? 'medium' : 'low';
      note = `${v.pct}% over ${v.tokens.toLocaleString()} tokens in ${v.samples} single-model intervals`;
    }
    out.push({ agent: v.agent, key: v.key, model: v.model, pctPerMillionTokens, samples: v.samples, tokens: v.tokens, pctMoved: v.pct, confidence, note });
  }
  return out.sort((x, y) => y.samples - x.samples);
}
