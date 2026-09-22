import type { AgentKind } from './protocol.js';
import { classify, matchesId, type ModelCard } from './registry.js';

/** How independent the reviewer actually is from the author.
 *
 *  The mechanism in the evidence base is FRESH CONTEXT, not vendor diversity:
 *  same-model fresh-context review already beats self-review. Vendor diversity
 *  strengthens the signal; it is not what creates it. So a single-subscription
 *  user still gets real review -- just a weaker grade of it, and the UI must
 *  say which grade rather than implying they are equivalent. */
export type ReviewStrength = 'cross-vendor' | 'cross-model' | 'same-model' | 'none';

export const REVIEW_STRENGTH_LABEL: Record<ReviewStrength, string> = {
  'cross-vendor': 'Independent reviewer (different vendor)',
  'cross-model': 'Second opinion (different model, same vendor)',
  'same-model': 'Fresh-context self-review (shares the author’s blind spots)',
  none: 'No reviewer available',
};

export interface Capabilities {
  /** Vendors the user can actually reach. A vendor absent from the registry is
   *  one whose roster fetch failed -- i.e. not signed in. That is an
   *  unambiguous absence, not missing data. */
  vendors: AgentKind[];
  crossVendorReview: boolean;
  crossVendorRouting: boolean;
  reviewStrength: ReviewStrength;
}

export interface ReviewChoice {
  agent: AgentKind;
  model: string;
  strength: ReviewStrength;
  why: string;
}

const TIER_RANK = { heavy: 3, standard: 2, light: 1 } as const;

function rank(card: ModelCard): number {
  const t = classify(card).tier;
  return t ? TIER_RANK[t] : 0;
}

/** Usable models for an agent: present, not hidden, not superseded. */
function usable(models: ModelCard[], agent: AgentKind): ModelCard[] {
  return models
    .filter((m) => m.agent === agent && !m.hidden && !m.supersededBy && rank(m) > 0)
    .sort((a, b) => rank(b) - rank(a));
}

/** Live signal from the registry: did this vendor answer its last roster fetch? */
export type Presence = (agent: AgentKind) => 'present' | 'absent' | 'unknown';

export function vendorsPresent(models: ModelCard[], presence?: Presence): AgentKind[] {
  const out: AgentKind[] = [];
  for (const a of ['claude', 'codex'] as const) {
    // A cached roster plus a failed fetch means "was here, is not now".
    if (presence && presence(a) === 'absent') continue;
    if (usable(models, a).length) out.push(a);
  }
  return out;
}

/** Pick who reviews the planner's work, strongest independence first. */
export function reviewerFor(
  planner: { agent: AgentKind; model: string },
  models: ModelCard[],
  presence?: Presence,
): ReviewChoice {
  const other: AgentKind = planner.agent === 'claude' ? 'codex' : 'claude';

  // 1. Another vendor entirely -- independent training, independent blind spots.
  const otherSide = presence?.(other) === 'absent' ? [] : usable(models, other);
  if (otherSide.length) {
    return {
      agent: other, model: otherSide[0].id, strength: 'cross-vendor',
      why: `${otherSide[0].displayName} reviews independently of ${planner.agent}`,
    };
  }

  // 2. A different model from the same vendor. Both vendors ship 4-5 distinct
  //    models, so this is real diversity inside one subscription.
  const sameSide = usable(models, planner.agent);
  // matchesId strips the context suffix: 'opus[1m]' IS 'opus', not a second
  // opinion. Comparing raw ids offered the planner's own model as its reviewer.
  const different = sameSide.find((m) => !matchesId(m, planner.model));
  if (different) {
    return {
      agent: planner.agent, model: different.id, strength: 'cross-model',
      why: `${different.displayName} is a different model on the same subscription`,
    };
  }

  // 3. The same model with a clean context. Weakest -- shares every blind spot
  //    with the author -- but still beats self-review inside the author's context.
  if (sameSide.length) {
    return {
      agent: planner.agent, model: sameSide[0].id, strength: 'same-model',
      why: 'only one model available; review runs in a clean context',
    };
  }

  return { agent: planner.agent, model: planner.model, strength: 'none', why: 'no usable models' };
}

export function capabilitiesFrom(models: ModelCard[], presence?: Presence): Capabilities {
  const vendors = vendorsPresent(models, presence);
  const both = vendors.length > 1;
  const planner = vendors[0];
  return {
    vendors,
    crossVendorReview: both,
    crossVendorRouting: both,
    reviewStrength: planner
      ? reviewerFor({ agent: planner, model: '' }, models, presence).strength
      : 'none',
  };
}
