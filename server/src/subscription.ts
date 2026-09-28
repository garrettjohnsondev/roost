import type { AutoRouteConfig } from './config.js';

/** Which subscription the person pays for (roadmap #44, agreed 2026-09-28):
 *  it decides how Pip hands out work. Every plan gets the whole crew; a
 *  smaller plan leans on the lighter models more. The router still steps
 *  down on its own when a window gets tight, so a $20 plan never runs dry
 *  mid-job just because of this ladder. */
export type Plan = '20' | '100' | '200';
export const PLANS: Plan[] = ['20', '100', '200'];

export function isPlan(p: unknown): p is Plan {
  return p === '20' || p === '100' || p === '200';
}

type Rung = { model: string; effort?: string };
const LADDER: Record<Plan, Record<'claude' | 'codex', [Rung, Rung, Rung]>> = {
  // Chores on the small model, everyday on the middle one, Opus only for the
  // hard problems and at a lower effort so it doesn't eat the week.
  '20': {
    claude: [{ model: 'haiku' }, { model: 'sonnet' }, { model: 'opus', effort: 'high' }],
    codex: [{ model: 'gpt-5.6-luna' }, { model: 'gpt-5.6-terra' }, { model: 'gpt-6-astra', effort: 'high' }],
  },
  // The owner's plan: Haiku never; Sonnet for questions and chores, Opus for
  // real work ("Pip hands Sonnet work I wanted Opus for").
  '100': {
    claude: [{ model: 'sonnet' }, { model: 'opus' }, { model: 'opus', effort: 'xhigh' }],
    codex: [{ model: 'gpt-5.6-terra' }, { model: 'gpt-6-astra' }, { model: 'gpt-6-astra', effort: 'xhigh' }],
  },
  '200': {
    claude: [{ model: 'sonnet' }, { model: 'opus', effort: 'high' }, { model: 'opus', effort: 'max' }],
    codex: [{ model: 'gpt-5.6-terra' }, { model: 'gpt-6-astra', effort: 'high' }, { model: 'gpt-6-astra', effort: 'max' }],
  },
};

/** The routes for a plan. Light and standard may cross vendors (the router
 *  picks whichever subscription has more known headroom); heavy stays put. */
export function planRoutes(plan: Plan): { claude: AutoRouteConfig; codex: AutoRouteConfig } {
  const L = LADDER[plan];
  const tier = (a: 'claude' | 'codex', i: 0 | 1 | 2) => {
    const other = a === 'claude' ? 'codex' : 'claude';
    const t: any = { model: L[a][i].model };
    if (L[a][i].effort) t.effort = L[a][i].effort;
    if (i < 2) t.candidates = [{ agent: a, model: L[a][i].model }, { agent: other, model: L[other][i].model }];
    return t;
  };
  const build = (a: 'claude' | 'codex'): AutoRouteConfig => ({ light: tier(a, 0), standard: tier(a, 1), heavy: tier(a, 2) });
  return { claude: build('claude'), codex: build('codex') };
}

/** Plain words for the settings sheet: who gets what on this plan. */
export function planWords(plan: Plan): string {
  const c = LADDER[plan].claude;
  const name = (r: Rung) => r.model[0].toUpperCase() + r.model.slice(1) + (r.effort ? ` (${r.effort === 'max' ? 'deepest' : r.effort === 'xhigh' ? 'full' : 'lighter'} thinking)` : '');
  return `Questions and chores: ${name(c[0])}. Everyday work: ${name(c[1])}. Hard problems: ${name(c[2])}.`;
}

export interface PlanAdvice {
  /** The setting Pip would pick right now. */
  suggest: Plan;
  /** Why, in one plain sentence. */
  why: string;
  /** Usage pace: share of the week used ÷ share of the week gone. 1 = on pace. */
  pace: number | null;
}

/** The smart advisor (the owner's idea, 2026-09-28): not just a setting, a
 *  recommendation from how the week is actually going. Pace compares the
 *  share of the weekly window used with the share of it that has passed. */
export function advise(plan: Plan, weekly: { usedPercent: number | null; resetsAt: number | null; windowDurationMins: number | null } | null, now = Date.now()): PlanAdvice {
  if (!weekly || weekly.usedPercent == null || !weekly.resetsAt || !weekly.windowDurationMins) {
    return { suggest: plan, why: 'No usage reading yet, so stay on your plan’s setting.', pace: null };
  }
  const span = weekly.windowDurationMins * 60_000;
  const gone = Math.min(1, Math.max(0.02, 1 - (weekly.resetsAt - now) / span));
  const used = weekly.usedPercent / 100;
  const pace = used / gone;
  const daysLeft = Math.max(0, (weekly.resetsAt - now) / 86_400_000);
  const i = PLANS.indexOf(plan);
  const days = daysLeft < 1 ? 'under a day' : `${Math.round(daysLeft)} day${Math.round(daysLeft) === 1 ? '' : 's'}`;
  if (used >= 0.9 || (pace > 1.25 && used > 0.3)) {
    const down = PLANS[Math.max(0, i - 1)];
    return { suggest: down, pace, why: `You've used ${weekly.usedPercent}% of your week with ${days} left — ${down === plan ? 'stay lean' : 'save tokens'} so the crew doesn't run dry.` };
  }
  if (pace < 0.6 && gone > 0.3 && i < PLANS.length - 1) {
    const up = PLANS[i + 1];
    return { suggest: up, pace, why: `Only ${weekly.usedPercent}% of your week used with ${days} left — you can afford more Opus.` };
  }
  return { suggest: plan, pace, why: `${weekly.usedPercent}% of your week used with ${days} left — right on pace.` };
}
