import { useEffect, useState } from 'react';
import { api } from './api';
import { fmtAgo, shortPath } from './format';
import { GitSheet } from './GitSheet';
import { GlobalSettings } from './GlobalSettings';
import { PreviewSheet } from './PreviewSheet';
import { UsagePanel } from './UsagePanel';
import { DecisionsPanel } from './DecisionsPanel';
import { SpriteAvatar, type Pose } from './ChatView';
import { nameColor } from './color';
import type { Theme } from './theme';
import type { AgentKind, CrewInfo, GitSummary, RoostConfigResponse, RecentProject, SessionMeta } from './types';

/** The crew, as the board draws them: faces first, before any number.
 *
 *  Their pose is their real state and nothing else. Working in a live session:
 *  typing. Present in one: awake. Otherwise they are asleep — which is what makes
 *  waking them, when a session opens, mean something. Only the characters with
 *  drawn faces are shown; the rest would be pool avatars standing in for art
 *  that does not exist yet. */
function CrewStrip({ sessions }: { sessions: SessionMeta[] }) {
  const [crew, setCrew] = useState<CrewInfo[]>([]);
  useEffect(() => {
    fetch('/api/crew')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        const seen = new Set<string>();
        const drawn: CrewInfo[] = [];
        for (const p of [...(d.crew ?? []), ...(d.dispatcher ? [d.dispatcher] : [])]) {
          if (!p.sprite || seen.has(p.name)) continue;
          seen.add(p.name);
          drawn.push({ name: p.name, color: p.color, sprite: p.sprite, avatar: p.avatar, agent: p.suite ?? 'claude',
            initial: (p.name[0] ?? 'A').toUpperCase(), role: '', roleLabel: '', tier: p.tier, model: '' });
        }
        setCrew(drawn);
      })
      .catch(() => { /* the strip is a greeting, not a dependency */ });
  }, []);
  if (!crew.length) return null;
  const poseOf = (name: string): Pose => {
    if (sessions.some((s) => s.state === 'working' && s.crew?.name === name)) return 'type';
    if (sessions.some((s) => s.crew?.name === name || s.recentCrew?.some((c) => c.name === name))) return 'idle';
    return 'sleep';
  };
  return (
    <section className="crew-strip" aria-label="The crew">
      <div className="crew-strip-faces">
        {crew.map((c) => {
          const pose = poseOf(c.name);
          return (
            <div key={c.name} className={`crew-strip-member ${pose}`} title={`${c.name} — ${pose === 'sleep' ? 'asleep' : pose === 'type' ? 'working' : 'awake'}`}>
              <SpriteAvatar crew={c} pose={pose} size={58} />
              <span className="crew-strip-name" style={{ color: pose === 'sleep' ? undefined : nameColor(c.color) }}>{c.name}</span>
            </div>
          );
        })}
      </div>
      <div className="crew-strip-label">The crew</div>
    </section>
  );
}

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
  config: RoostConfigResponse;
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
              <h1>Roost</h1>
              <span className="subtitle">your crew, mid-conversation</span>
            </div>
          </div>
          <button className="ghost" onClick={() => setShowSettings(true)}>
            ⚙
          </button>
        </div>
      </header>

      <CrewStrip sessions={sessions} />

      {sessions.length > 0 && (
        <section className="card">
          <h2>Now</h2>
          <p className="section-hint">
            Closes after {config.sessionIdleTimeoutHours}h idle, or tap ✕.
          </p>
          {sessions.map((s) => (
            <div key={s.id} className="session-row">
              <button className="session-open convo" onClick={() => onOpen(s.id)}>
                <span className="convo-top">
                  <span className="convo-project">{projectName(s.cwd)}</span>
                  <span className="convo-time">{fmtAgo(s.updatedAt)}</span>
                </span>
                <span className="session-title">{s.title}</span>
                {s.lastLine && (
                  <span className="convo-line">
                    <strong style={{ color: nameColor(s.lastLine.color) ?? 'var(--accent)' }}>{s.lastLine.speaker ?? 'You'}:</strong> {s.lastLine.text}
                  </span>
                )}
                {s.state === 'working' && s.crew && (
                  <span className="convo-typing">
                    {s.crew.name} is typing<span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>
                  </span>
                )}
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

      <UsagePanel compact />

      {visibleRecent.length > 0 && (
        <section className="card">
          <h2>Earlier</h2>
          <p className="section-hint">History from past sessions. Tap one to see a free recap before reopening it.</p>
          <div className="recent-list">
            {visibleRecent.map((p) => (
              <div key={p.path} className="recent-row">
                <button className="recent-main" disabled={busy} onClick={() => setPreviewing(p)}>
                  <span className={`agent-dot ${p.lastAgent}`} />
                  <span className="recent-info">
                    <span className="recent-title">{p.lastTitle}</span>
                    <span className="recent-project">{projectName(p.path)} · {p.lastAgent}</span>
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
          <h2>Start something</h2>
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

      {/* The harness's own record of what it decided and why. It is the evidence
          Phase 4 needs, not something to greet you with — so it lives at the
          bottom, folded, rather than second on the page. */}
      <details className="card ledger">
        <summary>What the crew decided</summary>
        <DecisionsPanel />
      </details>

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

/** The last path segment — "agent sync", not "/Volumes/PortableSSD/agent sync". */
function projectName(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}
