/** Output from another agent is UNTRUSTED INPUT.
 *
 *  A dispatched agent's text goes straight into another model's context. If it
 *  contains anything that reads as a control structure -- a system-reminder
 *  block, a turn marker, a tool-call envelope -- the receiving model may treat
 *  it as instruction rather than data. That is prompt injection with extra
 *  steps, and it does not require the other agent to be malicious: a reviewer
 *  quoting a file that happens to contain these markers is enough.
 *
 *  Neutralized, not stripped. Deleting text would hide evidence from a reviewer
 *  reading the transcript; defanging keeps it visible and inert. */

const PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /<\/?\s*(system-reminder|system|human|assistant|antml:[a-z_]+)\s*>/gi, label: 'control tag' },
  { re: /<\/?\s*(function_calls|function_results|invoke|parameter)\s*>/gi, label: 'tool envelope' },
  { re: /^\s*(Human|Assistant|System)\s*:/gim, label: 'turn marker' },
  { re: /\[\/?INST\]|<\|im_(start|end)\|>|<\|(begin|end)_of_text\|>/gi, label: 'chat template' },
];

export interface SanitizeResult {
  text: string;
  /** What was defanged, for the transcript. Empty means the text was clean. */
  findings: string[];
}

export function sanitizeAgentOutput(raw: string): SanitizeResult {
  const seen = new Set<string>();
  let text = raw;
  for (const { re, label } of PATTERNS) {
    text = text.replace(re, (m) => {
      seen.add(label);
      // Zero-width joiner after the opening character: visually identical in a
      // transcript, no longer parseable as a control structure.
      return m.replace(/^(.)/, '$1‍');
    });
  }
  return { text, findings: [...seen] };
}
