import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './config.js';

/** The crew as companions (item 40, 2026-09-25): "like the tamagotchi digital
 *  pets but these are the agents. I want people to talk about them."
 *
 *  A tamagotchi is a pet whose every feeling comes from how you treated it.
 *  These come from how the WORK went -- nothing here is invented. Mood,
 *  energy, stats and milestones are a pure function of three records:
 *
 *   - the call ledger (usage.jsonl): who worked, when, how much they wrote and
 *     how hard they thought -- durable, one row per model call;
 *   - the life log (crew-life.jsonl, below): the two things the ledger cannot
 *     say -- whose job a gate passed or failed on, and when you asked for
 *     someone by name;
 *   - the live state: who is working right now, and how much of their
 *     subscription is left (their energy).
 *
 *  Anything the records cannot support is null and shows as "no data". */

// ---- the life log ------------------------------------------------------------

export type LifeEvent =
  | { at: number; kind: 'verify'; names: string[]; passed: boolean; job?: string; sessionId?: string }
  | { at: number; kind: 'asked'; names: string[]; sessionId?: string };

const lifePath = () => join(dataDir(), 'crew-life.jsonl');

export function noteLife(e: LifeEvent): void {
  try {
    mkdirSync(dataDir(), { recursive: true });
    appendFileSync(lifePath(), JSON.stringify(e) + '\n');
  } catch {
    /* a companion's diary is never allowed to break a turn */
  }
}

export function readLife(): LifeEvent[] {
  try {
    if (!existsSync(lifePath())) return [];
    return readFileSync(lifePath(), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export function readLedgerRows(): LedgerRow[] {
  try {
    const p = join(dataDir(), 'usage.jsonl');
    if (!existsSync(p)) return [];
    return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

// ---- the companion -------------------------------------------------------------

export interface LedgerRow {
  at: number;
  persona?: string;
  agent?: string;
  model?: string;
  outTok?: number;
  reasoningTok?: number;
}

export type MoodKey = 'busy' | 'determined' | 'proud' | 'hungry' | 'missed' | 'new' | 'content' | 'resting';

export interface Milestone {
  id: string;
  label: string;
  /** What it takes, in words, so an unearned one is a goal and not a mystery. */
  how: string;
  earnedAt: number | null;
}

export interface Companion {
  name: string;
  /** Which subscription they run on, and their weight class. */
  suite: string | null;
  tier: 'flagship' | 'worker' | null;
  /** The model id on their most recent ledger row: what they actually ran as. */
  model: string | null;
  /** Every model id they have run as, most used first. */
  models: { id: string; calls: number }[];
  joined: number | null;
  lastWorked: number | null;
  /** Model calls: every turn, triage, review and dispatch they took. */
  calls: number;
  callsToday: number;
  /** Output tokens, all time: what they wrote (code, prose, plans). */
  wrote: number;
  /** Their single longest think, in reasoning tokens. null: never reported. */
  longestThink: number | null;
  /** Consecutive days, up to today or yesterday, with at least one call. */
  streak: number;
  bestStreak: number;
  jobsVerified: number;
  gatesFailed: number;
  askedByName: number;
  lastJob: { at: number; passed: boolean; job?: string } | null;
  /** 100 minus the tightest known window on their subscription. */
  energy: number | null;
  mood: { key: MoodKey; line: string };
  /** A sprite pose that shows the mood. */
  pose: 'type' | 'think' | 'cheer' | 'sleep' | 'peek' | 'blink' | 'idle';
  level: number;
  milestones: Milestone[];
}

export interface CompanionInput {
  names: string[];
  ledger: LedgerRow[];
  life: LifeEvent[];
  now: number;
  /** Who is mid-turn right now. */
  working: Set<string>;
  /** Tightest known used-percent on each member's subscription, or null. */
  usedPercent: (name: string) => { percent: number | null; vendor: string };
  /** Suite and tier from the roster, when known. */
  profile?: (name: string) => { suite: string | null; tier: 'flagship' | 'worker' | null };
}

const DAY = 86_400_000;
const dayOf = (t: number) => {
  const d = new Date(t);
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / DAY);
};

function streaks(days: Set<number>, today: number): { current: number; best: number } {
  const sorted = [...days].sort((a, b) => a - b);
  let best = 0, run = 0, prev = NaN;
  for (const d of sorted) {
    run = d === prev + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  // The current streak counts back from today, or from yesterday if today has
  // not had a call yet -- a streak is not broken by it still being morning.
  let start = days.has(today) ? today : days.has(today - 1) ? today - 1 : null;
  let current = 0;
  while (start != null && days.has(start)) {
    current++;
    start--;
  }
  return { current, best };
}

const ago = (ms: number) => {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`;
  return `${Math.round(h / 24)} days`;
};

/** Level from the work itself: a job whose gates passed is worth ten calls.
 *  Square root, so early levels come quickly and later ones mean something. */
export function levelFor(calls: number, jobsVerified: number): number {
  return 1 + Math.floor(Math.sqrt((calls + jobsVerified * 10) / 3));
}

export function companionFor(name: string, input: CompanionInput): Companion {
  const { now } = input;
  const rows = input.ledger.filter((r) => r.persona === name).sort((a, b) => a.at - b.at);
  const mine = input.life.filter((e) => e.names.includes(name)).sort((a, b) => a.at - b.at);
  const verifies = mine.filter((e): e is Extract<LifeEvent, { kind: 'verify' }> => e.kind === 'verify');
  const asked = mine.filter((e) => e.kind === 'asked').length;
  const passed = verifies.filter((v) => v.passed);
  const failed = verifies.filter((v) => !v.passed);
  const today = dayOf(now);
  const days = new Set(rows.map((r) => dayOf(r.at)));
  const { current, best } = streaks(days, today);
  const thinks = rows.map((r) => r.reasoningTok).filter((x): x is number => typeof x === 'number');
  const lastWorked = rows.length ? rows[rows.length - 1].at : null;
  const lastV = verifies[verifies.length - 1];
  const lastJob = lastV ? { at: lastV.at, passed: lastV.passed, job: lastV.job } : null;
  const { percent, vendor } = input.usedPercent(name);
  const energy = percent == null ? null : Math.max(0, Math.round(100 - percent));

  // Mood: the most pressing true thing, in their own voice.
  let mood: Companion['mood'];
  let pose: Companion['pose'];
  if (input.working.has(name)) {
    mood = { key: 'busy', line: 'On it.' };
    pose = 'type';
  } else if (lastJob && !lastJob.passed && now - lastJob.at < 3 * DAY) {
    mood = { key: 'determined', line: `The gates said no${lastJob.job ? ` to “${lastJob.job}”` : ''}. I'm not done with it.` };
    pose = 'think';
  } else if (lastJob?.passed && now - lastJob.at < DAY) {
    mood = { key: 'proud', line: `Shipped${lastJob.job ? ` “${lastJob.job}”` : ' a job'}. Every gate passed.` };
    pose = 'cheer';
  } else if (energy != null && energy <= 10) {
    mood = { key: 'hungry', line: `Running on fumes — ${vendor} is at ${Math.round(100 - energy)}%.` };
    pose = 'sleep';
  } else if (lastWorked == null) {
    mood = { key: 'new', line: "We haven't worked together yet." };
    pose = 'blink';
  } else if (now - lastWorked > 3 * DAY) {
    mood = { key: 'missed', line: `It's been ${ago(now - lastWorked)}.` };
    pose = 'peek';
  } else if (now - lastWorked < 3_600_000) {
    mood = { key: 'content', line: 'Just finished up.' };
    pose = 'idle';
  } else {
    mood = { key: 'resting', line: `Resting. Last worked ${ago(now - lastWorked)} ago.` };
    pose = 'sleep';
  }

  const nightOwl = rows.find((r) => new Date(r.at).getHours() < 5);
  const marathon = rows.find((r) => (r.outTok ?? 0) >= 50_000);
  const deep = rows.find((r) => (r.reasoningTok ?? 0) >= 20_000);
  const hundredth = rows[99];
  let comeback: number | null = null;
  for (const p of passed) {
    if (failed.some((f) => f.at < p.at && (!f.sessionId || f.sessionId === p.sessionId))) { comeback = p.at; break; }
  }
  const streak7 = (() => {
    const sorted = [...days].sort((a, b) => a - b);
    let run = 0, prev = NaN;
    for (const d of sorted) {
      run = d === prev + 1 ? run + 1 : 1;
      prev = d;
      if (run >= 7) return d * DAY;
    }
    return null;
  })();
  const milestones: Milestone[] = [
    { id: 'first-job', label: 'First ship', how: 'a job whose gates all passed', earnedAt: passed[0]?.at ?? null },
    { id: 'ten-jobs', label: 'Ten ships', how: 'ten jobs through the gates', earnedAt: passed[9]?.at ?? null },
    { id: 'comeback', label: 'Comeback', how: 'a job that failed its gates, then passed', earnedAt: comeback },
    { id: 'hundred', label: 'Hundred turns', how: 'a hundred calls', earnedAt: hundredth?.at ?? null },
    { id: 'marathon', label: 'Marathon', how: '50k tokens written in one go', earnedAt: marathon?.at ?? null },
    { id: 'deep', label: 'Deep thinker', how: '20k tokens of thought in one go', earnedAt: deep?.at ?? null },
    { id: 'night-owl', label: 'Night owl', how: 'working between midnight and five', earnedAt: nightOwl?.at ?? null },
    { id: 'streak-7', label: 'Week straight', how: 'seven days in a row', earnedAt: streak7 },
    { id: 'favourite', label: 'Asked for', how: 'asked for by name ten times', earnedAt: mine.filter((e) => e.kind === 'asked')[9]?.at ?? null },
  ];

  const byModel = new Map<string, number>();
  for (const r of rows) if (r.model) byModel.set(r.model, (byModel.get(r.model) ?? 0) + 1);
  const models = [...byModel.entries()].sort((a, b) => b[1] - a[1]).map(([id, calls]) => ({ id, calls }));
  const lastModel = [...rows].reverse().find((r) => r.model)?.model ?? null;
  const prof = input.profile?.(name) ?? { suite: null, tier: null };

  return {
    name,
    suite: prof.suite,
    tier: prof.tier,
    model: lastModel,
    models,
    joined: rows[0]?.at ?? null,
    lastWorked,
    calls: rows.length,
    callsToday: rows.filter((r) => dayOf(r.at) === today).length,
    wrote: rows.reduce((n, r) => n + (r.outTok ?? 0), 0),
    longestThink: thinks.length ? Math.max(...thinks) : null,
    streak: current,
    bestStreak: best,
    jobsVerified: passed.length,
    gatesFailed: failed.length,
    askedByName: asked,
    lastJob,
    energy,
    mood,
    pose,
    level: levelFor(rows.length, passed.length),
    milestones,
  };
}

export function companionsFrom(input: CompanionInput): Companion[] {
  return input.names.map((n) => companionFor(n, input));
}

/** "While you were away": what the crew did between two moments, from the
 *  same records -- the greeting on the home screen. */
export function sinceSummary(input: { ledger: LedgerRow[]; life: LifeEvent[]; since: number; now: number }): {
  busiest: string | null;
  calls: number;
  shipped: number;
  failed: number;
} {
  const rows = input.ledger.filter((r) => r.at > input.since && r.at <= input.now && r.persona);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.persona!, (counts.get(r.persona!) ?? 0) + 1);
  const busiest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const v = input.life.filter((e): e is Extract<LifeEvent, { kind: 'verify' }> => e.kind === 'verify' && e.at > input.since && e.at <= input.now);
  return { busiest, calls: rows.length, shipped: v.filter((x) => x.passed).length, failed: v.filter((x) => !x.passed).length };
}
