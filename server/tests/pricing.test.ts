import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'roost-pricing-'));
process.env.ROOST_CONFIG = join(tmp, 'roost.config.json');
// Hermetic: never fall through to the real ~/.agent-sync/prices.json, whose live
// overrides (opus 5/25) would otherwise make the table assertions machine-dependent.
process.env.ROOST_LEGACY_PRICES = '';
writeFileSync(process.env.ROOST_CONFIG, '{}');

const { priceFor, estimateCost, resetPriceCache } = await import('../src/pricing.js');

beforeEach(() => resetPriceCache());
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('priceFor', () => {
  it('prices known Claude families from the table', () => {
    expect(priceFor('claude-haiku-4-5').price).toEqual({ input: 1, output: 5, cacheRead: 0.1, cacheWrite: undefined });
    expect(priceFor('sonnet').basis).toBe('table');
    // Published rates, read from the model table 2026-09-22.
    expect(priceFor('claude-opus-5-5').price).toMatchObject({ input: 4, output: 20 });
    expect(priceFor('opus[1m]').price).toMatchObject({ input: 4, output: 20 });
    expect(priceFor('claude-fable-5-1').price).toMatchObject({ input: 10, output: 50 });
    expect(priceFor('claude-sonnet-5').price).toMatchObject({ input: 2, output: 10 });
  });

  it('leaves a legacy model unpriced rather than charging its successor’s rate', () => {
    // One row used to match /opus|fable/ at 15/75 — two models, neither of which
    // costs that. Now a model whose published rate this file does not have comes
    // back unknown, which is a fact; a number would have been a guess.
    for (const legacy of ['claude-opus-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-fable-5']) {
      const p = priceFor(legacy);
      expect(p.basis, legacy).toBe('unknown');
      expect(p.price, legacy).toBeFalsy();
    }
  });

  // THE agent-sync regression: its PRICE_TABLE ended in a catch-all {match:/./,
  // input:3, output:15}, so every Codex model (recorded with model:'') matched
  // Sonnet's row and 196 calls were billed at Sonnet rates.
  it('does NOT silently price an unknown Codex model as Sonnet', () => {
    const lookup = priceFor('gpt-5.6-sol');
    expect(lookup.basis).toBe('unknown');
    expect(lookup.price).toBeNull();
    expect(priceFor('gpt-5.6-sol').price?.input).not.toBe(3);
  });

  it('treats empty and missing models as unknown, not free', () => {
    expect(priceFor('').basis).toBe('unknown');
    expect(priceFor(undefined).basis).toBe('unknown');
    expect(priceFor(null).basis).toBe('unknown');
  });

  it('lets user overrides beat the built-in table', () => {
    mkdirSync(join(tmp, '.roost-data'), { recursive: true });
    writeFileSync(join(tmp, '.roost-data', 'prices.json'), JSON.stringify([{ match: 'opus', input: 5, output: 25 }]));
    resetPriceCache();
    const lookup = priceFor('claude-opus-5');
    expect(lookup.basis).toBe('override');
    expect(lookup.price).toMatchObject({ input: 5, output: 25 });
  });

  it('survives a malformed override regex without throwing', () => {
    mkdirSync(join(tmp, '.roost-data'), { recursive: true });
    writeFileSync(join(tmp, '.roost-data', 'prices.json'), JSON.stringify([{ match: '[unclosed', input: 1, output: 2 }]));
    resetPriceCache();
    expect(() => priceFor('sonnet')).not.toThrow();
    expect(priceFor('sonnet').basis).toBe('table');
  });
});

describe('estimateCost', () => {
  it('returns null — never 0 — when the model is unpriceable', () => {
    const out = estimateCost('some-unknown-model', { inTok: 1_000_000, outTok: 1_000_000 });
    expect(out.usd).toBeNull();
    expect(out.basis).toBe('unknown');
  });

  it('charges cache reads at a tenth of input by default', () => {
    const plain = estimateCost('sonnet', { inTok: 1_000_000, outTok: 0 });
    const cached = estimateCost('sonnet', { inTok: 0, outTok: 0, cacheReadTok: 1_000_000 });
    // Sonnet 5 is $2/MTok in, and its cache reads are the standard 10% of that.
    expect(plain.usd).toBeCloseTo(2, 6);
    expect(cached.usd).toBeCloseTo(0.2, 6);
  });

  it('sums input, output and cache legs', () => {
    const out = estimateCost('haiku', { inTok: 1_000_000, outTok: 1_000_000, cacheReadTok: 1_000_000, cacheWriteTok: 1_000_000 });
    // 1 + 5 + 0.1 + 1.25
    expect(out.usd).toBeCloseTo(7.35, 6);
  });
});

describe('cache reads follow each model’s published rate, not a flat 10%', () => {
  it('charges Fable cache reads at 2.5% and Opus at 5% of input', () => {
    // A generic 10% fallback overstated a cached Fable read by 4x, and on a long
    // agent session cached reads are most of the input.
    expect(estimateCost('claude-fable-5-1', { inTok: 0, outTok: 0, cacheReadTok: 1_000_000 }).usd).toBeCloseTo(0.25, 6);
    expect(estimateCost('claude-opus-5-5', { inTok: 0, outTok: 0, cacheReadTok: 1_000_000 }).usd).toBeCloseTo(0.2, 6);
  });
})
