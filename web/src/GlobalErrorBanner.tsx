import { useEffect, useState } from 'react';

interface Caught {
  id: number;
  message: string;
}

let nextId = 1;

/** Catches errors an ErrorBoundary can't see — thrown inside event handlers or rejected
 *  promises — and surfaces them as a dismissible banner instead of failing silently. */
export function GlobalErrorBanner() {
  const [errors, setErrors] = useState<Caught[]>([]);

  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      setErrors((prev) => [...prev, { id: nextId++, message: e.message }].slice(-3));
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const message = e.reason instanceof Error ? e.reason.message : String(e.reason);
      setErrors((prev) => [...prev, { id: nextId++, message }].slice(-3));
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  if (errors.length === 0) return null;

  return (
    <div className="error-banner-stack">
      {errors.map((err) => (
        <div key={err.id} className="error-banner">
          <span className="error-banner-text">{err.message}</span>
          <button className="error-banner-dismiss" onClick={() => setErrors((prev) => prev.filter((e) => e.id !== err.id))}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
