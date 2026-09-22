import { useEffect, useState } from 'react';
import { api } from './api';
import type { DecisionsSummary } from './types';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the harness decided in the last day: routes, reviews and their
 *  independence, size-gate skips, dispatches and how they went. This is the
 *  view onto .pocket-data/decisions.jsonl -- the file Phase 4 measures from. */
export function DecisionsPanel() {
  const [summary, setSummary] = useState<DecisionsSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.decisions().then((r) => setSummary(r.summary)).catch(() => setFailed(true));
  }, []);

  if (failed || !summary) return null;
  if (!summary.total) {
    return (
      <section className="card">
        <h2>Decisions</h2>
        <div className="usage-empty">Nothing recorded yet — routes, reviews and dispatches appear here as sessions run.</div>
      </section>
    );
  }
  const d = summary.dispatches;
  const r = summary.reviews;
  const strengths = Object.entries(r.byStrength);
  return (
    <section className="card">
      <h2>
        Decisions <span className="usage-plan">· last 24h</span>
      </h2>
      <ul className="decisions">
        <li>{plural(summary.routes, 'route')}</li>
        <li>
          {plural(d.total, 'dispatch', 'dispatches')}
          {d.total > 0 ? ` · ${d.ok} ok, ${d.failed} failed` : ''}
          {d.meanMs != null ? ` · ${Math.round(d.meanMs / 1000)}s avg` : ''}
        </li>
        <li>
          {plural(r.total, 'review')}
          {r.total > 0 ? ` · ${r.skippedBySizeGate} skipped by the size gate` : ''}
          {strengths.length > 0 ? ` · ${strengths.map(([k, n]) => `${n} ${k}`).join(', ')}` : ''}
        </li>
        {summary.gates.oneWriter > 0 && <li>{plural(summary.gates.oneWriter, 'one-writer notice')}</li>}
      </ul>
    </section>
  );
}
