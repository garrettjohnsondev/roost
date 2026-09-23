import { describe, expect, it } from 'vitest';
import { rotFor, fuelBlocks, expiringBlocks, typeSteps, typeDurationMs, ROT_START, ROT_FULL } from './motion';

describe('rotFor — colour drains only when quality actually drops', () => {
  it('drains nothing until degrading', () => {
    expect(rotFor(0)).toBe(0);
    expect(rotFor(ROT_START)).toBe(0);
  });
  it('ramps between degrading and full', () => {
    expect(rotFor(75)).toBe(0.5);
    expect(rotFor(ROT_FULL)).toBe(1);
    expect(rotFor(100)).toBe(1);
  });
  it('never drains on a missing reading — a grey character would be a lie', () => {
    expect(rotFor(null)).toBe(0);
    expect(rotFor(undefined)).toBe(0);
    expect(rotFor(NaN)).toBe(0);
  });
});

describe('fuelBlocks — only real spending flares', () => {
  it('marks exactly the blocks spent between two readings', () => {
    const b = fuelBlocks(40, 55, 20)!;
    expect(b.filter((x) => x === 'used')).toHaveLength(8);   // 0..40%
    expect(b.filter((x) => x === 'spent')).toHaveLength(3);  // 40..55%
    expect(b.filter((x) => x === 'free')).toHaveLength(9);
  });
  it('flares nothing on first sight', () => {
    expect(fuelBlocks(null, 55, 20)!.includes('spent')).toBe(false);
  });
  it('flares nothing on a reset, which is not spending', () => {
    expect(fuelBlocks(90, 10, 20)!.includes('spent')).toBe(false);
  });
  it('flares nothing when nothing moved', () => {
    expect(fuelBlocks(55, 55, 20)!.includes('spent')).toBe(false);
  });
  it('draws no blocks at all for a window with no reading', () => {
    expect(fuelBlocks(40, null)).toBeNull();
  });
  it('clamps rather than overflowing the track', () => {
    expect(fuelBlocks(null, 140, 20)!.every((x) => x === 'used')).toBe(true);
  });
});

describe('expiringBlocks — pulses only while capacity is genuinely at risk', () => {
  it('counts the headroom that will vanish', () => {
    expect(expiringBlocks(41, 10)).toBe(4);
  });
  it('is zero with no surplus, so the pulse stops when its cause does', () => {
    expect(expiringBlocks(0)).toBe(0);
    expect(expiringBlocks(null)).toBe(0);
    expect(expiringBlocks(-5)).toBe(0);
  });
});

describe('typing — a command should inform, not perform', () => {
  it('steps once per character for a short command', () => {
    expect(typeSteps('ls -la')).toBe(6);
  });
  it('caps the steps and the time for a long one', () => {
    const long = 'x'.repeat(400);
    expect(typeSteps(long)).toBe(48);
    expect(typeDurationMs(long)).toBe(900);
  });
  it('never produces zero steps or a zero-length animation', () => {
    expect(typeSteps('')).toBe(1);
    expect(typeDurationMs('')).toBeGreaterThan(0);
  });
});
