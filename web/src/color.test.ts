import { describe, expect, it } from 'vitest';
import { contrast, readableOn, ROOST_GROUND } from './color';

const CREW = { Ollie: '#2f3a72', Moss: '#205a1d', Wren: '#673eb4', Juno: '#e65608', Pip: '#c9803a', Bram: '#5b45c7', Otto: '#1543a5', Fig: '#0f766e' };

describe('crew names on the Roost ground', () => {
  it('starts from colours that are genuinely unreadable there', () => {
    // The reason this file exists: Ollie's name was all but invisible.
    expect(contrast(CREW.Ollie, ROOST_GROUND)!).toBeLessThan(2);
  });
  it('brings every crew colour up to WCAG AA, 4.5:1', () => {
    for (const [name, c] of Object.entries(CREW)) {
      expect(contrast(readableOn(c, ROOST_GROUND), ROOST_GROUND)!, name).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('leaves a colour that already reads exactly as it is', () => {
    expect(readableOn('#f4b63f', ROOST_GROUND)).toBe('#f4b63f');
  });
  it('lightens only as far as needed, keeping the hue recognisable', () => {
    const out = readableOn(CREW.Ollie, ROOST_GROUND);
    expect(out).not.toBe('#ffffff');
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(out.slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(r); // still blue
    expect(b).toBeGreaterThan(g);
  });
  it('passes through anything it cannot parse', () => {
    expect(readableOn('var(--accent)', ROOST_GROUND)).toBe('var(--accent)');
  });
});
