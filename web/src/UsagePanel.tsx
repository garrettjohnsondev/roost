import { useEffect, useState } from 'react';
import { api } from './api';
import type { AgentUsage, UsageSnapshot } from './types';
import { fmtAgo, fmtCountdown, barColor, headroomNote } from './usageView';

function AgentUsageBlock({ label, usage }: { label: string; usage: AgentUsage }) {
  const note = headroomNote(usage);
  const stale = usage.headroom === 'stale';
  if (usage.windows.length === 0) {
    return (
      <div className="usage-block">
        <div className="usage-block-label">{label}</div>
        <div className="usage-block-error">{usage.error ? `Not connected · ${usage.error}` : 'No data yet'}</div>
        {note && <div className={`usage-note usage-note-${note.tone}`}>{note.text}</div>}
      </div>
    );
  }
  return (
    <div className="usage-block">
      <div className="usage-block-label">
        {label}
        {usage.planType ? <span className="usage-plan"> · {usage.planType}</span> : null}
      </div>
      {usage.error && <div className="usage-block-error">{usage.error}</div>}
      {note && <div className={`usage-note usage-note-${note.tone}`}>{note.text}</div>}
      {usage.windows.map((w, i) => (
        <div key={w.key ?? i} className={`usage-window${stale ? ' usage-window-stale' : ''}`}>
          <div className="usage-window-top">
            <span>{w.label}</span>
            <span className="usage-window-meta">
              {w.status === 'rejected' ? 'rejected' : w.usedPercent != null ? `${w.usedPercent}%` : 'no data'}
              {w.resetsAt ? ` · ${fmtCountdown(w.resetsAt)}` : ''}
              {stale ? ` · seen ${fmtAgo(w.observedAt)}` : ''}
            </span>
          </div>
          {w.usedPercent != null && (
            <div className="usage-bar-track">
              <div
                className="usage-bar-fill"
                style={{ width: `${Math.min(100, w.usedPercent)}%`, background: barColor(w.usedPercent, w.status, usage.headroom) }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function UsagePanel() {
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  useEffect(() => {
    const load = () =>
      api
        .usage()
        .then((r) => setUsage(r.usage))
        .catch(() => {})
        .finally(() => setLoadedOnce(true));
    void load();
    // The server refreshes this cache for free from live sessions' rate-limit events,
    // so poll the (local, cheap) cached value to pick those updates up.
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, []);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const r = await api.refreshUsage();
      setUsage(r.usage);
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  if (!loadedOnce) return null;

  return (
    <section className="card usage-card">
      <div className="usage-header">
        <h2>Usage</h2>
        <button className="chip" disabled={loading} onClick={refresh}>
          {loading ? 'Checking…' : usage ? 'Refresh' : 'Check now'}
        </button>
      </div>
      {error && <div className="error-note">{error}</div>}
      {usage ? (
        <>
          <div className="usage-grid">
            <AgentUsageBlock label="Claude" usage={usage.claude} />
            <AgentUsageBlock label="Codex" usage={usage.codex} />
          </div>
          <div className="usage-updated">Updated {fmtAgo(usage.fetchedAt)}</div>
        </>
      ) : (
        <div className="usage-empty">Tap "Check now" to pull current usage and reset times.</div>
      )}
    </section>
  );
}
