import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { LiveInfo } from './types';

/** "See the project you are building, from the phone" (docs/PREVIEW.md,
 *  roadmap 28). Fetches status on open, offers Start when the project has a
 *  `## preview` section and nothing is running, and shows the running app in
 *  a frame once it is -- same-origin, through the server's own `/live/`
 *  proxy, so nothing new has to be open on the tailnet.
 *
 *  Named `Live`, not `Preview` -- that word already means the read-only
 *  recap of a past session (PreviewSheet.tsx). */
export function LiveView({ cwd, onClose, onAsk, crewName }: { cwd: string; onClose: () => void; onAsk?: (prompt: string) => void; crewName?: string }) {
  const [info, setInfo] = useState<LiveInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [wide, setWide] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    api
      .liveStatus(cwd)
      .then((r) => !cancelled.current && setInfo(r))
      .catch(() => !cancelled.current && setInfo({ configured: false, state: 'stopped' }));
    return () => {
      cancelled.current = true;
    };
  }, [cwd]);

  async function start() {
    setBusy(true);
    try {
      setInfo(await api.liveStart(cwd));
    } catch (e: any) {
      setInfo({ configured: true, state: 'error', error: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      await api.liveStop(cwd);
      setInfo({ configured: true, state: 'stopped' });
    } finally {
      setBusy(false);
    }
  }

  const running = info?.state === 'running' && !!info.url;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className={`sheet live-sheet${running ? ' running' : ''}`} onClick={(e) => e.stopPropagation()}>
        <h3>Live preview</h3>

        {info === null && <div className="usage-empty">Checking…</div>}

        {info && !info.configured && (
          <>
            {/* 2026-09-27 audit: this was developer instructions ("add a ## preview
                section…"). The crew can work it out, the way Deploy does. */}
            <p className="live-empty">This project can't be previewed yet.</p>
            <p className="section-hint">Someone has to work out how it runs first — it's a quick job for the crew.</p>
            {onAsk && (
              <button
                className="primary"
                onClick={() => {
                  onAsk('Set up Live preview for this project: work out how it runs locally, then add a `## preview` section to .roost/project.md with the command (use {port} for the port), or `static: <dir>` for a built site. Check it starts, then tell me in one line.');
                  onClose();
                }}
              >
                Ask {crewName ?? 'the crew'} to set it up
              </button>
            )}
            <details className="section-hint">
              <summary>Or set it up yourself</summary>
              Add a <code>## preview</code> section to the project file with a command like{' '}
              <code>npm run dev -- --port {'{port}'} --host 127.0.0.1</code>, or <code>static: dist</code> for a built site.
            </details>
          </>
        )}

        {info?.configured && (info.state === 'stopped' || info.state === undefined) && (
          <button className="primary" onClick={start} disabled={busy}>
            {busy ? 'Starting…' : 'Start'}
          </button>
        )}

        {info?.state === 'starting' && <div className="usage-empty">Starting…</div>}

        {info?.state === 'error' && (
          <>
            <div className="error-note">{info.error ?? 'The preview could not start.'}</div>
            {info.output && info.output.length > 0 && <pre className="live-output">{info.output.join('\n')}</pre>}
            <button className="chip" onClick={start} disabled={busy}>
              Try again
            </button>
          </>
        )}

        {running && (
          <>
            <div className="live-toolbar">
              <button className="chip" onClick={() => setWide((w) => !w)}>
                {wide ? 'Phone width' : 'Desktop width'}
              </button>
              <button className="chip" onClick={() => setReloadKey((k) => k + 1)}>
                Reload
              </button>
              <a className="chip" href={info!.url} target="_blank" rel="noreferrer">
                Open in a tab
              </a>
              <button className="link live-stop" onClick={stop} disabled={busy}>
                Stop
              </button>
            </div>
            <div className={`live-frame-wrap${wide ? ' wide' : ''}`}>
              <iframe key={reloadKey} className="live-frame" src={info!.url} title="Live preview" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
