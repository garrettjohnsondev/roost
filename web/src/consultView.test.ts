import { describe, expect, it } from 'vitest';
import { consultView } from './consultView';

const plan = `### Approach
The site is static. I'll add a client-side pre-order form.

It saves to localStorage.

### Files
- index.html
- style.css

### Steps
1. Add steppers.
2. Add the form.`;

describe('the planning conversation reads as one', () => {
  it('a plan says its approach, with the full plan behind a tap', () => {
    const v = consultView('plan', plan);
    expect(v.say).toBe("The site is static. I'll add a client-side pre-order form.");
    expect(v.more).toBe(plan);
  });
  it('a reconcile says only its reply to the reviewer, not the whole plan again', () => {
    const text = `${plan}\n\n## Reconciliation\nGood catch, Nell — taking that.\n- ACCEPTED: the empty-cart check, it was missing.`;
    const v = consultView('reconcile', text);
    expect(v.say).toBe('Good catch, Nell — taking that.\n- ACCEPTED: the empty-cart check, it was missing.');
    expect(v.more).toBe(plan);
    expect(v.moreLabel).toBe('Show the updated plan');
  });
  it('a review drops the machine verdict line (the badge says it)', () => {
    expect(consultView('critique', 'Wren, one real gap: orders never reach the stand.\n\nVERDICT: NEEDS CHANGES').say).toBe('Wren, one real gap: orders never reach the stand.');
    expect(consultView('critique', 'VERDICT: SOLID').say).toBe('Looks solid.');
  });
  it('a plan without headings still shows its first paragraph', () => {
    const v = consultView('plan', 'Just do X.\n\nThen Y, then Z, and some more words so there is plenty more to show behind the tap.');
    expect(v.say).toBe('Just do X.');
    expect(v.more).not.toBeNull();
  });
});
