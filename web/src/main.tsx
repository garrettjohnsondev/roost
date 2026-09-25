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
  if (document.querySelector('.chat-page') && window.scrollY !== 0) window.scrollTo(0, 0);
}
document.addEventListener('focusout', () => requestAnimationFrame(settleChat));
window.visualViewport?.addEventListener('resize', () => requestAnimationFrame(settleChat));

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <GlobalErrorBanner />
    <App />
  </ErrorBoundary>,
);
