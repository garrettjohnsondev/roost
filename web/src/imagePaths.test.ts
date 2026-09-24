import { describe, expect, it } from 'vitest';
import { findImagePaths, imageUrl, isImagePath } from './imagePaths';

describe('image paths in what agents say', () => {
  it('finds a path in backticks, in prose, and at the end of a sentence', () => {
    expect(findImagePaths('the sheet is at `/tmp/roost-shots/logo-v2.png` now')).toEqual(['/tmp/roost-shots/logo-v2.png']);
    expect(findImagePaths('Saved /Volumes/PortableSSD/remote/web/public/crew/pip-sit.webp.')).toEqual(['/Volumes/PortableSSD/remote/web/public/crew/pip-sit.webp']);
    expect(findImagePaths('(see /tmp/a.jpg)')).toEqual(['/tmp/a.jpg']);
  });
  it('ignores relative paths, URLs, and non-images', () => {
    expect(findImagePaths('web/public/logo.png and https://x.dev/a.png and /tmp/notes.txt')).toEqual([]);
  });
  it('lists each path once, and caps the list', () => {
    expect(findImagePaths('/tmp/a.png /tmp/a.png /tmp/b.png')).toEqual(['/tmp/a.png', '/tmp/b.png']);
    const many = Array.from({ length: 10 }, (_, i) => `/tmp/${i}.png`).join(' ');
    expect(findImagePaths(many)).toHaveLength(6);
  });
  it('recognises a bare path, and builds the viewer URL', () => {
    expect(isImagePath(' /tmp/a.png ')).toBe(true);
    expect(isImagePath('see /tmp/a.png')).toBe(false);
    expect(imageUrl('/tmp/a b.png')).toBe('/api/image?path=%2Ftmp%2Fa%20b.png');
  });
});
