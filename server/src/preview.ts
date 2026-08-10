import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { getCodexRolloutPath, tail } from './resumable.js';
import { truncate } from './util.js';

export interface PreviewMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface PreviewFile {
  path: string;
  action: 'created' | 'edited' | 'deleted' | 'touched';
  before?: string;
  after?: string;
  extra?: number;
}

export interface PreviewResult {
  messages: PreviewMessage[];
  files: PreviewFile[];
}

const MAX_MESSAGES = 6;
const MAX_FILES = 6;
const DIFF_SNIPPET_LEN = 220;

const FILE_TOOL_NAMES = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

export async function getClaudePreview(cwd: string, id: string): Promise<PreviewResult> {
  const msgs = await getSessionMessages(id, { dir: cwd });
  const messages: PreviewMessage[] = [];
  const files: PreviewFile[] = [];
  const seenFiles = new Set<string>();

  // Walk backwards from the end so the newest text/edits are found first — messages get
  // reversed into chronological order below, and files naturally keep only the latest
  // touch per path since we skip a path once we've already recorded its most recent state.
  const SAFETY_CAP = 400;
  for (let i = msgs.length - 1; i >= 0 && i > msgs.length - 1 - SAFETY_CAP; i--) {
    if (messages.length >= MAX_MESSAGES && files.length >= MAX_FILES) break;
    const m = msgs[i];
    const content = (m.message as any)?.content;
    if (!Array.isArray(content)) continue;
    const role = m.type === 'user' || m.type === 'assistant' ? m.type : null;

    for (const block of content) {
      if (messages.length < MAX_MESSAGES && role && block.type === 'text' && block.text?.trim()) {
        messages.push({ role, text: truncate(block.text.trim(), 400) });
      }
      if (files.length < MAX_FILES && block.type === 'tool_use' && FILE_TOOL_NAMES.has(block.name)) {
        const path = block.input?.file_path ?? block.input?.notebook_path;
        if (!path || seenFiles.has(path)) continue;
        seenFiles.add(path);
        if (block.name === 'Write') {
          files.push({ path, action: 'created', after: truncate(String(block.input?.content ?? ''), DIFF_SNIPPET_LEN) });
        } else if (block.name === 'Edit') {
          files.push({
            path,
            action: 'edited',
            before: truncate(String(block.input?.old_string ?? ''), DIFF_SNIPPET_LEN),
            after: truncate(String(block.input?.new_string ?? ''), DIFF_SNIPPET_LEN),
          });
        } else if (block.name === 'MultiEdit') {
          const edits = Array.isArray(block.input?.edits) ? block.input.edits : [];
          files.push({
            path,
            action: 'edited',
            before: truncate(String(edits[0]?.old_string ?? ''), DIFF_SNIPPET_LEN),
            after: truncate(String(edits[0]?.new_string ?? ''), DIFF_SNIPPET_LEN),
            extra: edits.length > 1 ? edits.length - 1 : undefined,
          });
        } else {
          files.push({ path, action: 'edited' });
        }
      }
    }
  }

  messages.reverse();
  return { messages, files };
}

// Codex rollout files log raw model-facing items rather than a structured file-change log,
// so unlike Claude we can't reliably reconstruct a before/after diff — only detect that a
// path was touched, via the standard apply_patch patch-header convention.
// [^\s\\]+ rather than \S+: patch bodies arrive embedded in a JS string literal with
// *literal* backslash-n escapes (not real newlines), which \S+ would happily swallow
// along with the rest of the patch hunk that follows the path.
const PATCH_HEADER = /\*\*\* (Update|Add|Delete) File: ([^\s\\]+)/g;

export function getCodexPreview(cwd: string, id: string): PreviewResult {
  const path = getCodexRolloutPath(cwd, id);
  if (!path) return { messages: [], files: [] };

  const chunk = tail(path, 400 * 1024);
  const lines = chunk.split('\n').slice(1); // first line is likely truncated mid-record

  const messages: PreviewMessage[] = [];
  const files: PreviewFile[] = [];

  for (const line of lines) {
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== 'response_item') continue;
    const p = entry.payload;

    if (p?.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
      const text = (p.content ?? [])
        .filter((c: any) => c?.type === 'input_text' || c?.type === 'output_text')
        .map((c: any) => c.text)
        .join('')
        .trim();
      if (text && !text.startsWith('<')) messages.push({ role: p.role, text: truncate(text, 400) });
    }

    if (p?.type === 'custom_tool_call' && typeof p.input === 'string') {
      for (const match of p.input.matchAll(PATCH_HEADER)) {
        const [, verb, filePath] = match;
        files.push({
          path: filePath,
          action: verb === 'Add' ? 'created' : verb === 'Delete' ? 'deleted' : 'edited',
        });
      }
    }
  }

  const dedupedFiles = files
    .reverse() // most recent touch first
    .filter((f, i, arr) => arr.findIndex((g) => g.path === f.path) === i)
    .slice(0, MAX_FILES);

  return { messages: messages.slice(-MAX_MESSAGES), files: dedupedFiles };
}
