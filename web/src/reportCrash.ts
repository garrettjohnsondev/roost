/** Tell the Mac when the app on the phone breaks.
 *
 *  2026-09-24: every session crashed on open for a whole day, and the server log
 *  said nothing — the crash happened in the browser, so the Mac never heard of
 *  it. A crash now reaches the server log too. Best-effort and throttled: a
 *  report that cannot be sent is dropped, never retried into a loop. */
let sent = 0;
export function reportCrash(kind: string, error: unknown, extra?: string): void {
  if (sent >= 5) return; // one bad render can fire many times; a handful is enough
  sent++;
  const e = error as { message?: string; stack?: string } | undefined;
  const body = JSON.stringify({
    kind,
    message: String(e?.message ?? error ?? 'unknown').slice(0, 500),
    stack: String(e?.stack ?? '').slice(0, 1500),
    extra: extra?.slice(0, 1500),
    url: location.pathname + location.search,
  });
  try {
    fetch('/api/client-error', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch {
    /* reporting must never throw */
  }
}
