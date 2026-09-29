import { relativeInside } from './platform.js';
/** A permission request in plain words (2026-09-25).
 *
 *  The approval used to be a pop-up reading "Claude wants to use Bash" over the
 *  tool's raw JSON, with two link-styled lines under it that "didn't even look
 *  like buttons". It is a text in the thread now, from whoever is asking:
 *  "Can I run a command?", the command itself, and why. This turns an engine's
 *  tool call into those words. Pure, so every wording is testable. */
export interface ApprovalWords {
  /** Finishes "Can I …?" -- "run a command", "edit a file". */
  action: string;
  /** What exactly: the command, the file, the URL. */
  target?: string;
  /** Their reason, when the engine gave one. */
  note?: string;
  /** Plural for "Don't ask again for …" -- "commands", "file edits". */
  kind: string;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** A path shortened to the project, the way you would say it. */
export function shortTarget(p: string | undefined, cwd?: string): string | undefined {
  if (!p) return undefined;
  if (cwd && p.startsWith(cwd.replace(/\/$/, '') + '/')) return p.slice(cwd.replace(/\/$/, '').length + 1);
  // A Windows path (C:\\proj\\src\\a.ts): same idea, either slash, any case.
  if (cwd && /^[a-zA-Z]:[\\/]/.test(cwd)) return relativeInside(cwd, p, 'win32') || p;
  return p;
}

export function describeToolUse(tool: string, input: Record<string, unknown>, cwd?: string): ApprovalWords {
  const i = input ?? {};
  switch (tool) {
    case 'Bash':
      return { action: 'run a command', target: str(i.command), note: str(i.description), kind: 'commands' };
    case 'Edit':
    case 'MultiEdit':
      return { action: 'edit a file', target: shortTarget(str(i.file_path), cwd), kind: 'file edits' };
    case 'Write':
      return { action: 'write a file', target: shortTarget(str(i.file_path), cwd), kind: 'file edits' };
    case 'NotebookEdit':
      return { action: 'edit a notebook', target: shortTarget(str(i.notebook_path), cwd), kind: 'notebook edits' };
    case 'Read':
      return { action: 'read a file', target: shortTarget(str(i.file_path), cwd), kind: 'file reads' };
    case 'Glob':
    case 'Grep':
      return { action: 'search the project', target: str(i.pattern), kind: 'searches' };
    case 'WebFetch':
      return { action: 'open a web page', target: str(i.url), note: str(i.prompt), kind: 'web pages' };
    case 'WebSearch':
      return { action: 'search the web', target: str(i.query), kind: 'web searches' };
    case 'Task':
    case 'Agent':
      return { action: 'send a helper', target: str(i.description), kind: 'helpers' };
    default: {
      const mcp = tool.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
      if (mcp) return { action: `use ${mcp[1].replace(/[_-]+/g, ' ')}`, target: mcp[2].replace(/[_-]+/g, ' '), kind: `${mcp[1].replace(/[_-]+/g, ' ')} actions` };
      return { action: `use ${tool}`, kind: `${tool} uses` };
    }
  }
}
