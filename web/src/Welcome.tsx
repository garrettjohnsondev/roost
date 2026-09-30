import { useEffect, useState } from 'react';
import { PlanSettings } from './GlobalSettings';
import { api } from './api';
import { FolderBrowser, NewProjectSheet } from './SessionList';

/** First run (roadmap #56; rebuilt 2026-09-30 after a cold-install walkthrough).
 *
 *  It used to be hidden from every new install: it showed only while no name
 *  was on file, and the server answers "You" by default. Now it shows until
 *  THIS phone has finished it, unless the person has already set a name
 *  (an existing install never sees it).
 *
 *  Two shapes. In a phone BROWSER it is one step: add Roost to the home
 *  screen, with pictures -- on iPhone the home-screen app keeps its own
 *  storage, so everything after that happens inside the app. In the APP (or
 *  if they choose to stay in the browser): meet the crew, your name, your
 *  plan, and your first project -- which opens a chat with a first message
 *  waiting in the box. */
const KEY = 'roost:welcomed';

export function useWelcome(): [boolean, () => void] {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem(KEY) === '1'; } catch { /* private mode */ }
    if (seen || new URLSearchParams(location.search).has('fixture')) return;
    fetch('/api/me').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && !d.set) setShow(true); }).catch(() => {});
  }, []);
  return [show, () => { try { localStorage.setItem(KEY, '1'); } catch { /* */ } setShow(false); }];
}

const isStandalone = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true);
const isPhone = () => typeof navigator !== 'undefined' && /iphone|ipad|android/i.test(navigator.userAgent);
const isIOS = () => typeof navigator !== 'undefined' && /iphone|ipad/i.test(navigator.userAgent);

/** The two gestures, drawn: iPhone's Share button and Android's menu. */
function HomeScreenHow() {
  const ios = isIOS();
  return (
    <div className="hs-how">
      <div className={`hs-card${ios ? ' on' : ''}`}>
        <div className="hs-os">iPhone · Safari</div>
        <ol>
          <li>Tap <span className="hs-key" aria-label="Share"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 3v12M7 8l5-5 5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></span> Share</li>
          <li>Scroll, tap <b>Add to Home Screen</b></li>
          <li>Tap <b>Add</b></li>
        </ol>
      </div>
      <div className={`hs-card${!ios && isPhone() ? ' on' : ''}`}>
        <div className="hs-os">Android · Chrome</div>
        <ol>
          <li>Tap <span className="hs-key" aria-label="Menu">⋮</span> menu</li>
          <li>Tap <b>Add to Home screen</b></li>
          <li>Tap <b>Add</b></li>
        </ol>
      </div>
    </div>
  );
}

export function Welcome({ onDone, onOpen }: { onDone: () => void; onOpen?: (id: string) => void }) {
  const [inBrowser, setInBrowser] = useState(() => isPhone() && !isStandalone());
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [picking, setPicking] = useState<null | 'folder' | 'new'>(null);
  const [err, setErr] = useState<string | null>(null);
  const saveName = () => {
    if (!name.trim()) return setStep(2);
    fetch('/api/me', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ me: { name: name.trim(), color: '#0f766e' } }) })
      .catch(() => {}).finally(() => { window.dispatchEvent(new CustomEvent('roost:me', { detail: name.trim() })); setStep(2); });
  };
  /** Start the first chat in the chosen project, a first message in the box. */
  const begin = async (path: string, fresh: boolean) => {
    setErr(null);
    try {
      let id: string | null = null;
      for (const agent of ['claude', 'codex']) {
        try { id = (await api.createSession({ agent, cwd: path })).session.id; break; } catch { /* try the other */ }
      }
      if (!id) throw new Error('Neither Claude nor Codex could start. Check that one is signed in on your computer.');
      const say = fresh
        ? "Let's start this project. Ask me what I want to build, then suggest a simple first version."
        : 'Take a look around this project and tell me in plain words what it is, then suggest a good first thing to work on.';
      try { sessionStorage.setItem(`roost:draft:${id}`, say); } catch { /* private mode */ }
      onDone();
      onOpen?.(id);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  };

  if (inBrowser) {
    return (
      <div className="sheet-backdrop welcome">
        <div className="sheet welcome-sheet">
          <img className="welcome-pip" src="/crew/pip-peek.webp" alt="" />
          <h2>First, put Roost on your home screen</h2>
          <p>It opens full screen like an app, stays signed in, and can buzz you when the crew needs you.</p>
          <HomeScreenHow />
          <p className="section-hint">Then open Roost from your home screen to finish setting up.</p>
          <button className="link welcome-skip" onClick={() => setInBrowser(false)}>Keep going in the browser instead</button>
        </div>
      </div>
    );
  }

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
      <img className="welcome-pip" src="/crew/pip-idle.webp" alt="" />
      <h2>What should the crew work on first?</h2>
      <p className="section-hint">A project is just a folder on your computer.</p>
      <div className="welcome-choices">
        <button className="primary" onClick={() => setPicking('folder')}>A project I already have</button>
        <button className="chip" onClick={() => setPicking('new')}>Start a brand-new one</button>
      </div>
      {err && <div className="error-note">{err}</div>}
    </>,
  ];
  return (
    <div className="sheet-backdrop welcome">
      <div className="sheet welcome-sheet">
        <div className="welcome-dots">{steps.map((_, i) => <span key={i} className={i === step ? 'on' : ''} />)}</div>
        {steps[step]}
        <button className="link welcome-skip" onClick={onDone}>{step < 3 ? 'Skip setup' : 'I’ll pick later'}</button>
      </div>
      {picking === 'folder' && (
        <FolderBrowser
          onClose={() => setPicking(null)}
          onPick={async (path) => {
            setPicking(null);
            try { await api.addProject(path); } catch { /* already added is fine */ }
            void begin(path, false);
          }}
        />
      )}
      {picking === 'new' && <NewProjectSheet onClose={() => setPicking(null)} onMade={(path) => { setPicking(null); void begin(path, true); }} />}
    </div>
  );
}
