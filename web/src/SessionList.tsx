import { useEffect, useState } from 'react';
import { api } from './api';
import { fmtAgo, shortPath } from './format';
import { GitSheet } from './GitSheet';
import { GlobalSettings } from './GlobalSettings';
import { PreviewSheet } from './PreviewSheet';
import { UsagePanel } from './UsagePanel';
import { DecisionsPanel } from './DecisionsPanel';
import type { Theme } from './theme';
import type { AgentKind, GitSummary, PocketConfigResponse, RecentProject, SessionMeta } from './types';

function ChangesBadge({ summary, onOpen }: { summary?: GitSummary; onOpen: () => void }) {
  if (!summary || (summary.files === 0 && summary.ahead === 0)) return null;
  return (
    <button className="changes-badge" onClick={onOpen}>
      {summary.files > 0 ? `±${summary.files}` : `↑${summary.ahead}`}
    </button>
  );
}

interface Resumable {
  id: string;
  title: string;
  updatedAt: number;
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

export function SessionList(props: {
  config: PocketConfigResponse;
  onOpen: (id: string) => void;
  theme: Theme;
  onThemeChange: (t: Theme) => void;
}) {
  const { config, onOpen, theme, onThemeChange } = props;
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [recent, setRecent] = useState<RecentProject[] | null>(null);
  const [projects, setProjects] = useState<string[]>(config.projects);
  const [showBrowser, setShowBrowser] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const [agent, setAgent] = useState<AgentKind>('claude');
  // A configured project outranks the bare external volume: first run used to
  // land on a disk root with "Start session" pointed at it.
  const defaultProject = () => recent?.[0]?.path ?? config.projects[0] ?? config.primaryVolume ?? '';
  const [cwd, setCwd] = useState(defaultProject());
  const [model, setModel] = useState(config.claude.defaultModel);
  const [resumable, setResumable] = useState<Resumable[]>([]);
  const [resume, setResume] = useState<Resumable | null>(null);
  const [showAllResumable, setShowAllResumable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<RecentProject | null>(null);
  const [notifications, setNotifications] = useState(config.notifications);
  const [gitSummaries, setGitSummaries] = useState<Record<string, GitSummary>>({});
  const [gitSheetFor, setGitSheetFor] = useState<string | null>(null);

  const agentConfig = config[agent];

  useEffect(() => {
    api.sessions().then((r) => setSessions(r.sessions)).catch(() => {});
    api.gitSummaries().then((r) => setGitSummaries(r.summaries)).catch(() => {});
    api
      .recent()
      .then((r) => {
        setRecent(r.projects);
        if (r.projects[0]) setCwd(r.projects[0].path);
      })
      .catch(() => setRecent([]));
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

  async function openRecent(project: RecentProject) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.createSession({
        agent: project.lastAgent,
        cwd: project.path,
        resume: project.lastResumeId,
        title: project.lastTitle,
      });
      onOpen(r.session.id);
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.createSession({
        agent,
        cwd,
        model: resume ? undefined : model || undefined,
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
  // A project already showing under "Active now" would otherwise appear twice — once as a
  // live, instantly-ready row and once as history — which is exactly what reads as confusing.
  const activeCwds = new Set(sessions.map((s) => s.cwd));
  const visibleRecent = (recent ?? []).filter((p) => !activeCwds.has(p.path));

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-header-row">
          <div className="page-header-brand">
            <img className="brand-icon" src="/icon-192.png" alt="" />
            <div>
              <h1>Pocket</h1>
              <span className="subtitle">your laptop, in your pocket</span>
            </div>
          </div>
          <button className="ghost" onClick={() => setShowSettings(true)}>
            ⚙
          </button>
        </div>
      </header>

      <UsagePanel />
      <DecisionsPanel />

      {sessions.length > 0 && (
        <section className="card">
          <h2>Active now</h2>
          <p className="section-hint">
            Live and instantly ready. Closes automatically after {config.sessionIdleTimeoutHours}h with no activity, or tap ✕.
          </p>
          {sessions.map((s) => (
            <div key={s.id} className="session-row">
              <button className="session-open" onClick={() => onOpen(s.id)}>
                <span className={`agent-dot ${s.agent}`} />
                <span className="session-title">{s.title}</span>
                <span className="session-sub">
                  {s.agent} · {shortPath(s.cwd)} · {fmtAgo(s.updatedAt)}
                </span>
              </button>
              <ChangesBadge summary={gitSummaries[s.cwd]} onOpen={() => setGitSheetFor(s.cwd)} />
              {s.state === 'working' ? (
                <span className="live-badge working">● Working</span>
              ) : s.state === 'error' ? (
                <span className="live-badge error">● Error</span>
              ) : s.state === 'connecting' ? (
                <span className="live-badge">● Connecting</span>
              ) : (
                <span className="live-badge">● Live</span>
              )}
              <button className="ghost" onClick={() => close(s.id)}>
                ✕
              </button>
            </div>
          ))}
        </section>
      )}

      {visibleRecent.length > 0 && (
        <section className="card">
          <h2>Recent</h2>
          <p className="section-hint">History from past sessions. Tap one to see a free recap before reopening it.</p>
          <div className="recent-list">
            {visibleRecent.map((p) => (
              <div key={p.path} className="recent-row">
                <button className="recent-main" disabled={busy} onClick={() => setPreviewing(p)}>
                  <span className={`agent-dot ${p.lastAgent}`} />
                  <span className="recent-info">
                    <span className="recent-project">{shortPath(p.path)}</span>
                    <span className="recent-title">
                      {p.lastAgent} · {p.lastTitle}
                    </span>
                  </span>
                  <span className="recent-time">{fmtAgo(p.lastActivity)}</span>
                </button>
                <ChangesBadge summary={gitSummaries[p.path]} onOpen={() => setGitSheetFor(p.path)} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <button className="new-session-toggle" onClick={() => setShowNewSession((v) => !v)}>
          <h2>Start something new</h2>
          <span className="ghost">{showNewSession ? '︿' : '﹀'}</span>
        </button>
        {showNewSession && (
          <>
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
                      {shortPath(p)}
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
                <button className={model === 'auto' ? 'chip active' : 'chip'} onClick={() => setModel('auto')}>
                  ⚡ Auto
                </button>
                {agentConfig.models.map((m) => (
                  <button key={m.id} className={model === m.id ? 'chip active' : 'chip'} onClick={() => setModel(m.id)}>
                    {m.label}
                  </button>
                ))}
                {!agentConfig.models.some((m) => m.id === 'default') && (
                  <button className={model === '' ? 'chip active' : 'chip'} onClick={() => setModel('')}>
                    default
                  </button>
                )}
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
          </>
        )}
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

      {showSettings && (
        <GlobalSettings
          theme={theme}
          onThemeChange={onThemeChange}
          projects={projects}
          onProjectsChange={setProjects}
          notifications={notifications}
          onNotificationsChange={setNotifications}
          onClose={() => setShowSettings(false)}
        />
      )}

      {gitSheetFor && <GitSheet cwd={gitSheetFor} onClose={() => setGitSheetFor(null)} />}

      {previewing && (
        <PreviewSheet
          agent={previewing.lastAgent}
          cwd={previewing.path}
          id={previewing.lastResumeId}
          title={shortPath(previewing.path)}
          busy={busy}
          onClose={() => setPreviewing(null)}
          onResume={() => openRecent(previewing)}
        />
      )}
    </div>
  );
}
