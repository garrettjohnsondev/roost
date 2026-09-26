import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { GlobalErrorBanner } from './GlobalErrorBanner';
import './fonts.css';
import './styles.css';

// iOS Safari scrolls the whole page to keep a focused field above the
// keyboard, and does not always scroll it back when the keyboard closes -- so
// tapping + to attach a picture (which closes the keyboard) left the chat's
// message box stranded halfway up the screen (2026-09-25). The chat is a fixed
// full-height layout that never scrolls the page itself: when a field loses
// focus there, or the visible area grows back, put the page back at the top.
function settleChat() {
  if (!document.querySelector('.chat-page')) return;
  if (window.scrollY !== 0) window.scrollTo(0, 0);
  // body is pinned (styles.css) so it can no longer scroll at all -- #root
  // carries the session list's scrolling instead, and is the one that could
  // still get panned on .chat-page too (2026-09-26).
  const root = document.getElementById('root');
  if (root && root.scrollTop !== 0) root.scrollTop = 0;
}
document.addEventListener('focusout', () => requestAnimationFrame(settleChat));
window.visualViewport?.addEventListener('resize', () => requestAnimationFrame(settleChat));
// 2026-09-26: once the chat column itself shrinks for the keyboard (below),
// iOS's OWN "scroll the focused field into view" still fires on focus too --
// double correction, since the column already put the composer above the
// keyboard. That second scroll shoved the whole page up past the top,
// leaving blank background under a composer stranded at the very top of the
// screen ("shot up all the way"). Settle on focus-IN too, not just focus-out,
// and again a beat later -- iOS's own scroll can land after the first frame.
document.addEventListener('focusin', () => {
  requestAnimationFrame(settleChat);
  setTimeout(settleChat, 100);
});

// 100dvh is the LAYOUT viewport, not what's actually visible -- opening the
// keyboard here (a home-screen web app) shrinks the VISUAL viewport only, so
// the chat column never shrank and the composer sat below the fold, under
// the keyboard, until some unrelated reflow (typing a letter grows the
// textarea) happened to drag it back into view (2026-09-26: "sometimes...
// intermittent"). Tracked directly and applied as a var the layout can size
// against, so the composer is above the keyboard from the first tap, not by
// luck.
function setVisibleHeight() {
  const h = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty('--vvh', `${h}px`);
}
setVisibleHeight();
window.visualViewport?.addEventListener('resize', () => requestAnimationFrame(setVisibleHeight));
window.addEventListener('resize', () => requestAnimationFrame(setVisibleHeight));

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <GlobalErrorBanner />
    <App />
  </ErrorBoundary>,
);
