import type { AskLevel } from './protocol.js';

/** Talking it over, at the level you choose (2026-09-25).
 *
 *  "We are supposed to be in a chat like an iMessage group chat with our
 *  agent. The agent should have just asked me like a normal text... It also
 *  shouldn't be multiple questions in a bullet point list." And: "giving the
 *  user the ability to toggle levels... a clarification before building, or
 *  design discussion, which in the background is planning, to the user they
 *  are just texting their buddy -- all the way from a question or two through
 *  to the grill-me skill."
 *
 *  The level travels with each message you send as a short note after your
 *  text; the thread shows only what you typed. `off` adds nothing. Every level
 *  holds to the same shape: one question per message, in plain words, with
 *  their own recommendation, then wait. Facts are theirs to look up; only the
 *  decisions are yours. */
const SHAPE =
  'Ask the way a friend texts: ONE question per message, in plain words, never a bulleted list of questions, and say what you would pick and why. Then stop and wait for my reply. Look up facts yourself; only ask me for decisions. If you have a tool for asking me questions, ask one question per call.';

export const ASK_LEVELS: Record<AskLevel, { label: string; hint: string; note: string }> = {
  off: {
    label: 'Just build',
    hint: 'No questions -- they make the calls and tell you what they assumed.',
    note: '',
  },
  quick: {
    label: 'Quick check',
    hint: 'A question or two, only when something important is unclear.',
    note: `[Roost — how I like to work] If something important about this is genuinely unclear, ask me before you build — at most one or two questions. If it is clear, just do it. ${SHAPE}`,
  },
  talk: {
    label: 'Talk it through',
    hint: 'A short design chat first -- planning, but it feels like texting.',
    note: `[Roost — how I like to work] Before you build anything non-trivial, talk it through with me first: the approach, the trade-offs that matter, anything I would want a say in. ${SHAPE} When we agree, say the plan back in two or three lines and ask whether to go.`,
  },
  grill: {
    label: 'Grill me',
    hint: 'A relentless interview until nothing is left assumed.',
    note: `[Roost — how I like to work] Grill me about this before you build. Work through every decision, and the decisions that depend on each answer, until nothing is left silently assumed. ${SHAPE} Do not build until I confirm we have reached a shared understanding.`,
  },
};

export function askGuidance(level: AskLevel | undefined): string {
  return ASK_LEVELS[level ?? 'quick']?.note ?? '';
}
