import { describe, expect, it } from 'vitest';
import { nudgeDue } from './NotifyNudge';
describe('nudgeDue', () => {
  it('asks after the first finished job', () => { expect(nudgeDue(0, 0)).toBe(false); expect(nudgeDue(1, 0)).toBe(true); });
  it('asks once more five jobs after "Not now"', () => { expect(nudgeDue(5, 1)).toBe(false); expect(nudgeDue(6, 1)).toBe(true); });
  it('then never again', () => { expect(nudgeDue(99, 2)).toBe(false); });
});
