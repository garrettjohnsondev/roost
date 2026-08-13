import { describe, expect, it } from 'vitest';
import { extractClaudePreview, extractCodexPreview } from '../src/preview.js';

const claudeMsg = (type: string, content: unknown[]) => ({ type, message: { content } });

describe('extractClaudePreview', () => {
  it('collects recent text messages in chronological order', () => {
    const result = extractClaudePreview([
      claudeMsg('user', [{ type: 'text', text: 'first question' }]),
      claudeMsg('assistant', [{ type: 'text', text: 'first answer' }]),
      claudeMsg('user', [{ type: 'text', text: 'second question' }]),
    ]);
    expect(result.messages.map((m) => m.text)).toEqual(['first question', 'first answer', 'second question']);
    expect(result.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('extracts before/after for Edit and content for Write, keeping newest touch per path', () => {
    const result = extractClaudePreview([
      claudeMsg('assistant', [
        { type: 'tool_use', name: 'Edit', input: { file_path: '/a.ts', old_string: 'old-v1', new_string: 'new-v1' } },
      ]),
      claudeMsg('assistant', [
        { type: 'tool_use', name: 'Edit', input: { file_path: '/a.ts', old_string: 'old-v2', new_string: 'new-v2' } },
        { type: 'tool_use', name: 'Write', input: { file_path: '/b.ts', content: 'written content' } },
      ]),
    ]);
    const a = result.files.find((f) => f.path === '/a.ts');
    expect(a).toMatchObject({ action: 'edited', before: 'old-v2', after: 'new-v2' });
    const b = result.files.find((f) => f.path === '/b.ts');
    expect(b).toMatchObject({ action: 'created', after: 'written content' });
    expect(result.files).toHaveLength(2);
  });

  it('ignores tool_result and non-text noise', () => {
    const result = extractClaudePreview([
      claudeMsg('user', [{ type: 'tool_result', tool_use_id: 'x', content: 'raw output' }]),
      claudeMsg('assistant', [{ type: 'thinking', thinking: 'hmm' }]),
    ]);
    expect(result.messages).toHaveLength(0);
    expect(result.files).toHaveLength(0);
  });
});

const rolloutLine = (payload: unknown) => JSON.stringify({ timestamp: 't', type: 'response_item', payload });

describe('extractCodexPreview', () => {
  const chunk = (lines: string[]) => ['{"partial":true}', ...lines].join('\n');

  it('collects user/assistant text, skipping injected <context> blocks', () => {
    const result = extractCodexPreview(
      chunk([
        rolloutLine({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>noise</environment_context>' }] }),
        rolloutLine({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'real question' }] }),
        rolloutLine({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'real answer' }] }),
      ]),
    );
    expect(result.messages.map((m) => m.text)).toEqual(['real question', 'real answer']);
  });

  it('extracts file paths from apply_patch headers embedded in JS string literals (regression)', () => {
    // Codex code-mode embeds patches with LITERAL \n escapes, not newlines — a greedy
    // path regex once swallowed the following hunk into the path.
    const input =
      'const r = await tools.exec_command({cmd:"apply_patch"}); ' +
      '"*** Update File: /proj/src/main.ts\\n@@\\n-old\\n+new\\n*** Add File: /proj/src/new.ts\\n+content"';
    const result = extractCodexPreview(chunk([rolloutLine({ type: 'custom_tool_call', name: 'exec', input })]));
    expect(result.files).toEqual([
      { path: '/proj/src/new.ts', action: 'created' },
      { path: '/proj/src/main.ts', action: 'edited' },
    ]);
  });

  it('dedupes repeated touches keeping the most recent, and survives junk lines', () => {
    const patch = (p: string) => rolloutLine({ type: 'custom_tool_call', name: 'exec', input: `*** Update File: ${p}\\n@@` });
    const result = extractCodexPreview(chunk(['not json at all', patch('/x.ts'), patch('/y.ts'), patch('/x.ts')]));
    expect(result.files.map((f) => f.path)).toEqual(['/x.ts', '/y.ts']);
  });
});
