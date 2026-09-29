import { pathParts } from './platform.js';
/** One line saying what a tool call is DOING, for the thread's tool chip.
 *
 *  It was `JSON.stringify(input)`, so a shell command arrived as
 *  `{"command":"ls -la && …` — braces, quotes and key names ahead of the thing
 *  you wanted to see, and the "commands type themselves" animation spent its
 *  first dozen steps typing punctuation. Known tools show their subject; an
 *  unknown one still shows its JSON rather than nothing, because hiding what a
 *  tool was called with would be worse than showing it clumsily. */
export function toolDetail(name: string, input: unknown): string {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof i[k] === 'string' ? (i[k] as string).trim() : '');
  const base = (p: string) => pathParts(p).slice(-2).join('/');
  switch (name) {
    case 'Bash':
      return s('command') || s('description') || fallback(i);
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return s('file_path') ? base(s('file_path')) : s('notebook_path') ? base(s('notebook_path')) : fallback(i);
    case 'Grep':
      return [s('pattern') && `“${s('pattern')}”`, s('path') && `in ${base(s('path'))}`, s('glob')].filter(Boolean).join(' ') || fallback(i);
    case 'Glob':
      return s('pattern') || fallback(i);
    case 'WebFetch':
      return s('url') || fallback(i);
    case 'WebSearch':
      return s('query') || fallback(i);
    case 'Task':
    case 'Agent':
      return s('description') || s('prompt').slice(0, 120) || fallback(i);
    case 'mcp__roost__code_explore':
      return s('query') ? `code map: ${s('query')}` : fallback(i);
    case 'mcp__roost__code_impact':
      return s('symbol') ? `what depends on ${s('symbol')}` : fallback(i);
    case 'TodoWrite':
      return Array.isArray(i.todos) ? `${i.todos.length} todo${i.todos.length === 1 ? '' : 's'}` : fallback(i);
    default:
      return fallback(i);
  }
}

function fallback(i: Record<string, unknown>): string {
  return JSON.stringify(i);
}
