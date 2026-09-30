import { useEffect, useRef, useState } from 'react';
import { api } from './api';

/** "Want a buzz on your phone?" (2026-09-30). Phone notifications (ntfy) were
 *  hidden in Settings and the owner never knew they existed -- and iPhone web
 *  apps cannot vibrate on their own, so without them nothing ever buzzes.
 *  Asked at the moment the value is obvious: right after a job finishes.
 *  First finished job, once more five jobs later, then never. */
const DONE = 'roost:jobsDone';
const SKIPS = 'roost:notifyNudgeSkips';
const num = (k: string) => { try { return Number(localStorage.getItem(k) ?? 0) || 0; } catch { return 0; } };
const put = (k: string, v: number) => { try { localStorage.setItem(k, String(v)); } catch { /* private mode */ } };

/** Pure: should the card show, given finished jobs and "Not now" taps? */
export function nudgeDue(jobsDone: number, skips: number): boolean {
  if (skips === 0) return jobsDone >= 1;
  if (skips === 1) return jobsDone >= 6;
  return false;
}

export function randomTopic(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return 'roost-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isAndroid = () => /android/i.test(navigator.userAgent);

/** Counts live working->idle moments; shows the card when due and notifications are off. */
export function NotifyNudge({ status, enabledAtStart }: { status: string; enabledAtStart: boolean }) {
  const prev = useRef(status);
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const was = prev.current;
    prev.current = status;
    if (was !== 'working' || status !== 'idle') return;
    const done = num(DONE) + 1;
    put(DONE, done);
    if (enabledAtStart || !nudgeDue(done, num(SKIPS))) return;
    // Settings may have turned them on since this chat opened.
    api.config().then((c) => { if (!c.notifications?.topic) setShow(true); }).catch(() => {});
  }, [status]);
  if (!show) return null;
  const skip = () => {
    const s = num(SKIPS) + 1;
    put(SKIPS, s);
    // The second ask comes five jobs after this one.
    if (s === 1) put(DONE, 1);
    setShow(false);
  };
  return (
    <>
      <div className="notify-nudge">
        <img src="/crew/pip-cheer.webp" alt="" />
        <div>
          <b>Want a buzz on your phone next time?</b>
          <span>When the crew finishes or needs you, even with Roost closed. Takes 2 minutes.</span>
          <div className="notify-nudge-actions">
            <button className="primary" onClick={() => setOpen(true)}>Set it up</button>
            <button className="link" onClick={skip}>Not now</button>
          </div>
        </div>
      </div>
      {open && <NotifySetup onClose={() => setOpen(false)} onDone={() => { put(SKIPS, 2); setOpen(false); setShow(false); }} />}
    </>
  );
}

export function NotifySetup({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [topic, setTopic] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [test, setTest] = useState<'idle' | 'sending' | 'sent' | string>('idle');
  useEffect(() => {
    // Turned on the moment the sheet opens; the topic is theirs to copy.
    api.config().then(async (c) => {
      const have = c.notifications?.topic;
      if (have) return setTopic(have);
      const r = await api.setNotifications({ topic: randomTopic() });
      setTopic(r.notifications.topic);
    }).catch((e) => setTest(String(e?.message ?? e)));
  }, []);
  const store = isAndroid()
    ? 'https://play.google.com/store/apps/details?id=io.heckel.ntfy'
    : 'https://apps.apple.com/app/ntfy/id1625396347';
  const copy = async () => {
    if (!topic) return;
    try { await navigator.clipboard.writeText(topic); setCopied(true); } catch { /* shown on screen anyway */ }
  };
  const send = async () => {
    setTest('sending');
    try { await api.testNotification(); setTest('sent'); } catch (e: any) { setTest(String(e?.message ?? e)); }
  };
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet notify-setup-sheet" onClick={(e) => e.stopPropagation()}>
        <h2>A buzz when the crew needs you</h2>
        <ol className="notify-steps">
          <li>
            <span>Get the free <b>ntfy</b> app{isIOS() || isAndroid() ? '' : ' on your phone'}.</span>
            <a className="chip" href={store} target="_blank" rel="noreferrer">{isAndroid() ? 'Google Play' : 'App Store'}</a>
          </li>
          <li>
            <span>In ntfy, tap <b>+</b> and paste this topic:</span>
            <div className="notify-topic-row">
              <code className="mono-note">{topic ?? '…'}</code>
              <button className="chip" disabled={!topic} onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
            </div>
          </li>
          <li>
            <span>Allow notifications, then test it:</span>
            <button className="chip" disabled={!topic || test === 'sending'} onClick={send}>
              {test === 'sent' ? 'Sent ✓ — did it buzz?' : test === 'sending' ? 'Sending…' : 'Send test'}
            </button>
          </li>
        </ol>
        {test !== 'idle' && test !== 'sending' && test !== 'sent' && <div className="error-note">{test}</div>}
        <p className="section-hint">Keep the topic to yourself: it works like a password. Notifications show a chat's title, never what was said. Turn them off any time in Settings.</p>
        <button className="primary" onClick={onDone}>{test === 'sent' ? 'It buzzed — done' : 'Done'}</button>
      </div>
    </div>
  );
}
