import type { AgentUsage } from './types';

/** The fuel gauge's pure parts, kept free of JSX so they can be tested without a DOM. */

export function fmtAgo(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

export function fmtCountdown(resetsAt: number): string {
  const mins = Math.round((resetsAt - Date.now()) / 60_000);
  if (mins <= 0) return 'resetting now';
  if (mins < 60) return `resets in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `resets in ${hours}h ${mins % 60}m`;
  return `resets in ${Math.round(hours / 24)}d`;
}

export function barColor(pct: number, status: string | undefined, headroom: AgentUsage['headroom']): string {
  if (status === 'rejected' || headroom === 'exhausted' || pct >= 90) return 'var(--danger)';
  if (headroom === 'stale') return 'var(--muted, #8a8a8a)';
  if (status === 'allowed_warning' || pct >= 70) return '#d9a441';
  return 'var(--ok)';
}

/** What the headroom state means, in words. A bare percent hides whether it
 *  is live, hours old, or sitting next to an explicit denial -- and the old
 *  panel showed a 3-hour-old 40% exactly like a live one. */
export function headroomNote(usage: AgentUsage): { text: string; tone: 'warn' | 'bad' | 'muted' } | null {
  if (usage.usageAllowed === false) return { text: 'Provider reports usage not allowed', tone: 'bad' };
  const oldest = usage.windows.length ? Math.min(...usage.windows.map((w) => w.observedAt)) : null;
  switch (usage.headroom) {
    case 'exhausted': return { text: 'Limit reached', tone: 'bad' };
    case 'stale': return { text: `Stale — last seen ${oldest ? fmtAgo(oldest) : 'unknown'}`, tone: 'muted' };
    case 'gated': return { text: 'Near the limit — new work is gated', tone: 'warn' };
    case 'tight': return { text: 'Getting tight', tone: 'warn' };
    case 'unknown': return usage.windows.length ? { text: 'No percentages reported', tone: 'muted' } : null;
    default: return null;
  }
}

