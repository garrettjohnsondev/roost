import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'pocket-pricing-'));
process.env.POCKET_CONFIG = join(tmp, 'pocket.config.json');
// Hermetic: never fall through to the real ~/.agent-sync/prices.json, whose live
// overrides (opus 5/25) would otherwise make the table assertions machine-dependent.
process.env.POCKET_LEGACY_PRICES = '';
writeFileSync(process.env.POCKET_CONFIG, '{}');

const { priceFor, estimateCost, resetPriceCache } = await import('../src/pricing.js');

beforeEach(() => resetPriceCache());
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('priceFor', () => {
  it('prices known Claude families from the table', () => {
    expect(priceFor('claude-haiku-4-5').price).toEqual({ input: 1, output: 5, cacheRead: undefined, cacheWrite: undefined });
    expect(priceFor('sonnet').basis).toBe('table');
    expect(priceFor('claude-opus-5').price?.output).toBe(75);
    expect(priceFor('claude-fable-5').price?.output).toBe(75);
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
    mkdirSync(join(tmp, '.pocket-data'), { recursive: true });
    writeFileSync(join(tmp, '.pocket-data', 'prices.json'), JSON.stringify([{ match: 'opus', input: 5, output: 25 }]));
    resetPriceCache();
    const lookup = priceFor('claude-opus-5');
    expect(lookup.basis).toBe('override');
    expect(lookup.price).toMatchObject({ input: 5, output: 25 });
  });

  it('survives a malformed override regex without throwing', () => {
    mkdirSync(join(tmp, '.pocket-data'), { recursive: true });
    writeFileSync(join(tmp, '.pocket-data', 'prices.json'), JSON.stringify([{ match: '[unclosed', input: 1, output: 2 }]));
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
    expect(plain.usd).toBeCloseTo(3, 6);
    expect(cached.usd).toBeCloseTo(0.3, 6);
  });

  it('sums input, output and cache legs', () => {
    const out = estimateCost('haiku', { inTok: 1_000_000, outTok: 1_000_000, cacheReadTok: 1_000_000, cacheWriteTok: 1_000_000 });
    // 1 + 5 + 0.1 + 1.25
    expect(out.usd).toBeCloseTo(7.35, 6);
  });
});
