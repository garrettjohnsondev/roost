import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { imageUrl } from './imagePaths';

const fileName = (p: string) => p.split('/').pop() ?? p;

/** Pictures an agent mentioned, as thumbnails under what it said. A tap
 *  opens the viewer. A temp file that has since been cleared says so,
 *  instead of a broken-image box. */
export function ImageStrip({ paths }: { paths: string[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [gone, setGone] = useState<string[]>([]);
  if (!paths.length) return null;
  return (
    <>
      <div className="img-strip">
        {paths.map((p) =>
          gone.includes(p) ? (
            <span key={p} className="img-gone" title={p}>
              {fileName(p)} — no longer on the Mac
            </span>
          ) : (
            <button key={p} className="img-thumb" onClick={() => setOpen(p)} title={p} aria-label={`View ${fileName(p)}`}>
              <img src={imageUrl(p)} alt="" loading="lazy" onError={() => setGone((g) => (g.includes(p) ? g : [...g, p]))} />
            </button>
          ),
        )}
      </div>
      {open && <ImageViewer path={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Full screen, on top of everything. Tap the picture to see it at full
 *  size (then drag or scroll to pan), tap again to fit; the phone's own
 *  pinch-zoom also works. Tap outside, ✕, or Escape to close. */
export function ImageViewer({ path, onClose }: { path: string; onClose: () => void }) {
  const [full, setFull] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  useEffect(() => {
    // The <img> cannot read the server's reason for a refusal; ask once.
    if (!error) return;
    fetch(imageUrl(path))
      .then((r) => (r.ok ? null : r.json()))
      .then((d) => d?.error && setError(d.error))
      .catch(() => {});
  }, [error, path]);
  return createPortal(
    <div className="img-viewer" role="dialog" aria-label={fileName(path)} onClick={onClose}>
      <div className="img-viewer-bar" onClick={(e) => e.stopPropagation()}>
        <span className="img-viewer-name">{fileName(path)}</span>
        <button className="img-viewer-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className={`img-viewer-stage${full ? ' full' : ''}`}>
        {error ? (
          <div className="img-viewer-error">{error === 'x' ? 'Could not load this image.' : error}</div>
        ) : (
          <img
            src={imageUrl(path)}
            alt={fileName(path)}
            onClick={(e) => {
              e.stopPropagation();
              setFull((f) => !f);
            }}
            onError={() => setError('x')}
          />
        )}
      </div>
      <div className="img-viewer-path" onClick={(e) => e.stopPropagation()}>{path}</div>
    </div>,
    document.body,
  );
}
