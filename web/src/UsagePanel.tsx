import { useEffect, useState } from 'react';
import { api } from './api';
import type { AgentUsage, UsageSnapshot, WeightEstimate } from './types';
import { fmtAgo, fmtCountdown, barColor, headroomNote } from './usageView';
import { fuelBlocks } from './motion';
import { DecisionsLine } from './DecisionsPanel';

/** What a million tokens costs in window, in plain words, under the windows
 *  it refers to. (2026-09-24: the old line led the card with "≈ 0.657% of
 *  5-hour session per 1M tokens on claude-fable-5-1 (4 samples, low)".) */
function WeightLines({ usage, weights }: { usage: AgentUsage; weights: WeightEstimate[] }) {
  if (!weights.length) return null;
  const known = weights.filter((w) => w.pctPerMillionTokens != null);
  if (!known.length) return null;
  const short = (m: string) => m.replace(/^claude-/, '').replace(/^gpt-/, '');
  return (
    <div className="usage-weights">
      {known.map((w) => {
        const label = usage.windows.find((x) => x.key === w.key)?.label ?? w.key;
        const pct = w.pctPerMillionTokens!;
        const shown = pct >= 1 ? pct.toFixed(1) : pct.toFixed(2);
        return (
          <div key={`${w.key}:${w.model}`} className="usage-note usage-note-muted" title={w.note}>
            1M tokens on {short(w.model)} ≈ {shown}% of the {label} · {w.confidence} confidence, {w.samples} sample{w.samples === 1 ? '' : 's'}
          </div>
        );
      })}
    </div>
  );
}

function AgentUsageBlock({ label, usage, prev, weights = [] }: { label: string; usage: AgentUsage; prev?: AgentUsage; weights?: WeightEstimate[] }) {
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
            // Fuel you can watch leave. Twenty blocks, and the ones spent since the
            // last reading flare and then settle — an abstract percentage becomes
            // a thing that went. Keyed on the reading so a new spend replays the
            // flare, and it plays once: no timer, no loop.
            <div className="fuel-blocks" key={`${w.key}:${w.usedPercent}`}>
              {(fuelBlocks(prev?.windows.find((p) => p.key === w.key)?.usedPercent, w.usedPercent) ?? []).map((b, bi) => (
                <span
                  key={bi}
                  className={`fuel-block ${b}`}
                  style={b === 'free' ? undefined : { background: barColor(w.usedPercent!, w.status, usage.headroom) }}
                />
              ))}
            </div>
          )}
        </div>
      ))}
      <WeightLines usage={usage} weights={weights} />
    </div>
  );
}

/** The board's FUEL line: per vendor, the TIGHTEST window only — the one that
 *  will stop you first — as blocks, with when it resets. The full table is one
 *  tap away; the home screen should not open on a spreadsheet. */
function FuelSummary({ usage, prev, onExpand }: { usage: UsageSnapshot; prev: UsageSnapshot | null; onExpand: () => void }) {
  const rows = (['claude', 'codex'] as const).map((agent) => {
    const u = usage[agent];
    const known = u.windows.filter((w) => w.usedPercent != null);
    // `known` holds only windows with a reading, so the comparison needs no
    // fallback — and a zero default on a percent is exactly what the doctrine bans.
    const tight = known.sort((a, b) => b.usedPercent! - a.usedPercent!)[0];
    const was = tight ? prev?.[agent]?.windows.find((w) => w.key === tight.key)?.usedPercent : undefined;
    return { agent, u, tight, was };
  });
  return (
    <section className="card fuel">
      <div className="usage-header">
        <h2>Fuel</h2>
        <button className="chip" onClick={onExpand}>Details</button>
      </div>
      {rows.map(({ agent, u, tight, was }) => (
        <div key={agent} className={`fuel-row${u.headroom === 'stale' ? ' usage-window-stale' : ''}`}>
          <div className="fuel-row-top">
            <span className={`fuel-agent ${agent}`}>{agent}</span>
            {tight ? (
              <span className="fuel-pct">{tight.usedPercent}%</span>
            ) : (
              // Unknown renders as unknown — never as an empty, reassuring bar.
              <span className="fuel-pct fuel-none">no data</span>
            )}
          </div>
          {tight && (
            <div className="fuel-when">
              {tight.label}
              {tight.resetsAt ? ` · ${fmtCountdown(tight.resetsAt)}` : ''}
              {u.headroom === 'stale' ? ` · seen ${fmtAgo(tight.observedAt)}` : ''}
            </div>
          )}
          {tight && (
            <div className="fuel-blocks" key={`${tight.key}:${tight.usedPercent}`}>
              {(fuelBlocks(was, tight.usedPercent) ?? []).map((b, i) => (
                <span key={i} className={`fuel-block ${b}`} style={b === 'free' ? undefined : { background: barColor(tight.usedPercent!, tight.status, u.headroom) }} />
              ))}
            </div>
          )}
          {/* A solid red bar with nothing to do about it (2026-09-27 audit).
              Pip already routes around a vendor at its limit; say so. */}
          {tight && tight.usedPercent != null && tight.usedPercent >= 100 && (
            <div className="fuel-out">
              {agent === 'codex' ? 'Codex' : 'Claude'} is used up{tight.resetsAt ? ` (${fmtCountdown(tight.resetsAt)})` : ' for now'} — the {agent === 'codex' ? 'Claude' : 'Codex'} crew picks up the work meanwhile.
            </div>
          )}
        </div>
      ))}
      <DecisionsLine />
    </section>
  );
}

export function UsagePanel({ compact = false }: { compact?: boolean }) {
  const [expanded, setExpanded] = useState(!compact);
  const [snap, setSnap] = useState<{ now: UsageSnapshot | null; prev: UsageSnapshot | null }>({ now: null, prev: null });
  const usage = snap.now;
  const setUsage = (next: UsageSnapshot | null) => setSnap((s) => ({ prev: s.now, now: next }));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [weights, setWeights] = useState<WeightEstimate[]>([]);

  useEffect(() => {
    const load = () =>
      api
        .usage()
        .then((r) => setUsage(r.usage))
        .catch(() => {})
        .finally(() => setLoadedOnce(true));
    void load();
    api.weights().then((r) => setWeights(r.estimates)).catch(() => {});
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
  if (compact && !expanded && usage) {
    return <FuelSummary usage={usage} prev={snap.prev} onExpand={() => setExpanded(true)} />;
  }

  return (
    <section className="card usage-card">
      <div className="usage-header">
        <h2>{compact ? 'Fuel' : 'Usage'}</h2>
        <span className="usage-header-actions">
          <button className="chip" disabled={loading} onClick={refresh}>
            {loading ? 'Checking…' : usage ? 'Refresh' : 'Check now'}
          </button>
          {/* Opened from the summary, it can close again (2026-09-24: "no
              way to collapse it back"). */}
          {compact && (
            <button className="chip" onClick={() => setExpanded(false)}>
              Less
            </button>
          )}
        </span>
      </div>
      {error && <div className="error-note">{error}</div>}
      {usage ? (
        <>
          <div className="usage-grid">
            <AgentUsageBlock label="Claude" usage={usage.claude} prev={snap.prev?.claude} weights={weights.filter((w) => w.agent === 'claude')} />
            <AgentUsageBlock label="Codex" usage={usage.codex} prev={snap.prev?.codex} weights={weights.filter((w) => w.agent === 'codex')} />
          </div>
          <div className="usage-updated">Updated {fmtAgo(usage.fetchedAt)}</div>
        </>
      ) : (
        <div className="usage-empty">Tap "Check now" to pull current usage and reset times.</div>
      )}
    </section>
  );
}
