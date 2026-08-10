import { useState } from 'react';
import { api } from './api';
import type { Theme } from './theme';

export function GlobalSettings(props: {
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  projects: string[];
  onProjectsChange: (projects: string[]) => void;
  onClose: () => void;
}) {
  const { theme, onThemeChange, projects, onProjectsChange, onClose } = props;
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
