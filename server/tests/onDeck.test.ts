import { describe, expect, it } from 'vitest';
import { extractOnDeck } from '../src/onDeck.js';

describe("what's on deck, from the crew's own words", () => {
  it('reads a "Next up is" sentence', () => {
    expect(extractOnDeck('All done.\n\nNext up is item 43: crew faces in the top bar. Then 44.')).toBe('item 43: crew faces in the top bar');
  });
  it('reads a bold Next: line', () => {
    expect(extractOnDeck('**Next:** wire the plan setting into onboarding.')).toBe('wire the plan setting into onboarding');
  });
  it('ignores replies with no next step', () => {
    expect(extractOnDeck('Fixed the bug and deployed.')).toBeNull();
    expect(extractOnDeck('The next thing I noticed was odd.')).toBeNull();
  });
});
