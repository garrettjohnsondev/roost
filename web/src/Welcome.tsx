import { useEffect, useState } from 'react';
import { PlanSettings } from './GlobalSettings';

/** First run (roadmap #56): meet the crew, say your name, pick your plan,
 *  put Roost on your home screen. Shown once per phone, and only while
 *  there's no name on file -- an existing install never sees it. */
const KEY = 'roost:welcomed';

export function useWelcome(): [boolean, () => void] {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem(KEY) === '1'; } catch { /* private mode */ }
    if (seen || new URLSearchParams(location.search).has('fixture')) return;
    fetch('/api/me').then((r) => (r.ok ? r.json() : null)).then((d) => { if (!d?.me?.name) setShow(true); }).catch(() => {});
  }, []);
  return [show, () => { try { localStorage.setItem(KEY, '1'); } catch { /* */ } setShow(false); }];
}

export function Welcome({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone);
  const saveName = () => {
    if (!name.trim()) return setStep(2);
    fetch('/api/me', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ me: { name: name.trim(), color: '#0f766e' } }) })
      .catch(() => {}).finally(() => setStep(2));
  };
  const steps = [
    <>
      <img className="welcome-art" src="/brand/crew-row.png" alt="" />
      <h2>Meet your crew</h2>
      <p>Roost is a group chat with coding agents running on your computer. Pip reads each message and hands it to the right crew member — Ollie for the hard problems, Wren for everyday work, and the rest of the gang on Codex.</p>
      <button className="primary" onClick={() => setStep(1)}>Hi, crew</button>
    </>,
    <>
      <img className="welcome-pip" src="/crew/pip-cheer.webp" alt="" />
      <h2>What should we call you?</h2>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" onKeyDown={(e) => e.key === 'Enter' && saveName()} />
      <button className="primary" onClick={saveName}>{name.trim() ? 'That’s me' : 'Skip'}</button>
    </>,
    <>
      <h2>Which plan do you pay for?</h2>
      <p className="section-hint">Pip hands out work to fit it, and tells you when your week is running hot or cold.</p>
      <PlanSettings />
      <button className="primary" onClick={() => setStep(3)}>Next</button>
    </>,
    <>
      <img className="welcome-pip" src="/crew/pip-peek.webp" alt="" />
      <h2>{standalone ? 'You’re all set' : 'Keep Roost one tap away'}</h2>
      {standalone ? (
        <p>Start something from the home screen: pick a project, and say what you want built.</p>
      ) : (
        <p>On iPhone, tap <b>Share</b> then <b>Add to Home Screen</b>. On Android, open the menu and tap <b>Add to Home screen</b>. It opens full screen, like an app.</p>
      )}
      <button className="primary" onClick={onDone}>Let's go</button>
    </>,
  ];
  return (
    <div className="sheet-backdrop welcome">
      <div className="sheet welcome-sheet">
        <div className="welcome-dots">{steps.map((_, i) => <span key={i} className={i === step ? 'on' : ''} />)}</div>
        {steps[step]}
        {step < 3 && <button className="link welcome-skip" onClick={onDone}>Skip setup</button>}
      </div>
    </div>
  );
}
