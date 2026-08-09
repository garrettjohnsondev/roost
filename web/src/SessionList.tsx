import { useEffect, useState } from 'react';
import { api } from './api';
import type { AgentKind, PocketConfigResponse, SessionMeta } from './types';

export function SessionList(props: { config: PocketConfigResponse; onOpen: (id: string) => void }) {
  const { config, onOpen } = props;
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [agent, setAgent] = useState<AgentKind>('claude');
  const [cwd, setCwd] = useState(config.projects[0] ?? '');
  const [model, setModel] = useState(config.claude.defaultModel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agentConfig = config[agent];

  useEffect(() => {
    api.sessions().then((r) => setSessions(r.sessions)).catch(() => {});
  }, []);

  useEffect(() => {
    setModel(config[agent].defaultModel);
  }, [agent, config]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.createSession({ agent, cwd, model: model || undefined });
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
          <select value={cwd} onChange={(e) => setCwd(e.target.value)}>
            {config.projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Model</label>
          <div className="chips">
            {agentConfig.models.map((m) => (
              <button key={m} className={model === m ? 'chip active' : 'chip'} onClick={() => setModel(m)}>
                {m}
              </button>
            ))}
            <button className={model === '' ? 'chip active' : 'chip'} onClick={() => setModel('')}>
              default
            </button>
          </div>
        </div>
        {error && <div className="error-note">{error}</div>}
        <button className="primary" disabled={busy || !cwd} onClick={create}>
          {busy ? 'Starting…' : 'Start session'}
        </button>
      </section>

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
