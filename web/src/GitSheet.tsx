import { useEffect, useState } from 'react';
import { api } from './api';
import type { GitFile, GitStatusResult } from './types';
import { dayLabel } from './chapters';
import { SpriteAvatar } from './ChatView';
import { nameColor } from './color';

/** One shipped commit, as /api/git/history returns it. */
export interface ShippedEntry {
  hash: string;
  subject: string;
  at: number;
  author: string;
  crew: Array<{ name: string; color: string; sprite?: string; agent: 'claude' | 'codex' }>;
}

/** What shipped (2026-09-27): the Map, moved into each project and filled
 *  from git -- the one record of finished work that outlives sessions. Newest
 *  first, grouped Today / Yesterday / a weekday / "Week of…". */
function WhatShipped({ cwd }: { cwd: string }) {
  const [entries, setEntries] = useState<ShippedEntry[] | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    api.gitHistory(cwd, 80).then((r) => setEntries(r.entries)).catch(() => setEntries([]));
  }, [cwd]);
  if (entries === null) return <div className="usage-empty">Reading the history…</div>;
  if (!entries.length) return <div className="usage-empty">Nothing shipped here yet — the first finished job will show up here.</div>;
  const now = Date.now();
  const shown = more ? entries : entries.slice(0, 15);
  let lastDay = '';
  return (
    <div className="shipped">
      {shown.map((e) => {
        const day = dayLabel(e.at, now);
        const header = day !== lastDay ? <div className="shipped-day">{day}</div> : null;
        lastDay = day;
        return (
          <div key={e.hash}>
            {header}
            <div className="shipped-row">
              <span className="shipped-faces">
                {e.crew.length
                  ? e.crew.slice(0, 2).map((c) => (
                      <SpriteAvatar key={c.name} crew={{ ...c, initial: c.name[0], role: '', roleLabel: '', tier: 'worker', model: '' }} pose="idle" size={26} />
                    ))
                  : <span className="shipped-you">{(e.author || '?')[0]}</span>}
              </span>
              <span className="shipped-text">
                <span className="shipped-subject">{e.subject}</span>
                <span className="shipped-by">
                  {e.crew.length ? e.crew.map((c, i) => <span key={c.name} style={{ color: nameColor(c.color) }}>{i ? ', ' : ''}{c.name}</span>) : e.author}
                  {' · '}{new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </span>
              </span>
            </div>
          </div>
        );
      })}
      {!more && entries.length > 15 && <button className="chip" onClick={() => setMore(true)}>Show {entries.length - 15} more</button>}
    </div>
  );
}

function statusLabel(f: GitFile): string {
  if (f.untracked) return 'new';
  const code = f.status.trim();
  if (code.startsWith('D')) return 'deleted';
  if (code.startsWith('R')) return 'renamed';
  if (code.startsWith('A')) return 'added';
  return 'modified';
}

function DiffView({ diff }: { diff: string }) {
  if (!diff.trim()) return <div className="usage-empty">No diff to show.</div>;
  return (
    <pre className="git-diff">
      {diff.split('\n').map((line, i) => {
        const cls = line.startsWith('+++') || line.startsWith('---')
          ? 'meta'
          : line.startsWith('@@')
            ? 'hunk'
            : line.startsWith('+')
              ? 'add'
              : line.startsWith('-')
                ? 'remove'
                : '';
        return (
          <div key={i} className={`git-diff-line ${cls}`}>
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}

export function GitSheet({
  cwd,
  onClose,
  onVerify,
  verifyDisabled,
}: {
  cwd: string;
  onClose: () => void;
  /** Verify used to be a permanent two-button bar at the very top of every
   *  session, regardless of whether there was anything to verify. Moved here:
   *  verifying is "check what changed," so it belongs next to the diff it
   *  checks, not as hero space competing with the thread itself. Omitted
   *  from the home screen's git peek, which has no live session to verify
   *  against — the row simply does not render there rather than being
   *  wired to a dead action. */
  onVerify?: (review: boolean) => void;
  verifyDisabled?: boolean;
}) {
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => {
    api
      .gitStatus(cwd)
      .then((r) => setStatus(r.git))
      .catch((e) => setError(String(e.message ?? e)));
  };

  useEffect(load, [cwd]);

  async function showDiff(path: string) {
    if (openFile === path) {
      setOpenFile(null);
      return;
    }
    setOpenFile(path);
    setDiff(null);
    try {
      const r = await api.gitDiff(cwd, path);
      setDiff(r.diff);
    } catch (e: any) {
      setDiff(`Failed to load diff: ${e.message ?? e}`);
    }
  }

  async function commit() {
    setBusy('commit');
    setError(null);
    setNotice(null);
    try {
      const r = await api.gitCommit(cwd, message.trim());
      setNotice(r.output.split('\n')[0]);
      setMessage('');
      setOpenFile(null);
      load();
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  async function push() {
    setBusy('push');
    setError(null);
    setNotice(null);
    try {
      const r = await api.gitPush(cwd);
      setNotice(r.output.split('\n').pop() ?? 'Pushed.');
      load();
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Changes &amp; history</h3>
        {!status && !error && <div className="usage-empty">Loading…</div>}
        {error && <div className="error-note">{error}</div>}
        {notice && <div className="git-notice">{notice}</div>}
        {status && !status.isRepo && <div className="usage-empty">This project is not a git repository.</div>}
        {status?.isRepo && (
          <>
            <div className="git-branch-row">
              <span className="git-branch">⎇ {status.branch ?? '(no branch)'}</span>
              {Boolean(status.ahead) && <span className="git-ahead">{status.ahead} to push</span>}
              {Boolean(status.behind) && <span className="git-behind">{status.behind} behind</span>}
            </div>

            {onVerify && (
              <div className="git-verify-row">
                <button
                  className="chip"
                  disabled={verifyDisabled}
                  title="Run the project's gates and record command, exit code and output"
                  onClick={() => onVerify(false)}
                >
                  ✓ Run gates
                </button>
                <button
                  className="chip"
                  disabled={verifyDisabled}
                  title="Gates, then a fresh-context review of the diff against the criteria"
                  onClick={() => onVerify(true)}
                >
                  ✓ Gates + review diff
                </button>
              </div>
            )}

            {status.files.length === 0 ? (
              <div className="usage-empty">Working tree clean — nothing to commit.</div>
            ) : (
              <div className="git-files">
                {status.files.map((f) => (
                  <div key={f.path} className="git-file">
                    <button className="git-file-row" onClick={() => showDiff(f.path)}>
                      <span className={`preview-file-action ${statusLabel(f) === 'new' || statusLabel(f) === 'added' ? 'created' : statusLabel(f) === 'deleted' ? 'deleted' : ''}`}>
                        {statusLabel(f)}
                      </span>
                      <span className="preview-file-path git-file-path">{f.path}</span>
                      {(f.additions != null || f.deletions != null) && (
                        <span className="git-counts">
                          {f.additions != null && <span className="git-count-add">+{f.additions}</span>}{' '}
                          {f.deletions != null && <span className="git-count-del">−{f.deletions}</span>}
                        </span>
                      )}
                    </button>
                    {openFile === f.path && (diff === null ? <div className="usage-empty">Loading diff…</div> : <DiffView diff={diff} />)}
                  </div>
                ))}
              </div>
            )}

            {status.files.length > 0 && (
              <div className="git-commit-box">
                <textarea
                  className="git-commit-input"
                  rows={2}
                  placeholder="Commit message…"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <button className="primary" disabled={!message.trim() || busy !== null} onClick={commit}>
                  {busy === 'commit' ? 'Committing…' : `Commit all (${status.files.length})`}
                </button>
              </div>
            )}

            <h4 className="shipped-title">What shipped</h4>
            <WhatShipped cwd={cwd} />

            <div className="sheet-actions">
              {Boolean(status.ahead) && (
                <button className="chip git-push-btn" disabled={busy !== null} onClick={push}>
                  {busy === 'push' ? 'Pushing…' : `Push ${status.ahead}`}
                </button>
              )}
              <button className="primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
