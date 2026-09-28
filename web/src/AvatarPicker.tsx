import { avatarUrl } from './ChatView';
import { useEffect, useState } from 'react';
import { api } from './api';

export interface PoolAvatar {
  slug: string;
  label: string;
  file: string;
  color: string;
  colorName: string;
}

interface Pool {
  avatars: PoolAvatar[];
  palette: Array<{ name: string; hex: string }>;
}

/** Picking from the pool is free and instant -- those images ship with the
 *  app. Generating a custom one spends the viewer's own Codex window, so it is
 *  a deliberate, separate action with the cost stated up front. */
export function AvatarPicker({
  value, color, onPick,
}: {
  value?: string;
  color: string;
  onPick: (avatar: string | undefined, color: string) => void;
}) {
  const [pool, setPool] = useState<Pool | null>(null);
  const [custom, setCustom] = useState<Array<{ file: string; url: string }>>([]);
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/avatars/pool.json')
      .then((r) => (r.ok ? r.json() : null))
      .then(setPool)
      .catch(() => setPool(null));
    api.avatars().then((r) => setCustom(r.custom ?? [])).catch(() => {});
  }, []);

  // Generation takes about a minute; a button that only says "Generating…" for
  // that long reads as hung. The seconds tick so it visibly is not.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const generate = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.generateAvatar(subject, color);
      setCustom((c) => [{ file: r.file, url: r.url }, ...c]);
      onPick(r.file, color);
      setSubject('');
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const palette = pool?.palette ?? [];

  return (
    <div className="avatar-picker">
      <div className="avatar-grid">
        <button
          className={`avatar-opt ${!value ? 'sel' : ''}`}
          style={{ background: color }}
          title="No image — use the monogram"
          onClick={() => onPick(undefined, color)}
        />
        {(pool?.avatars ?? []).map((a) => (
          <button
            key={a.slug}
            className={`avatar-opt ${value === a.file ? 'sel' : ''}`}
            title={a.label}
            onClick={() => onPick(a.file, a.color)}
          >
            <img src={avatarUrl(a.file) ?? a.file} alt={a.label} loading="lazy" />
          </button>
        ))}
        {custom.map((c) => (
          <button
            key={c.file}
            className={`avatar-opt ${value === c.file ? 'sel' : ''}`}
            title="Your custom avatar"
            onClick={() => onPick(c.file, color)}
          >
            <img src={c.url} alt="" loading="lazy" />
          </button>
        ))}
      </div>

      {palette.length > 0 && (
        <div className="avatar-swatches">
          {palette.map((p) => (
            <button
              key={p.hex}
              className={`avatar-swatch ${color.toLowerCase() === p.hex.toLowerCase() ? 'sel' : ''}`}
              style={{ background: p.hex }}
              title={p.name}
              onClick={() => onPick(value, p.hex)}
            />
          ))}
        </div>
      )}

      <div className="avatar-gen">
        <input
          value={subject}
          placeholder="or describe one — e.g. a brass telescope"
          maxLength={120}
          onChange={(e) => setSubject(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && subject.trim().length > 1 && !busy) void generate(); }}
        />
        <button disabled={busy || subject.trim().length < 2} onClick={() => void generate()}>
          {busy ? 'Drawing…' : 'Generate'}
        </button>
      </div>
      {busy ? (
        <div className="avatar-note avatar-progress">
          Codex is drawing it — {elapsed}s. Usually under a minute; the picture appears above when it lands.
        </div>
      ) : (
        <div className="avatar-note">
          Drawn by your own Codex subscription in about a minute. Measured cost is small — about a
          dozen images moved a weekly window by one point — so there is no need to ration it.
          Picking from the pool above is instant.
        </div>
      )}
      {err && <div className="avatar-note" style={{ color: 'var(--err, #f87171)' }}>{err}</div>}
    </div>
  );
}
