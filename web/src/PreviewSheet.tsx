import { useEffect, useState } from 'react';
import { api } from './api';
import { PreviewContent } from './PreviewContent';
import type { AgentKind, PreviewResult } from './types';

export function PreviewSheet(props: {
  agent: AgentKind;
  cwd: string;
  id: string;
  title: string;
  busy: boolean;
  onResume: () => void;
  onClose: () => void;
}) {
  const { agent, cwd, id, title, busy, onResume, onClose } = props;
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .preview(agent, cwd, id)
      .then((r) => {
        if (!cancelled) setPreview(r.preview);
      })
      .catch(() => {
        if (!cancelled) setPreview({ messages: [], files: [] });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agent, cwd, id]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="mono-note browse-path">{cwd}</div>
        <div className="preview-scroll">
          <PreviewContent preview={preview} loading={loading} />
        </div>
        <div className="sheet-actions">
          <button className="danger" onClick={onClose}>
            Close
          </button>
          <button className="primary" disabled={busy} onClick={onResume}>
            {busy ? 'Opening…' : 'Resume'}
          </button>
        </div>
      </div>
    </div>
  );
}
