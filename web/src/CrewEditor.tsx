import { useEffect, useState } from 'react';
import { api } from './api';
import { AvatarPicker } from './AvatarPicker';
import { avatarUrl } from './ChatView';
import type { Persona } from './types';

/** Edit who the crew are: name, colour, face.
 *
 *  Identity is per (suite, model-match), NOT per session -- so a member keeps
 *  their face when the vendor ships a new version underneath them. Sol stays
 *  Sol from 5.6 to 5.7. */
export function CrewEditor({ onClose }: { onClose: () => void }) {
  const [crew, setCrew] = useState<Persona[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.crew().then((r) => setCrew(r.crew)).catch((e) => setErr(String(e?.message ?? e)));
  }, []);

  const keyOf = (p: Persona) => `${p.suite ?? 'any'}:${p.match}`;

  const patch = (p: Persona, next: Partial<Persona>) => {
    setCrew((c) => (c ?? []).map((x) => (keyOf(x) === keyOf(p) ? { ...x, ...next } : x)));
    setDirty(true);
  };

  const save = async () => {
    if (!crew) return;
    setSaving(true);
    setErr(null);
    try {
      await api.saveCrew(crew);
      setDirty(false);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  if (err && !crew) return <div className="avatar-note">Could not load the crew: {err}</div>;
  if (!crew) return <div className="avatar-note">Loading crew…</div>;

  return (
    <div className="crew-editor">
      {crew.map((p) => {
        const k = keyOf(p);
        const url = avatarUrl(p.avatar);
        return (
          <div key={k} className="crew-row">
            <button
              className="crew-row-face"
              style={{ background: p.color }}
              onClick={() => setOpen(open === k ? null : k)}
              title="Change avatar and colour"
            >
              {url ? <img src={url} alt="" /> : <span>{(p.name[0] ?? 'A').toUpperCase()}</span>}
            </button>
            <div className="crew-row-main">
              <input
                className="crew-row-name"
                value={p.name}
                maxLength={40}
                onChange={(e) => patch(p, { name: e.target.value })}
              />
              <div className="crew-row-sub">
                {p.suite ?? 'any'} · {p.match || 'default'} · {p.tier}
              </div>
            </div>
          </div>
        );
      })}

      {open && (() => {
        const p = crew.find((x) => keyOf(x) === open);
        if (!p) return null;
        return (
          <div className="crew-picker-host">
            <div className="avatar-note">Avatar for <strong>{p.name}</strong></div>
            <AvatarPicker
              value={p.avatar}
              color={p.color}
              onPick={(avatar, color) => patch(p, { avatar, color })}
            />
          </div>
        );
      })()}

      <div className="crew-actions">
        <button disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : dirty ? 'Save crew' : 'Saved'}
        </button>
        <button onClick={onClose}>Close</button>
      </div>
      {err && <div className="avatar-note" style={{ color: 'var(--err, #f87171)' }}>{err}</div>}
    </div>
  );
}
