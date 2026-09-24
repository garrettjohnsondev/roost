import { useState } from 'react';

/** Sign in to Claude from the phone.
 *
 *  Roost starts Claude's own sign-in on the Mac and hands you its link; you sign
 *  in on this phone, copy the code the page shows, and paste it back. The token
 *  that results stays on the Mac — this screen never sees it. Before this, an
 *  expired sign-in stranded the phone until you got back to a terminal. */
export function ClaudeSignIn({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const [step, setStep] = useState<'intro' | 'starting' | 'link' | 'finishing' | 'done' | 'error'>('intro');
  const [flow, setFlow] = useState<{ flowId: string; url: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const post = async (path: string, body?: unknown) => {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
    return d;
  };

  const start = async () => {
    setStep('starting'); setError(null); setCode('');
    try {
      setFlow(await post('/api/auth/claude/start'));
      setStep('link');
    } catch (e: any) {
      setError(String(e.message ?? e)); setStep('error');
    }
  };

  const finish = async () => {
    if (!flow || !code.trim()) return;
    setStep('finishing'); setError(null);
    try {
      await post('/api/auth/claude/finish', { flowId: flow.flowId, code: code.trim() });
      setStep('done');
      onDone?.();
    } catch (e: any) {
      setError(String(e.message ?? e)); setStep('error');
    }
  };

  const close = () => {
    if (step === 'link' || step === 'finishing') void post('/api/auth/claude/cancel').catch(() => {});
    onClose();
  };

  return (
    <div className="sheet-backdrop" onClick={close}>
      <div className="sheet claude-signin" onClick={(e) => e.stopPropagation()}>
        <h3>Sign in to Claude</h3>

        {step === 'intro' && (
          <>
            <p className="section-hint">
              Roost will start Claude&rsquo;s sign-in on your Mac and give you the link here. Sign in on this phone, then paste
              back the code it shows you. Roost keeps its own sign-in, valid for a year, so signing in or out anywhere else on
              the Mac won&rsquo;t break it.
            </p>
            <div className="sheet-actions">
              <button onClick={close}>Not now</button>
              <button className="primary" onClick={start}>Start</button>
            </div>
          </>
        )}

        {step === 'starting' && <p className="section-hint">Starting the sign-in on your Mac…</p>}

        {(step === 'link' || step === 'finishing') && flow && (
          <>
            <ol className="signin-steps">
              <li>
                <a className="chip signin-open" href={flow.url} target="_blank" rel="noopener noreferrer">Open the sign-in page</a>
              </li>
              <li>Sign in with your Claude account and approve.</li>
              <li>Copy the code it shows, and paste it here:</li>
            </ol>
            <label className="signin-code-label" htmlFor="claude-code">Code</label>
            <input
              id="claude-code"
              className="crew-row-name signin-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Paste the code"
              disabled={step === 'finishing'}
            />
            <div className="sheet-actions">
              <button onClick={close}>Cancel</button>
              <button className="primary" disabled={!code.trim() || step === 'finishing'} onClick={finish}>
                {step === 'finishing' ? 'Signing in…' : 'Finish'}
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <p className="section-hint">Signed in. Claude sessions on this Mac now use Roost&rsquo;s own sign-in.</p>
            <div className="sheet-actions">
              <button className="primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}

        {step === 'error' && (
          <>
            <p className="error-note">{error}</p>
            <div className="sheet-actions">
              <button onClick={close}>Close</button>
              <button className="primary" onClick={start}>Start again</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
