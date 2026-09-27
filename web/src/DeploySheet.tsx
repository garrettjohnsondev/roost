import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { fmtAgo } from './format';
import type { DeployRun, DeployState, DeploySuggestion } from './types';

/** One Deploy button, any project (server/src/deploy.ts).
 *
 *  First tap in a project: what deploy means here, found in the repo and shown
 *  with its evidence -- confirm it once or correct it. Nothing found: say so,
 *  and offer to have the crew work it out. Every tap after that: run it, the
 *  project's own check first. */

/** Lets a crew member's ```roost-deploy block (Markdown) open this sheet with
 *  their proposal filled in. Provided by the chat. */
export const DeployContext = createContext<{ open: (proposal?: DeploySuggestion) => void } | null>(null);

const running = (r: DeployRun | null) => !!r && (r.phase === 'check' || r.phase === 'deploy');

const PHASE_WORDS: Record<DeployRun['phase'], string> = {
  check: 'Checking first…',
  deploy: 'Deploying…',
  passed: 'Deployed',
  failed: 'Deploy failed',
  'gate-failed': 'Not deployed — the check failed',
};

export function DeploySheet({
  cwd,
  proposal,
  onAsk,
  crewName,
  onClose,
}: {
  cwd: string;
  /** A crew member's proposal, from their reply: prefills the form. */
  proposal?: DeploySuggestion;
  /** Send the "work out deploy" ask to the crew in this chat. */
  onAsk?: (prompt: string) => void;
  /** Who would work it out, by name ("Ask Ollie to figure it out"). */
  crewName?: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<DeployState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [command, setCommand] = useState('');
  const [check, setCheck] = useState('');
  const [busy, setBusy] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  /** With nothing found, the command fields wait behind "I know the command". */
  const [typing, setTyping] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const fill = (s: { command: string; check: string | null } | null) => {
    setCommand(s?.command ?? '');
    setCheck(s?.check ?? '');
  };

  useEffect(() => {
    api
      .deploy(cwd)
      .then((s) => {
        setState(s);
        const seed = proposal ?? s.suggestion;
        if (proposal || !s.recipe) {
          setEditing(true);
          fill(seed ?? null);
        }
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [cwd]);

  // While a deploy runs, read its progress. A deploy of Roost itself restarts
  // the server underneath this sheet: keep asking, and say why it went quiet.
  const run = state?.run ?? null;
  useEffect(() => {
    if (!running(run)) return;
    const t = setTimeout(() => {
      api
        .deploy(cwd)
        .then((s) => {
          if (!alive.current) return;
          setUnreachable(false);
          setState(s);
        })
        .catch(() => {
          if (!alive.current) return;
          setUnreachable(true);
          setState((s) => (s ? { ...s } : s)); // tick again
        });
    }, 1500);
    return () => clearTimeout(t);
  }, [state]);

  async function save(andRun: boolean) {
    setBusy(true);
    setError(null);
    try {
      const source = proposal ? 'the crew' : state?.suggestion && command.trim() === state.suggestion.command ? state.suggestion.source : 'you';
      const { recipe } = await api.saveDeploy(cwd, { command: command.trim(), check: check.trim() || null, source });
      setState((s) => (s ? { ...s, recipe, suggestion: null } : s));
      setEditing(false);
      if (andRun) await go();
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function go() {
    setError(null);
    try {
      const { run } = await api.runDeploy(cwd);
      setState((s) => (s ? { ...s, run } : s));
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  }

  async function forget() {
    try {
      const r = await api.forgetDeploy(cwd);
      setState((s) => (s ? { ...s, recipe: null, suggestion: r.suggestion } : s));
      fill(r.suggestion);
      setEditing(true);
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  }

  const name = cwd.split('/').pop() ?? cwd;
  const recipe = state?.recipe ?? null;
  const seed = proposal ?? state?.suggestion ?? null;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet deploy" onClick={(e) => e.stopPropagation()}>
        <h3>Deploy {name}</h3>
        {/* Which project, said plainly: the one this chat was started in. */}
        <div className="deploy-where">This chat's project · <code>{cwd}</code></div>
        {!state && !error && <div className="usage-empty">Reading the project…</div>}
        {error && <div className="error-note">{error}</div>}

        {state && !editing && recipe && (
          <>
            <div className="deploy-recipe">
              {recipe.check ? (
                <div className="deploy-step"><span className="deploy-label">Checks first</span><code>{recipe.check}</code></div>
              ) : (
                <div className="deploy-step"><span className="deploy-label">Checks first</span><span className="deploy-none">no check — deploys straight away</span></div>
              )}
              <div className="deploy-step"><span className="deploy-label">Then runs</span><code>{recipe.command}</code></div>
              <div className="deploy-source">Confirmed {fmtAgo(recipe.confirmedAt)} · from {recipe.source}</div>
            </div>
            <button className="deploy-go" disabled={running(run) || busy} onClick={go}>
              {running(run) ? PHASE_WORDS[run!.phase] : 'Deploy'}
            </button>
          </>
        )}

        {state && editing && (
          <>
            {seed ? (
              <div className="deploy-found">
                <p>
                  {proposal ? 'The crew worked out' : 'From what is in the repo, deploy here looks like'} <strong>{seed.source}</strong>. Check it, change anything that's wrong, and it's saved for every Deploy after this one.
                </p>
                {seed.evidence.length > 0 && (
                  <ul className="deploy-evidence">
                    {seed.evidence.map((e) => <li key={e}>{e}</li>)}
                  </ul>
                )}
              </div>
            ) : (
              <div className="deploy-found">
                <p>Roost doesn't know how <strong>{name}</strong> goes live yet — nothing in it points to a host or a deploy script.</p>
                {onAsk && (
                  <button className="deploy-go" onClick={() => { onAsk(state.ask); onClose(); }}>
                    Ask {crewName ?? 'the crew'} to figure it out
                  </button>
                )}
                {!typing && (
                  <button className="deploy-link" onClick={() => setTyping(true)}>I know the command</button>
                )}
              </div>
            )}
            {(seed || typing) && (
            <>
            <label className="deploy-field">
              <span className="deploy-label">Deploy command</span>
              <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="e.g. npx vercel --prod" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            </label>
            <label className="deploy-field">
              <span className="deploy-label">Must pass first (optional)</span>
              <input value={check} onChange={(e) => setCheck(e.target.value)} placeholder="e.g. npm test" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            </label>
            <div className="deploy-actions">
              <button className="deploy-go" disabled={!command.trim() || busy} onClick={() => save(true)}>Save and deploy</button>
              <button disabled={!command.trim() || busy} onClick={() => save(false)}>Save only</button>
            </div>
            </>
            )}
            {seed && onAsk && !proposal && (
              <button className="deploy-link" onClick={() => { onAsk(state.ask); onClose(); }}>Not right? Ask the crew to look</button>
            )}
          </>
        )}

        {run && (
          <div className={`deploy-run ${run.phase}`}>
            <div className="deploy-run-head">
              <span>{PHASE_WORDS[run.phase]}</span>
              <span className="deploy-run-when">{run.endedAt ? `${fmtAgo(run.endedAt)}${run.exitCode != null ? ` · exit ${run.exitCode}` : ''}` : `started ${fmtAgo(run.startedAt)}`}</span>
            </div>
            {unreachable && running(run) && <div className="deploy-note">Roost went quiet — if this deploy restarts Roost itself, it'll be back in a few seconds.</div>}
            {run.output && <pre className="deploy-output">{run.output.replace(/\x1b?\[[0-9;]*m/g, '').split('\n').slice(-60).join('\n')}</pre>}
          </div>
        )}

        <div className="sheet-actions">
          {state && !editing && recipe && (
            <>
              <button onClick={() => { fill(recipe); setEditing(true); }}>Edit</button>
              <button onClick={forget}>Forget</button>
            </>
          )}
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/** A crew member's ```roost-deploy block, drawn as an offer rather than code. */
export function DeployProposal({ text }: { text: string }) {
  const ctx = useContext(DeployContext);
  const command = text.match(/^\s*command:\s*(.+)$/m)?.[1].trim();
  const c = text.match(/^\s*check:\s*(.+)$/m)?.[1].trim();
  const check = c && !/^(none|null|-)$/i.test(c) ? c : null;
  if (!command) return <pre><code>{text}</code></pre>;
  return (
    <div className="deploy-proposal">
      <div className="deploy-step"><span className="deploy-label">Deploy</span><code>{command}</code></div>
      <div className="deploy-step"><span className="deploy-label">Check first</span>{check ? <code>{check}</code> : <span className="deploy-none">none</span>}</div>
      {ctx && (
        <button className="deploy-go" onClick={() => ctx.open({ command, check, source: 'the crew', evidence: [] })}>
          Review and use for Deploy
        </button>
      )}
    </div>
  );
}
