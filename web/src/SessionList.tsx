import { useEffect, useState } from 'react';
import { api } from './api';
import type { AgentKind, PocketConfigResponse, SessionMeta } from './types';

interface Resumable {
  id: string;
  title: string;
  updatedAt: number;
}

function fmtAgo(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function FolderBrowser(props: { onPick: (path: string) => void; onClose: () => void }) {
  const [dir, setDir] = useState<{
    path: string;
    parent: string | null;
    dirs: Array<{ name: string; path: string; isRepo: boolean }>;
    shortcuts: Array<{ name: string; path: string }>;
  } | null>(null);

  useEffect(() => {
    api.browse().then(setDir).catch(() => {});
  }, []);

  const nav = (path: string) => api.browse(path).then(setDir).catch(() => {});

  return (
    <div className="sheet-backdrop" onClick={props.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Add project</h3>
        {dir && (
          <>
            <div className="chips browse-shortcuts">
              {dir.shortcuts.map((s) => (
                <button
                  key={s.path}
                  className={dir.path === s.path ? 'chip active' : 'chip'}
                  onClick={() => nav(s.path)}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <div className="mono-note browse-path">{dir.path}</div>
            <div className="resume-list browse-list">
              {dir.parent && (
                <button className="resume-row" onClick={() => nav(dir.parent!)}>
                  <span className="resume-title">‹ up</span>
                </button>
              )}
              {dir.dirs.map((d) => (
                <button key={d.path} className="resume-row" onClick={() => nav(d.path)}>
                  <span className="resume-title">
                    {d.isRepo ? '● ' : ''}
                    {d.name}
                  </span>
                  <span className="resume-time">›</span>
                </button>
              ))}
            </div>
            <div className="sheet-actions">
              <button className="danger" onClick={props.onClose}>
                Cancel
              </button>
              <button className="primary" onClick={() => props.onPick(dir.path)}>
                Use this folder
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function SessionList(props: { config: PocketConfigResponse; onOpen: (id: string) => void }) {
  const { config, onOpen } = props;
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [agent, setAgent] = useState<AgentKind>('claude');
  const [projects, setProjects] = useState<string[]>(config.projects);
  const [showBrowser, setShowBrowser] = useState(false);
  const [cwd, setCwd] = useState(config.projects[0] ?? '');
  const [model, setModel] = useState(config.claude.defaultModel);
  const [resumable, setResumable] = useState<Resumable[]>([]);
  const [resume, setResume] = useState<Resumable | null>(null);
  const [showAllResumable, setShowAllResumable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agentConfig = config[agent];

  useEffect(() => {
    api.sessions().then((r) => setSessions(r.sessions)).catch(() => {});
  }, []);

  useEffect(() => {
    setModel(config[agent].defaultModel);
  }, [agent, config]);

  useEffect(() => {
    setResume(null);
    setShowAllResumable(false);
    setResumable([]);
    if (!cwd) return;
    let cancelled = false;
    api
      .resumable(agent, cwd)
      .then((r) => {
        if (!cancelled) setResumable(r.sessions);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [agent, cwd]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.createSession({
        agent,
        cwd,
        model: model || undefined,
        resume: resume?.id,
        title: resume?.title,
      });
      onOpen(r.session.id);
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function close(id: string) {
    await api.closeSession(id).catch(() => {});
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }

  const visibleResumable = showAllResumable ? resumable : resumable.slice(0, 5);

  return (
    <div className="page">
      <header className="page-header">
        <h1>Pocket</h1>
        <span className="subtitle">your laptop, in your pocket</span>
      </header>

      <section className="card">
        <h2>New session</h2>
        <div className="field">
          <label>Agent</label>
          <div className="segmented">
            {(['claude', 'codex'] as const).map((a) => (
              <button key={a} className={agent === a ? 'seg active' : 'seg'} onClick={() => setAgent(a)}>
                {a === 'claude' ? 'Claude Code' : 'Codex'}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Project</label>
          <div className="project-row">
            <select value={cwd} onChange={(e) => setCwd(e.target.value)}>
              {projects.map((p) => (
                <option key={p} value={p}>
                  {p.split('/').slice(-2).join('/')}
                </option>
              ))}
            </select>
            <button className="chip" onClick={() => setShowBrowser(true)}>
              ＋ Add
            </button>
          </div>
        </div>
        <div className="field">
          <label>Model</label>
          <div className="chips">
            {agentConfig.models.map((m) => (
              <button key={m.id} className={model === m.id ? 'chip active' : 'chip'} onClick={() => setModel(m.id)}>
                {m.label}
              </button>
            ))}
            <button className={model === '' ? 'chip active' : 'chip'} onClick={() => setModel('')}>
              default
            </button>
          </div>
        </div>
        {resumable.length > 0 && (
          <div className="field">
            <label>Continue a previous session</label>
            <div className="resume-list">
              <button className={resume === null ? 'resume-row active' : 'resume-row'} onClick={() => setResume(null)}>
                <span className="resume-title">Start fresh</span>
              </button>
              {visibleResumable.map((s) => (
                <button
                  key={s.id}
                  className={resume?.id === s.id ? 'resume-row active' : 'resume-row'}
                  onClick={() => setResume(s)}
                >
                  <span className="resume-title">{s.title}</span>
                  <span className="resume-time">{fmtAgo(s.updatedAt)}</span>
                </button>
              ))}
              {resumable.length > 5 && !showAllResumable && (
                <button className="link" onClick={() => setShowAllResumable(true)}>
                  Show {resumable.length - 5} more
                </button>
              )}
            </div>
          </div>
        )}
        {error && <div className="error-note">{error}</div>}
        <button className="primary" disabled={busy || !cwd} onClick={create}>
          {busy ? 'Starting…' : resume ? 'Resume session' : 'Start session'}
        </button>
      </section>

      {showBrowser && (
        <FolderBrowser
          onClose={() => setShowBrowser(false)}
          onPick={async (path) => {
            try {
              const r = await api.addProject(path);
              setProjects(r.projects);
              setCwd(path);
              setShowBrowser(false);
            } catch (e: any) {
              setError(String(e.message ?? e));
              setShowBrowser(false);
            }
          }}
        />
      )}

      {sessions.length > 0 && (
        <section className="card">
          <h2>Active sessions</h2>
          {sessions.map((s) => (
            <div key={s.id} className="session-row">
              <button className="session-open" onClick={() => onOpen(s.id)}>
                <span className={`agent-dot ${s.agent}`} />
                <span className="session-title">{s.title}</span>
                <span className="session-sub">
                  {s.agent} · {s.model || 'default model'}
                </span>
              </button>
              <button className="ghost" onClick={() => close(s.id)}>
                ✕
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
