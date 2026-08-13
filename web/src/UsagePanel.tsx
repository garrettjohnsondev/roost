import { useEffect, useState } from 'react';
import { api } from './api';
import type { AgentUsage, UsageSnapshot } from './types';

function fmtAgo(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function fmtCountdown(resetsAt: number): string {
  const mins = Math.round((resetsAt - Date.now()) / 60_000);
  if (mins <= 0) return 'resetting now';
  if (mins < 60) return `resets in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `resets in ${hours}h ${mins % 60}m`;
  return `resets in ${Math.round(hours / 24)}d`;
}

function barColor(pct: number | undefined, status: string | undefined): string {
  if (status === 'rejected' || (pct ?? 0) >= 90) return 'var(--danger)';
  if (status === 'allowed_warning' || (pct ?? 0) >= 70) return '#d9a441';
  return 'var(--ok)';
}

function AgentUsageBlock({ label, usage }: { label: string; usage: AgentUsage }) {
  if (usage.error) {
    return (
      <div className="usage-block">
        <div className="usage-block-label">{label}</div>
        <div className="usage-block-error">{usage.error}</div>
      </div>
    );
  }
  if (usage.windows.length === 0) {
    return (
      <div className="usage-block">
        <div className="usage-block-label">{label}</div>
        <div className="usage-block-error">No data yet</div>
      </div>
    );
  }
  return (
    <div className="usage-block">
      <div className="usage-block-label">
        {label}
        {usage.planType ? <span className="usage-plan"> · {usage.planType}</span> : null}
      </div>
      {usage.windows.map((w, i) => (
        <div key={i} className="usage-window">
          <div className="usage-window-top">
            <span>{w.label}</span>
            <span className="usage-window-meta">
              {w.usedPercent != null ? `${w.usedPercent}%` : w.status ?? ''}
              {w.resetsAt ? ` · ${fmtCountdown(w.resetsAt)}` : ''}
            </span>
          </div>
          {w.usedPercent != null && (
            <div className="usage-bar-track">
              <div
                className="usage-bar-fill"
                style={{ width: `${Math.min(100, w.usedPercent)}%`, background: barColor(w.usedPercent, w.status) }}
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
