import { describe, expect, it } from 'vitest';
import { effortNoteFor } from '../src/sessions.js';

describe('effortNoteFor', () => {
  it('says which way effort moved, then why', () => {
    expect(effortNoteFor('xhigh', 'high', 'quota tight, trimming thinking before downgrading the model'))
      .toBe('Stepped down from xhigh. Quota tight, trimming thinking before downgrading the model.');
    expect(effortNoteFor('low', 'max', 'window resets soon with headroom')).toBe('Stepped up from low. Window resets soon with headroom.');
  });
  it('with nothing to compare, only the reason', () => {
    expect(effortNoteFor(null, 'low', 'mechanical work needs little thinking')).toBe('Mechanical work needs little thinking.');
  });
});
