// The planning conversation, readable as one (2026-09-29: "I'm missing the
// back and forth between Claude and Codex"). Each turn used to carry the whole
// plan -- the reconcile turn repeated it end to end -- so the review between
// them scrolled past unseen. Now each turn shows what that speaker is SAYING;
// the full plan is one tap away.

/** One `## Heading` / `### Heading` section's body, or null. */
function section(md: string, name: RegExp): string | null {
  const lines = md.split('\n');
  const at = lines.findIndex((l) => /^#{1,4}\s/.test(l) && name.test(l.replace(/^#+\s*/, '')));
  if (at < 0) return null;
  const level = /^#+/.exec(lines[at])![0].length;
  const out: string[] = [];
  // A heading like "## Reconciliation — one line per finding" may carry text on its own line.
  const inline = lines[at].replace(/^#+\s*[^—:-]*[—:-]?\s*/, '').trim();
  for (let i = at + 1; i < lines.length; i++) {
    const m = /^(#+)\s/.exec(lines[i]);
    if (m && m[1].length <= level) break;
    out.push(lines[i]);
  }
  const body = out.join('\n').trim();
  return body || (inline && inline !== lines[at].trim() ? inline : null);
}

function firstParagraph(md: string): string {
  const paras = md.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !/^#/.test(p));
  return paras[0] ?? md.trim();
}

export interface ConsultView {
  /** What this speaker is saying, short. */
  say: string;
  /** More behind a tap (the full plan), or null when `say` is everything. */
  more: string | null;
  moreLabel: string;
}

export function consultView(phase: string, text: string): ConsultView {
  const t = text.trim();
  if (phase === 'plan') {
    const approach = section(t, /^approach\b/i);
    const say = approach ? firstParagraph(approach) : firstParagraph(t);
    return { say, more: say.length < t.length - 40 ? t : null, moreLabel: 'Show the full plan' };
  }
  if (phase === 'reconcile') {
    const rec = section(t, /^reconcil/i);
    const plan = rec ? t.slice(0, t.search(/^#{1,4}\s*reconcil/im)).trim() : t;
    return { say: rec ?? 'Updated the plan.', more: plan && plan.length > 40 ? plan : null, moreLabel: 'Show the updated plan' };
  }
  if (phase === 'critique') {
    const say = t.replace(/^\s*VERDICT:.*$/gim, '').trim();
    return { say: say || (/SOLID/i.test(t) ? 'Looks solid.' : t), more: null, moreLabel: '' };
  }
  return { say: t, more: null, moreLabel: '' };
}
