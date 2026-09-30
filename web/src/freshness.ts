// A new version reaches the phone on its own (2026-09-29). After a deploy the
// phone reconnected but kept running the old app code until it was swiped
// closed -- so fixes "didn't work". Every so often, and whenever the app comes
// back to the foreground, compare the app's own script with the one the server
// now serves; when they differ, reload -- but only at a quiet moment: nothing
// typed in a box, nothing streaming. The URL keeps the open chat.

function currentScript(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  return s ? new URL(s.src, location.href).pathname : null;
}

export function servedScript(html: string): string | null {
  const m = /<script[^>]+type="module"[^>]+src="([^"]*\/assets\/[^"]+)"/.exec(html) ?? /<script[^>]+src="([^"]*\/assets\/[^"]+)"[^>]*type="module"/.exec(html);
  return m ? new URL(m[1], location.href).pathname : null;
}

function quiet(): boolean {
  const busy = document.querySelector('.working-indicator, .typing-dots');
  const typed = Array.from(document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('textarea, input[type="text"]')).some((f) => f.value.trim() !== '');
  const focused = document.activeElement && /^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName);
  return !busy && !typed && !focused;
}

let pending = false;
async function check() {
  const mine = currentScript();
  if (!mine) return; // dev server: no hashed bundle
  try {
    const r = await fetch('/', { cache: 'no-store' });
    if (!r.ok) return;
    const theirs = servedScript(await r.text());
    if (theirs && theirs !== mine) pending = true;
  } catch { /* server restarting; next tick */ }
  if (pending && quiet()) location.reload();
}

export function watchForNewVersion() {
  setInterval(() => void check(), 30_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void check(); });
  // Once a new version is known, take the first quiet moment rather than the next tick.
  setInterval(() => { if (pending && quiet()) location.reload(); }, 3_000);
}
