import { describe, expect, it } from 'vitest';
import { chooseRoute, type VendorState } from '../src/route.js';
import type { Headroom } from '../src/quota.js';

const route = {
  light: { model: 'l' }, standard: { model: 's' }, heavy: { model: 'h', effort: 'xhigh' },
};
const H = (state: Headroom['state'], reason = state): Headroom => ({ state, worstPercent: null, ageMins: 0, reason });
const V = (state: Headroom['state'], over: Partial<VendorState> = {}): VendorState =>
  ({ route, headroom: H(state), presence: 'present', surplus: null, ...over });
const surplus = { agent: 'claude', window: { label: '5-hour session' } as any, headroomPct: 60, minutesLeft: 40, reason: '60% left, resets in 40m' } as any;

describe('chooseRoute — scarcity', () => {
  it('leaves a tier alone when there is room', () => {
    const d = chooseRoute({ tier: 'heavy', vendors: { claude: V('room') }, lockAgent: 'claude' });
    expect(d).toMatchObject({ agent: 'claude', model: 'h', effort: 'xhigh', tier: 'heavy', steppedDown: false, gated: false, refused: false });
  });

  it('steps one tier down when tight, and to light when gated', () => {
    expect(chooseRoute({ tier: 'heavy', vendors: { claude: V('tight') }, lockAgent: 'claude' })).toMatchObject({ tier: 'standard', steppedDown: true });
    expect(chooseRoute({ tier: 'heavy', vendors: { claude: V('gated') }, lockAgent: 'claude' })).toMatchObject({ tier: 'light', gated: true, steppedDown: true });
  });

  it('refuses when the only vendor is exhausted', () => {
    const d = chooseRoute({ tier: 'standard', vendors: { claude: V('exhausted', { headroom: H('exhausted', '7-day at 99%') }) }, lockAgent: 'claude' });
    expect(d.refused).toBe(true);
    expect(d.reason).toContain('99%');
  });

  it('suggests, never switches, a locked session under pressure when the other vendor has room', () => {
    const d = chooseRoute({ tier: 'standard', vendors: { claude: V('tight'), codex: V('room') }, lockAgent: 'claude' });
    expect(d.agent).toBe('claude');
    expect(d.suggestOther).toBe('codex');
  });
});

describe('chooseRoute — dispatch across vendors', () => {
  it('moves work to the vendor with better KNOWN headroom', () => {
    expect(chooseRoute({ tier: 'standard', vendors: { claude: V('tight'), codex: V('room') } }).agent).toBe('codex');
    expect(chooseRoute({ tier: 'standard', vendors: { claude: V('room'), codex: V('tight') } }).agent).toBe('claude');
  });

  it('never moves work on missing data', () => {
    // codex unknown must not beat claude tight; claude unknown must not beat codex room.
    expect(chooseRoute({ tier: 'standard', vendors: { claude: V('tight'), codex: V('unknown') } }).agent).toBe('claude');
    expect(chooseRoute({ tier: 'standard', vendors: { claude: V('unknown'), codex: V('room') } }).agent).toBe('codex');
    const blind = chooseRoute({ tier: 'heavy', vendors: { claude: V('stale'), codex: V('unknown') } });
    expect(blind.tier).toBe('heavy');
    expect(blind.reason).toMatch(/missing data/);
  });

  it('skips an absent vendor even if its cached roster looks fine', () => {
    expect(chooseRoute({ tier: 'standard', vendors: { claude: V('tight'), codex: V('room', { presence: 'absent' }) } }).agent).toBe('claude');
  });

  it('honours cross-vendor candidates by headroom', () => {
    const withCands = { ...route, standard: { model: 's', candidates: [{ agent: 'claude' as const, model: 'sonnet' }, { agent: 'codex' as const, model: 'gpt-5.6-terra' }] } };
    const d = chooseRoute({ tier: 'standard', vendors: { claude: { ...V('tight'), route: withCands }, codex: { ...V('room'), route: withCands } } });
    expect(d).toMatchObject({ agent: 'codex', model: 'gpt-5.6-terra' });
  });
});

describe('chooseRoute — surplus and boost', () => {
  it('steps up to heavy only when boost is on and the window has room', () => {
    const v = V('room', { surplus });
    expect(chooseRoute({ tier: 'standard', vendors: { claude: v }, lockAgent: 'claude' }).steppedUp).toBe(false);
    expect(chooseRoute({ tier: 'standard', vendors: { claude: v }, lockAgent: 'claude', boost: true })).toMatchObject({ tier: 'heavy', steppedUp: true });
  });

  it('holds boost when the window is under pressure', () => {
    const d = chooseRoute({ tier: 'standard', vendors: { claude: V('tight', { surplus }) }, lockAgent: 'claude', boost: true });
    expect(d.steppedUp).toBe(false);
    expect(d.reason).toMatch(/boost held/);
  });
});
