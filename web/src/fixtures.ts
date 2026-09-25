import type { SessionState } from './useSession';
import type { ChatItem, CrewInfo, SessionMeta } from './types';

/** Canned threads for design review, reached with `?fixture=<name>`.
 *
 *  Some of the board's states are expensive or impossible to reach on demand — a
 *  verify that passes, a job that has already folded, an approval waiting — and
 *  checking them by spinning up real sessions spends real quota and touches real
 *  repos. These render through the real ChatView, with no socket and no server
 *  calls, so what they show is what the app draws. */
const crew = (name: string, sprite: string | undefined, agent: 'claude' | 'codex', model: string, color: string, role = 'Chat'): CrewInfo =>
  ({ name, sprite, agent, model, color, avatar: undefined, initial: name[0], role: role.toLowerCase(), roleLabel: role, tier: 'flagship' });
const OLLIE = crew('Ollie', 'ollie', 'claude', 'claude-opus-5-5', '#2f3a72', 'Builder');
const JUNO = crew('Juno', 'juno', 'codex', 'gpt-5.6-sol', '#e65608', 'Reviewer');
const MOSS = crew('Moss', 'moss', 'claude', 'claude-haiku-4-5', '#205a1d', 'Builder');
const PIP = crew('Pip', 'pip', 'claude', 'claude-haiku-4-5', '#c9803a', 'Dispatch');

const at = (n: number) => 1_790_150_000_000 + n * 1000;
const passing = { passed: true, summary: 'all gates passed', gates: [{ command: 'npm test', exitCode: 0, ms: 4200, stdoutTail: '372 passed', stderrTail: '' }], images: [], tampered: false } as any;
const failing = { passed: false, unverified: false, summary: '1/2 gates passed', gates: [{ command: 'npm test', exitCode: 0, ms: 4200, stdoutTail: '372 passed', stderrTail: '' }, { command: 'npm run typecheck', exitCode: 2, ms: 900, stdoutTail: '', stderrTail: 'error TS2345' }], images: [], tampered: false } as any;

const TWO_JOBS: ChatItem[] = [
  { kind: 'routed', model: 'haiku', tier: 'light', reason: 'rename across two files', crew: PIP, ts: at(0) },
  { kind: 'user', text: 'Rename fmtAgo to formatAgo everywhere', imageCount: 0, ts: at(1) },
  { kind: 'tool', toolId: 'a', name: 'Grep', detail: '“fmtAgo” in web/src', done: true, ok: true, ts: at(2) },
  { kind: 'assistant', text: 'Renamed in 2 files. Nothing else referenced it.', complete: true, crew: MOSS, ts: at(3) },
  { kind: 'verify', report: passing, ts: at(4) },
  { kind: 'routed', model: 'opus', tier: 'heavy', reason: 'new flag, tests and docs', crew: PIP, ts: at(5) },
  { kind: 'user', text: 'Add a --json flag to the avatar generator', imageCount: 0, ts: at(6) },
  { kind: 'consult', phase: 'plan', agent: 'claude', crew: { ...OLLIE, roleLabel: 'Planner' }, text: 'Plan is up. Five acceptance criteria, each a command that either passes or does not.', ts: at(7) },
  { kind: 'consult', phase: 'critique', agent: 'codex', crew: JUNO, reviewStrength: 'cross-vendor', text: 'VERDICT: NEEDS CHANGES — the flag still prints the banner before the JSON, so the output will not parse.', ts: at(8) },
  { kind: 'assistant', text: 'Good catch. Moving the banner behind the flag check, then running the gates.', complete: true, crew: OLLIE, ts: at(9) },
  { kind: 'tool', toolId: 'b', name: 'Bash', detail: 'npm test -w server', done: false, ts: at(10) },
];

const meta = (over: Partial<SessionMeta> = {}): SessionMeta => ({
  id: 'fixture', agent: 'claude', cwd: '/Volumes/PortableSSD/remote', title: 'Avatar generator', model: 'auto', effort: 'high',
  approvals: 'ask', createdAt: at(0), updatedAt: at(10), state: 'working', mode: 'auto', crew: OLLIE,
  recentCrew: [OLLIE, JUNO, MOSS], ...over,
} as SessionMeta);

const base = (items: ChatItem[], m: SessionMeta, replayedCount: number, over: Partial<SessionState> = {}): SessionState => ({
  items, meta: m, status: 'working', connected: true, usage: null, pendingApproval: null, pendingApprovalCount: 0,
  closedReason: null, statusMessage: null, triaging: false, context: null, replayedCount, openedAt: Date.now(), send: () => false, ...over,
} as SessionState);

/** A Haiku-routed turn: Pip names Moss, and Moss is mid-reply. */
const MOSS_ROUTED: ChatItem[] = [
  { kind: 'user', text: 'Rename fmtAgo to formatAgo everywhere', imageCount: 0, ts: at(0) },
  { kind: 'routed', model: 'claude-haiku-4-5', tier: 'light', reason: 'rename across two files', crew: PIP, worker: { ...MOSS, role: 'chat', roleLabel: 'Chat' }, ts: at(1) },
  { kind: 'assistant', text: 'Renaming in', complete: false, crew: MOSS, ts: at(2) },
];

const SIGNED_OUT: ChatItem[] = [
  { kind: 'user', text: 'What changed in the auth module?', imageCount: 0, ts: at(0) },
  { kind: 'error', code: 'auth', text: 'Claude turn failed: OAuth token has expired. Please run /login', ts: at(1) },
];

/** The gate refusing (§12a): quota, not a crash — a lock, not a red box. */
const QUOTA_REFUSED: ChatItem[] = [
  { kind: 'user', text: '@Nell review the auth changes', imageCount: 0, ts: at(0) },
  { kind: 'error', code: 'gate', text: 'Nell: claude five_hour at 99% — refused by provider', ts: at(1) },
];

/** Control board: effort on every turn, and the note the first time it moved. */
const EFFORT_TURNS: ChatItem[] = [
  { kind: 'user', text: 'Rename fmtAgo, then rework the avatar generator', imageCount: 0, ts: at(0) },
  { kind: 'assistant', text: 'Renamed in 2 files.', complete: true, crew: { ...MOSS, model: 'haiku 4.5', effort: 'low', effortNote: 'Mechanical work is capped low whatever the tier — a rename never needs a thinking budget.' }, ts: at(1) },
  { kind: 'assistant', text: 'Starting on the generator.', complete: true, crew: { ...OLLIE, model: 'opus 5.5', effort: 'high', effortNote: 'Stepped down from xhigh. Claude weekly is tight, and thinking is trimmed before the model is downgraded.' }, ts: at(2) },
  { kind: 'consult', phase: 'critique', agent: 'codex', crew: { ...JUNO, effort: 'max' }, text: 'VERDICT: SOLID. One gap: the flag is not documented.', ts: at(3) },
];

/** A handoff (§12a): Ollie steps back, Juno steps in -- the last item is
 *  live so the pass plays; `?fixture=handoff-replayed` shows it static. */
const HANDOFF: ChatItem[] = [
  { kind: 'user', text: 'Keep going on the avatar generator', imageCount: 0, ts: at(0) },
  { kind: 'assistant', text: 'The generator is drafted; the context window is filling.', complete: true, crew: OLLIE, ts: at(1) },
  { kind: 'consult', phase: 'handoff', agent: 'codex', crew: { ...JUNO, roleLabel: 'Builder' }, from: OLLIE, text: 'Picking up from Ollie. Checked git first: the generator is in place, tests green. Continuing with the flag.', ts: at(2) },
];

/** A job with TWO crew members speaking before it passes, live -- so both
 *  cheer and the confetti fires. Design-review target for items 01/08. */
const EARNED: ChatItem[] = [
  { kind: 'user', text: 'Add a --json flag to the avatar generator', imageCount: 0, ts: at(0) },
  { kind: 'consult', phase: 'plan', agent: 'claude', crew: { ...OLLIE, roleLabel: 'Planner' }, text: 'Plan is up.', ts: at(1) },
  { kind: 'assistant', text: 'Flag added, banner moved behind the check.', complete: true, crew: OLLIE, ts: at(2) },
  { kind: 'consult', phase: 'critique', agent: 'codex', crew: JUNO, reviewStrength: 'cross-vendor', text: 'VERDICT: OK.', ts: at(3) },
  { kind: 'verify', report: passing, ts: at(4) },
];

/** A fresh FAILING verify, for the red stamp (item 01). */
const GATE_FAILED: ChatItem[] = [
  { kind: 'user', text: 'Add a --json flag to the avatar generator', imageCount: 0, ts: at(0) },
  { kind: 'assistant', text: 'Done. Running the gates.', complete: true, crew: OLLIE, ts: at(1) },
  { kind: 'verify', report: failing, ts: at(2) },
];

/** Three short jobs on three different days, for the day-row headers
 *  (§12d's last gap). Real spread timestamps, not the fixture's usual at(n). */
const NOW = Date.now();
const DAY = 86_400_000;
const daySpread = (offsetDays: number, n: number) => NOW - offsetDays * DAY + n * 1000;
const THREE_DAYS: ChatItem[] = [
  { kind: 'user', text: 'Rename fmtAgo to formatAgo everywhere', imageCount: 0, ts: daySpread(9, 0) },
  { kind: 'assistant', text: 'Done.', complete: true, crew: MOSS, ts: daySpread(9, 1) },
  { kind: 'verify', report: passing, ts: daySpread(9, 2) },
  { kind: 'user', text: 'Add a --json flag to the avatar generator', imageCount: 0, ts: daySpread(1, 0) },
  { kind: 'assistant', text: 'Flag added.', complete: true, crew: OLLIE, ts: daySpread(1, 1) },
  { kind: 'verify', report: passing, ts: daySpread(1, 2) },
  { kind: 'user', text: 'Move the scales icon out of the composer', imageCount: 0, ts: daySpread(0, 0) },
  { kind: 'assistant', text: 'Moved.', complete: true, crew: OLLIE, ts: daySpread(0, 1) },
  { kind: 'verify', report: passing, ts: daySpread(0, 2) },
];

const TOO_LONG: ChatItem[] = [
  { kind: 'user', text: 'Keep going with the review', imageCount: 0, ts: at(0) },
  { kind: 'error', code: 'context', text: 'Claude turn failed: Prompt is too long', ts: at(1) },
];

const tool = (name: string, detail: string, n: number, done = true): ChatItem => ({ kind: 'tool', toolId: `w${n}`, name, detail, done, ok: true, ts: at(n) });
const WORK_STREAM: ChatItem[] = [
  { kind: 'user', text: 'Ollie proceed to build', imageCount: 0, ts: at(0) },
  { kind: 'assistant', text: "I've looked at how the chat, the changes sheet and the image viewer are wired. Next I'm writing the server side: detection, saved recipes and the runner.", complete: true, crew: OLLIE, ts: at(1) },
  tool('Bash', 'grep -n "guardProject" server/src/index.ts', 2), tool('Write', 'server/src/deploy.ts', 3),
  { kind: 'assistant', text: 'Now the endpoints.', complete: true, crew: OLLIE, ts: at(4) },
  tool('Bash', 'python3 - <<EOF …', 5),
  { kind: 'assistant', text: "Server side typechecks. Now the web side: the sheet, the header button, and the crew's proposal card.", complete: true, crew: OLLIE, ts: at(6) },
  tool('Edit', 'web/src/ChatView.tsx', 7), tool('Bash', 'npm run typecheck', 8, false),
  { kind: 'assistant', text: 'Typecheck is clean. Adding tests for detection, the saved recipe, and the rule that a failed check never deploys.', complete: true, crew: OLLIE, ts: at(9) },
  tool('Bash', 'npx vitest run tests/deploy.test.ts', 10),
  { kind: 'assistant', text: 'The Deploy button is built and saved as `05cdcfd`, but it isn\'t live yet. That needs one more deploy.', complete: true, crew: OLLIE, ts: at(11) },
];

export const FIXTURES: Record<string, () => SessionState> = {
  /** A conversation that outgrew Claude's window, as 725ffb4e did. */
  'too-long': () => base(TOO_LONG, meta({ state: 'idle' }), TOO_LONG.length),
  /** A session with no messages yet — a new one, or any one after a restart.
   *  The case that crashed every chat view on 2026-09-24. */
  empty: () => base([], meta({ state: 'idle' }), 0),
  /** A turn that failed because Claude's sign-in lapsed. */
  'signed-out': () => base(SIGNED_OUT, meta({ state: 'idle' }), SIGNED_OUT.length),
  'quota-refused': () => base(QUOTA_REFUSED, meta({ state: 'idle' }), QUOTA_REFUSED.length),
  /** Item 35: the phone screenshot's top half -- Spend-it, full auto, the
   *  token line, context and the tracker, all at once. */
  'busy-top': () => base(
    TWO_JOBS.slice(5, 8),
    meta({
      state: 'working', approvals: 'full-auto',
      surplus: { label: '7-day (all models)', headroomPct: 38, minutesLeft: 8, resetsAt: Date.now() + 8 * 60_000, weekly: [{ label: '7-day (Fable)', usedPercent: 79 }, { label: '7-day (all models)', usedPercent: 62 }] } as any,
    }),
    3,
    { status: 'working', usage: { inputTokens: 340_100_000, outputTokens: 822_400 } as any, context: { agent: 'claude', usedTokens: 228_400, maxTokens: 1_000_000, percent: 23, pressure: 'clear' } as any },
  ),
  /** The work stream: narration and calls in one card, live and folded. */
  'work-live': () => base(WORK_STREAM.slice(0, 9), meta({ state: 'working' }), 0, { status: 'working' }),
  'work-done': () => base(WORK_STREAM.map((x) => (x.kind === 'tool' ? { ...x, done: true } : x)), meta({ state: 'idle' }), WORK_STREAM.length, { status: 'idle' }),
  /** The tracker (2026-09-25): a job that just passed its checks -- the stamp lands. */
  'tracker-verified': () => base([...WORK_STREAM.map((x) => (x.kind === 'tool' ? { ...x, done: true } : x)), { kind: 'verify', report: { passed: true, tampered: false, gates: [{ command: 'npm test', exitCode: 0, output: '667 passed', ms: 4100 } as any], images: [], fingerprint: '', summary: '1/1 gates passed', startedAt: 0, ms: 4100 }, ts: at(12) }], meta({ state: 'idle' }), 0, { status: 'idle' }),
  'tracker-failed': () => base([...WORK_STREAM.map((x) => (x.kind === 'tool' ? { ...x, done: true } : x)), { kind: 'verify', report: { passed: false, tampered: false, gates: [{ command: 'npm test', exitCode: 1, output: '2 failed', ms: 4100 } as any], images: [], fingerprint: '', summary: '0/1 gates passed', startedAt: 0, ms: 4100 }, ts: at(12) }], meta({ state: 'idle' }), 0, { status: 'idle' }),
  'tracker-back': () => base([...WORK_STREAM.slice(0, 11).map((x) => (x.kind === 'tool' ? { ...x, done: true, ok: !/vitest/.test(x.detail) } : x)), { kind: 'tool', toolId: 'w99', name: 'Edit', detail: 'web/src/tracker.ts', done: false, ts: at(13) }], meta({ state: 'working' }), 0, { status: 'working' }),
  /** Deploy: a crew member worked out what deploy means in a new project. */
  'deploy-proposal': () => base(
    [
      { kind: 'user', text: 'Work out how this project deploys', imageCount: 0, ts: at(0) },
      { kind: 'assistant', text: 'This folder is linked to a Vercel project (`.vercel/project.json`), and `package.json` has a build script, so deploy is a production push to Vercel with the build as the check.\n\n```roost-deploy\ncommand: npx vercel --prod --yes\ncheck: npm run build\n```', complete: true, crew: OLLIE, ts: at(1) },
    ],
    meta({ state: 'idle' }), 2, { status: 'idle' },
  ),
  /** Item 40: moments -- a milestone and a level, the second live. */
  moments: () => base(
    [
      { kind: 'user', text: 'Rework the whole avatar pipeline', imageCount: 0, ts: at(0) },
      { kind: 'assistant', text: 'Done — the pipeline is rebuilt and the gates pass.', complete: true, crew: OLLIE, ts: at(1) },
      { kind: 'milestone', crew: OLLIE, label: 'Marathon', detail: 'Ollie earned Marathon — 50k tokens written in one go.', ts: at(2) },
      { kind: 'milestone', crew: OLLIE, label: 'Level 6', detail: 'Ollie reached level 6.', level: 6, ts: at(3) },
    ],
    meta({ state: 'idle' }), 3, { status: 'idle' },
  ),
  /** Control board: effort meters and the "stepped down" note. */
  effort: () => base(EFFORT_TURNS, meta({ state: 'idle' }), EFFORT_TURNS.length, { status: 'idle' }),
  /** Control board: Pip asks before the expensive crew start. */
  'pip-proposes': () => base(
    [{ kind: 'user', text: 'Add a --json flag to the avatar generator, with tests and docs', imageCount: 0, ts: at(0) }],
    meta({ state: 'idle', escalation: { reason: 'three files and a test', planner: 'Ollie', reviewer: 'Juno' } }), 1, { status: 'idle' },
  ),
  /** Context board: the agent whose context it is asks, once. */
  'compact-ask': () => base(
    TWO_JOBS.slice(5, 8),
    meta({ state: 'idle', contextOffer: { reason: 'context 64% full', percent: 64 } }), 3,
    { status: 'idle', context: { agent: 'claude', usedTokens: 128_000, maxTokens: 200_000, percent: 64, pressure: 'degrading' } as any },
  ),
  /** The pass, live: Ollie steps back, Juno steps in. */
  handoff: () => base(HANDOFF, meta({ state: 'idle', crew: JUNO }), HANDOFF.length - 1),
  'handoff-replayed': () => base(HANDOFF, meta({ state: 'idle', crew: JUNO }), HANDOFF.length),
  /** Effort, visible: the same working indicator at low and at xhigh. */
  'effort-low': () => base(TWO_JOBS.slice(5, 8), meta({ effort: 'low', state: 'working' }), 3, { status: 'working', statusMessage: 'Ollie is thinking…' }),
  'effort-xhigh': () => base(TWO_JOBS.slice(5, 8), meta({ effort: 'xhigh', state: 'working' }), 3, { status: 'working', statusMessage: 'Ollie is thinking…' }),
  /** Sleeping on idle: the last thing here happened an hour ago. */
  asleep: () => base(TWO_JOBS.slice(0, 5), meta({ state: 'idle' }), 5, { status: 'idle', openedAt: Date.now() - 3_600_000 }),
  /** Two jobs; the first verified and already folded (history). */
  chapters: () => base(TWO_JOBS, meta(), TWO_JOBS.length),
  /** The same, but the first job closes LIVE — so it stamps, cheers, then folds. */
  'chapters-live': () => base(TWO_JOBS, meta(), 0),
  /** An approval waiting — both the per-tool remember-choice and the real
   *  full-auto switch, so the two are checkable side by side. */
  approval: () =>
    base(TWO_JOBS, meta(), TWO_JOBS.length, {
      pendingApproval: { requestId: 'r1', title: 'Bash', detail: 'npm run build' },
      pendingApprovalCount: 1,
    }),
  /** Full auto already on — the persistent warning bar should be visible. */
  'full-auto': () => base(TWO_JOBS, meta({ approvals: 'full-auto' }), TWO_JOBS.length),
  /** A job two people worked, closing live: both cheer, confetti fires once. */
  earned: () => base(EARNED, meta(), 0),
  /** A gate fails, live: the red stamp lands, the badge reads FAILED. */
  'gate-failed': () => base(GATE_FAILED, meta(), 0, { status: 'idle' }),
  /** Three jobs across three days -- Week of…, Yesterday, Today. */
  'chapters-days': () => base(THREE_DAYS, meta(), THREE_DAYS.length),
  /** The instant after ↑ in auto mode: Pip, thinking, before triage returns. */
  triage: () =>
    base([{ kind: 'user', text: 'Rename fmtAgo to formatAgo everywhere', imageCount: 0, ts: at(0) }], meta(), 0, {
      status: 'idle', triaging: true,
    }),
  /** Routed to Haiku: "Pip sent this to Moss", and Moss typing below. */
  routed: () => base(MOSS_ROUTED, meta({ crew: MOSS, routedModel: 'claude-haiku-4-5' }), 0),
  /** A run of tool calls folded to one line, the last still running. */
  toolrun: () =>
    base(
      [
        { kind: 'user', text: 'Rename fmtAgo to formatAgo everywhere', imageCount: 0, ts: at(0) },
        { kind: 'tool', toolId: 'a', name: 'Grep', detail: '“fmtAgo” in web/src', done: true, ok: true, ts: at(1) },
        { kind: 'tool', toolId: 'b', name: 'Read', detail: 'web/src/format.ts', done: true, ok: true, ts: at(2) },
        { kind: 'tool', toolId: 'c', name: 'Edit', detail: 'web/src/format.ts', done: true, ok: true, ts: at(3) },
        { kind: 'tool', toolId: 'd', name: 'Bash', detail: 'npm test -w web', done: false, ts: at(4) },
      ],
      meta({ crew: MOSS, mode: 'chat' }),
      0,
    ),
  /** "@Nell" from a Claude session: Nell answers in the thread, as her own turn. */
  mention: () =>
    base(
      [
        { kind: 'user', text: 'Nell, the composer loses the draft on reconnect — can you look?', imageCount: 0, ts: at(0) },
        {
          kind: 'consult', phase: 'mention', agent: 'codex',
          crew: crew('Nell', 'nell', 'codex', 'gpt-5.6-astra', '#8a4b3a', 'Chat'),
          text: 'Found it: `Composer` resets `text` in the `[sessionId]` effect, which also fires on reconnect because the socket remounts. Moved the reset behind a `sessionId !== prev` check in `web/src/ChatView.tsx:143`. `npm test -w web`: 67 passed.',
          ts: at(1),
        },
      ],
      meta({ crew: MOSS, mode: 'chat', state: 'idle' }),
      2,
      { status: 'idle' },
    ),
  /** The pizza tracker mid-job: Plan and Review done, Build awaiting your Proceed. */
  tracker: () =>
    base(TWO_JOBS.slice(5, 10), meta({ mode: 'build', consultPending: true, planPath: '/x/.pocket/plans/t1.md' }), 5, { status: 'idle' }),
};
