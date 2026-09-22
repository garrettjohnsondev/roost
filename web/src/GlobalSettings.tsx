import { useEffect, useState } from 'react';
import { CrewEditor } from './CrewEditor';
import { api } from './api';
import type { Theme } from './theme';
import type { NotificationConfig, ModelsResponse } from './types';

function randomTopic(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return 'pocket-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function NotificationSettings(props: {
  notifications: NotificationConfig;
  onChange: (n: NotificationConfig) => void;
}) {
  const { notifications, onChange } = props;
  const [busy, setBusy] = useState(false);
  const [testState, setTestState] = useState<string | null>(null);
  const enabled = Boolean(notifications.topic);

  async function toggle() {
    setBusy(true);
    try {
      const topic = enabled ? '' : randomTopic();
      const r = await api.setNotifications({ topic });
      onChange(r.notifications);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setTestState('sending…');
    try {
      await api.testNotification();
      setTestState('sent — check your phone');
    } catch (e: any) {
      setTestState(String(e.message ?? e));
    }
  }

  return (
    <div className="field">
      <label>Notifications</label>
      <div className="segmented">
        <button className={!enabled ? 'seg active' : 'seg'} disabled={busy} onClick={() => enabled && toggle()}>
          Off
        </button>
        <button className={enabled ? 'seg active' : 'seg'} disabled={busy} onClick={() => !enabled && toggle()}>
          On
        </button>
      </div>
      {enabled && (
        <div className="notify-setup">
          <p className="section-hint notify-hint">
            Get notified when an agent needs approval or finishes while you're away. Install the free{' '}
            <a href="https://ntfy.sh/" target="_blank" rel="noreferrer">
              ntfy
            </a>{' '}
            app and subscribe to this topic:
          </p>
          <div className="mono-note notify-topic">{notifications.topic}</div>
          <button className="chip" onClick={test}>
            Send test notification
          </button>
          {testState && <div className="section-hint notify-hint">{testState}</div>}
        </div>
      )}
    </div>
  );
}

export function GlobalSettings(props: {
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  projects: string[];
  onProjectsChange: (projects: string[]) => void;
  notifications: NotificationConfig;
  onNotificationsChange: (n: NotificationConfig) => void;
  onClose: () => void;
}) {
  const { theme, onThemeChange, projects, onProjectsChange, notifications, onNotificationsChange, onClose } = props;
  const [busy, setBusy] = useState<string | null>(null);

  async function remove(path: string) {
    setBusy(path);
    try {
      const r = await api.removeProject(path);
      onProjectsChange(r.projects);
    } finally {
      setBusy(null);
    }
  }

  const [crewOpen, setCrewOpen] = useState(false);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [modelsBusy, setModelsBusy] = useState<string | null>(null);
  useEffect(() => {
    api.models().then(setModels).catch(() => setModels(null));
  }, []);
  const assign = async (agent: string, tier: string, model: string) => {
    setModelsBusy(`${agent}:${tier}:${model}`);
    try {
      await api.assignModel(agent, tier, model);
      setModels(await api.models());
    } finally {
      setModelsBusy(null);
    }
  };
  const refreshRoster = async () => {
    setModelsBusy('refresh');
    try {
      await api.refreshModels();
      setModels(await api.models());
    } finally {
      setModelsBusy(null);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Settings</h3>

        <div className="field">
          <label>Appearance</label>
          <div className="segmented">
            <button className={theme === 'light' ? 'seg active' : 'seg'} onClick={() => onThemeChange('light')}>
              Light
            </button>
            <button className={theme === 'dark' ? 'seg active' : 'seg'} onClick={() => onThemeChange('dark')}>
              Dark
            </button>
          </div>
        </div>

        <NotificationSettings notifications={notifications} onChange={onNotificationsChange} />

        <div className="field">
          <label>Models</label>
          {!models ? (
            <p className="section-hint">Roster not loaded.</p>
          ) : (
            <div className="models-card">
              {models.issues.length > 0 && (
                <div className="models-issues">
                  {models.issues.map((i) => (
                    <div key={`${i.agent}:${i.tier}`} className="models-issue">
                      <span>
                        <strong>{i.agent} {i.tier}</strong> → {i.model}: {i.problem}
                      </span>
                      {i.suggestion && (
                        <button className="chip" disabled={!!modelsBusy} onClick={() => assign(i.agent, i.tier, i.suggestion!)}>
                          Use {i.suggestion}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {models.models.filter((m) => !m.hidden && !m.supersededBy && m.suggested.tier === null).map((m) => (
                <div key={`${m.agent}:${m.id}`} className="models-new">
                  <span>
                    <strong>New {m.agent} model:</strong> {m.displayName} — {m.description || m.id}. Not routed until you place it:
                  </span>
                  <span className="chips">
                    {(['light', 'standard', 'heavy'] as const).map((t) => (
                      <button key={t} className="chip" disabled={!!modelsBusy} onClick={() => assign(m.agent, t, m.id)}>
                        {t}
                      </button>
                    ))}
                  </span>
                </div>
              ))}
              {(['claude', 'codex'] as const).map((a) => {
                const rows = models.models.filter((m) => m.agent === a && !m.hidden);
                if (!rows.length) return null;
                return (
                  <div key={a} className="models-roster">
                    <strong>{a}:</strong>{' '}
                    {rows.map((m) => `${m.displayName}${m.isVendorDefault ? ' ★' : ''}${m.supersededBy ? ' (superseded)' : ''}`).join(' · ')}
                  </div>
                );
              })}
              <div className="models-foot">
                <span className="section-hint">
                  {models.fetchedAt ? `Roster fetched ${new Date(models.fetchedAt).toLocaleString()}` : 'Roster never fetched'} · {models.capabilities.reviewLabel}
                </span>
                <button className="ghost" disabled={!!modelsBusy} onClick={refreshRoster}>
                  {modelsBusy === 'refresh' ? 'Refreshing…' : 'Refresh roster'}
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="field">
          <label>Crew</label>
          {crewOpen ? (
            <CrewEditor onClose={() => setCrewOpen(false)} />
          ) : (
            <>
              <button className="ghost" onClick={() => setCrewOpen(true)}>Customize crew</button>
              <p className="section-hint">Name each agent, pick a face and a colour. Identity follows the
                model, so a crew member keeps their face when a new version ships.</p>
            </>
          )}
        </div>

        <div className="field">
          <label>Projects</label>
          <div className="resume-list">
            {projects.map((p) => (
              <div key={p} className="settings-project-row">
                <span className="mono-note settings-project-path">{p}</span>
                <button className="ghost" disabled={busy === p} onClick={() => remove(p)}>
                  {busy === p ? '…' : '✕'}
                </button>
              </div>
            ))}
            {projects.length === 0 && <div className="usage-empty">No projects added yet.</div>}
          </div>
        </div>

        <button className="primary" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
