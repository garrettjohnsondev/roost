import { useState } from 'react';
import { api } from './api';
import type { Theme } from './theme';
import type { NotificationConfig } from './types';

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
