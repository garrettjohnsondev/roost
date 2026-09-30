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

/** Reload only when you aren't looking (2026-09-30: after a deploy the chat
 *  blanked for two seconds right after the confetti). In the background, or
 *  on the home screen with nothing typed, it just happens; inside a chat a
 *  small banner offers it and waits for your tap. */
function applyWhenUnseen() {
  if (!pending) return;
  if (document.visibilityState === 'hidden') { location.reload(); return; }
  const inChat = !!document.querySelector('.chat-page');
  if (!inChat && quiet()) { location.reload(); return; }
  if (inChat) showBanner();
}

function showBanner() {
  if (document.getElementById('fresh-banner')) return;
  const b = document.createElement('button');
  b.id = 'fresh-banner';
  b.className = 'fresh-banner';
  b.type = 'button';
  b.textContent = 'New version ready — tap to refresh';
  b.onclick = () => location.reload();
  document.body.appendChild(b);
}

async function check() {
  const mine = currentScript();
  if (!mine) return; // dev server: no hashed bundle
  try {
    const r = await fetch('/', { cache: 'no-store' });
    if (!r.ok) return;
    const theirs = servedScript(await r.text());
    if (theirs && theirs !== mine) pending = true;
  } catch { /* server restarting; next tick */ }
  applyWhenUnseen();
}

export function watchForNewVersion() {
  setInterval(() => void check(), 30_000);
  document.addEventListener('visibilitychange', () => {
    // Leaving the app is the best moment; coming back re-checks.
    if (document.visibilityState === 'hidden') applyWhenUnseen();
    else void check();
  });
  // Going home from a chat (or finishing typing there) is the next best.
  setInterval(applyWhenUnseen, 3_000);
}
