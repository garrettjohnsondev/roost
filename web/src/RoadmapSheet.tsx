import { useEffect, useState } from 'react';
import { api } from './api';
import { shortPath } from './format';
import type { RoadmapView } from './types';

/** The map, as it stands (docs/board/Roadmap.dc.html): "a roadmap that reads
 *  itself". Everything here comes from the project's own ROADMAP.md via
 *  /api/roadmap -- phases from the status table, tests from the machine-written
 *  line, corrections from the log, what is in hand from the open items. A
 *  section the file does not have shows "no data", never a zero. Tapping a
 *  phase opens its evidence: the state as the roadmap itself records it. */
export function RoadmapSheet({ initial, onClose }: { initial?: string; onClose: () => void }) {
  // Only projects with a ROADMAP.md are offered; the most recent session's
  // project first when it has one.
  const [failed, setFailed] = useState<string | null>(null);
  const [projects, setProjects] = useState<string[] | null>(null);
  const [cwd, setCwd] = useState<string | undefined>(undefined);
  useEffect(() => {
    api.roadmapProjects()
      .then(({ projects: ps }) => {
        setProjects(ps);
        setCwd(initial && ps.includes(initial) ? initial : ps[0]);
      })
      .catch((e) => setFailed(String(e?.message ?? e)));
  }, []);
  const [view, setView] = useState<{ roadmap: RoadmapView; decisionsToday: number } | null>(null);
  const none = projects !== null && projects.length === 0;
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!cwd) return;
    setView(null);
    setFailed(null);
    setOpen(null);
    api.roadmap(cwd).then(setView).catch((e) => setFailed(String(e?.message ?? e)));
  }, [cwd]);

  const r = view?.roadmap;
  const shipped = r?.phases?.filter((p) => p.state === 'shipped').length ?? null;
  const opened = r?.phases?.find((p) => p.id === open);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet map-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="map-eyebrow">The map</div>
        <h3 className="map-title">A roadmap that reads itself</h3>
        {projects && projects.length > 1 && (
          <div className="map-projects">
            {projects.map((p) => (
              <button key={p} className={p === cwd ? 'chip active' : 'chip'} onClick={() => setCwd(p)}>
                {shortPath(p).split(/[\\/]/).pop()}
              </button>
            ))}
          </div>
        )}

        {failed && <p className="map-empty">Could not read the map: {failed}</p>}
        {none && (
          <p className="map-empty">
            None of your projects has a ROADMAP.md. The map is read from that file — nothing here is typed for the screen,
            so with no file there is nothing to draw.
          </p>
        )}
        {!failed && !none && !view && <p className="map-empty">Reading…</p>}
        {r && !r.exists && cwd && <p className="map-empty">No ROADMAP.md in {shortPath(cwd)} any more.</p>}

        {r?.exists && (
          <>
            {r.phases ? (
              <ol className="map-phases">
                {r.phases.map((p) => (
                  <li key={p.id}>
                    <button className={`map-node ${p.state}${open === p.id ? ' open' : ''}`} onClick={() => setOpen(open === p.id ? null : p.id)}>
                      <span className="map-node-id">{p.id}</span>
                      <span className="map-node-name">{p.name}</span>
                      <span className="map-node-state">{p.state === 'shipped' ? 'Shipped' : p.state === 'in-hand' ? 'In hand' : 'Not yet'}</span>
                      <span className={`map-dot${p.state === 'in-hand' ? ' map-dot-pulse' : ''}`} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="map-empty">No status table in the roadmap — no phases to draw.</p>
            )}
            {opened && (
              <div className="map-evidence">
                <span className="map-evidence-head">Phase {opened.id} · {opened.name}</span>
                {opened.detail}
              </div>
            )}

            <div className="map-stats">
              <Stat n={shipped} label="phases shipped" tone="ok" />
              <Stat
                n={r.tests ? r.tests.passed : null}
                label={r.tests?.failing ? `passing · ${r.tests.failing} failing` : 'tests green'}
                tone={r.tests?.failing ? 'bad' : 'plain'}
              />
              <Stat n={r.corrections} label="corrections logged" tone="lamp" />
              <Stat n={r.open ? r.open.length : null} label="in hand" tone="lamp" />
            </div>

            {r.open && r.open.length > 0 && (
              <div className="map-open">
                <div className="map-open-head">In hand</div>
                <ul>
                  {r.open.map((o) => (
                    <li key={o.n}>
                      <span className="map-open-n">{o.n}</span> {o.title}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="map-note">
              Read from <code>ROADMAP.md</code>: the status table, the test line the suites write, the corrections log and the
              open items{view && view.decisionsToday > 0 ? ` · ${view.decisionsToday} harness decisions today` : ''}. It changes
              when the work changes.
            </p>
          </>
        )}
        <div className="sheet-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number | null; label: string; tone: 'ok' | 'plain' | 'lamp' | 'bad' }) {
  return (
    <div className="map-stat">
      <div className={`map-stat-n ${n == null ? 'none' : tone}`}>{n == null ? 'no data' : n}</div>
      <div className="map-stat-label">{label}</div>
    </div>
  );
}
