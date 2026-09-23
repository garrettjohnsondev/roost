import { describe, expect, it } from 'vitest';
import { normalizeMe, ME_DEFAULT } from '../src/me.js';

describe('your own identity', () => {
  it('defaults to something renderable rather than empty', () => {
    expect(ME_DEFAULT.name).toBeTruthy();
    expect(ME_DEFAULT.color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('keeps a real name and colour, trimmed', () => {
    expect(normalizeMe({ name: '  Garrett  ', color: '#3366FF' })).toEqual({ name: 'Garrett', color: '#3366FF' });
  });

  it('refuses a colour that is not a plain hex value', () => {
    // This string is interpolated into a style attribute, so anything that is
    // not exactly six hex digits falls back rather than being passed through.
    for (const bad of ['red', '#fff', '#fff;background:url(x)', 'var(--accent)', '', null, 42, '#12345g']) {
      expect(normalizeMe({ name: 'x', color: bad }).color, String(bad)).toBe(ME_DEFAULT.color);
    }
  });

  it('falls back on a blank or missing name instead of rendering nothing', () => {
    for (const bad of ['', '   ', undefined, null, 7, {}]) {
      expect(normalizeMe({ name: bad, color: '#111111' }).name).toBe(ME_DEFAULT.name);
    }
  });

  it('caps a very long name rather than letting it break the layout', () => {
    expect(normalizeMe({ name: 'z'.repeat(500), color: '#111111' }).name).toHaveLength(40);
  });

  it('omits avatar entirely when unset, so the monogram path is taken', () => {
    expect('avatar' in normalizeMe({ name: 'x', color: '#111111' })).toBe(false);
    expect('avatar' in normalizeMe({ name: 'x', color: '#111111', avatar: '   ' })).toBe(false);
  });
})
