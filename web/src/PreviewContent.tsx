import type { PreviewFile, PreviewResult } from './types';

function FileRow({ file }: { file: PreviewFile }) {
  const name = file.path.split('/').pop() ?? file.path;
  const dir = file.path.slice(0, file.path.length - name.length);
  return (
    <div className="preview-file">
      <div className="preview-file-head">
        <span className={`preview-file-action ${file.action}`}>{file.action}</span>
        <span className="preview-file-path">
          <span className="preview-file-dir">{dir}</span>
          {name}
        </span>
      </div>
      {(file.before || file.after) && (
        <div className="preview-diff">
          {file.before && <div className="preview-diff-line remove">− {file.before}</div>}
          {file.after && <div className="preview-diff-line add">+ {file.after}</div>}
          {file.extra ? <div className="preview-diff-extra">+{file.extra} more edit{file.extra > 1 ? 's' : ''}</div> : null}
        </div>
      )}
    </div>
  );
}

export function PreviewContent({ preview, loading }: { preview: PreviewResult | null; loading: boolean }) {
  if (loading) return <div className="usage-empty">Loading recap…</div>;
  if (!preview || (preview.messages.length === 0 && preview.files.length === 0)) {
    return <div className="usage-empty">No history found for this session.</div>;
  }
  return (
    <div className="preview-content">
      {preview.messages.length > 0 && (
        <div className="preview-messages">
          {preview.messages.map((m, i) => (
            <div key={i} className={`preview-msg ${m.role}`}>
              <span className="preview-msg-role">{m.role === 'user' ? 'You' : 'Agent'}</span>
              <span className="preview-msg-text">{m.text}</span>
            </div>
          ))}
        </div>
      )}
      {preview.files.length > 0 && (
        <div className="preview-files">
          {preview.files.map((f, i) => (
            <FileRow key={i} file={f} />
          ))}
        </div>
      )}
    </div>
  );
}
