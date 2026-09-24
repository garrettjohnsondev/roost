import React, { useEffect, useRef, useState } from 'react';
import { rotFor, expiringBlocks, typeSteps, typeDurationMs } from './motion';
import { nameColor } from './color';
import { chaptersOf, type Chapter } from './chapters';
import { trackerOf } from './tracker';
import { Icon } from './icons';
import { segmentsOf, summarizeRun } from './toolruns';
import { ClaudeSignIn } from './ClaudeSignIn';
import { api } from './api';
import { fmtAgo, shortPath } from './format';
import { GitSheet } from './GitSheet';
import { Markdown } from './Markdown';
import { PreviewContent } from './PreviewContent';
import { useSession, type SessionState } from './useSession';
import type { ApprovalSetting, ChatItem, CrewInfo, Me, RoostConfigResponse, PreviewResult, SessionMeta, SessionMode, UserImage } from './types';

const SWITCHER_LIMIT = 5;

function SessionSwitcher(props: { currentId: string; onPick: (id: string) => void; onAllSessions: () => void; onClose: () => void }) {
  const [sessions, setSessions] = useState<SessionMeta[] | null>(null);

  useEffect(() => {
    api
      .sessions()
      .then((r) => setSessions(r.sessions.filter((s) => s.id !== props.currentId).slice(0, SWITCHER_LIMIT)))
      .catch(() => setSessions([]));
  }, [props.currentId]);

  return (
    <div className="sheet-backdrop switcher-backdrop" onClick={props.onClose}>
      <div className="switcher-panel" onClick={(e) => e.stopPropagation()}>
        {sessions === null && <div className="usage-empty switcher-empty">Loading…</div>}
        {sessions?.length === 0 && <div className="usage-empty switcher-empty">No other active sessions</div>}
        {sessions?.map((s) => (
          <button key={s.id} className="switcher-row" onClick={() => props.onPick(s.id)}>
            <span className={`agent-dot ${s.agent}`} />
            <span className="recent-info">
              <span className="recent-project">{s.title}</span>
              <span className="recent-title">
                {shortPath(s.cwd)} · {s.agent}
              </span>
            </span>
            {s.state === 'working' && <span className="live-badge working">●</span>}
            <span className="recent-time">{fmtAgo(s.updatedAt)}</span>
          </button>
        ))}
        <button className="switcher-row switcher-all" onClick={props.onAllSessions}>
          <span className="recent-info">
            <span className="recent-project">All sessions</span>
          </span>
          <span className="recent-time">›</span>
        </button>
      </div>
    </div>
  );
}

export function ChatView(props: { sessionId: string; config: RoostConfigResponse; onBack: () => void; onSwitch: (id: string) => void; fixture?: SessionState }) {
  const { sessionId, config, onBack, onSwitch, fixture } = props;
  // A fixture is a canned thread for design review — no socket, no server calls.
  const live = useSession(fixture ? null : sessionId);
  const session = fixture ?? live;
  const [showSettings, setShowSettings] = useState(false);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showGit, setShowGit] = useState(false);
  const [recap, setRecap] = useState<PreviewResult | null>(null);
  const [recapLoading, setRecapLoading] = useState(false);
  // User-reported 2026-09-23: scrolled into the middle of a resumed session's
  // recap -- a wall of old diffs with no header in view -- and could not tell
  // it from live work, or find the actual live thread underneath it. Collapsed
  // by default: a one-line summary you open on purpose, never a wall you
  // scroll past by accident.
  const [recapOpen, setRecapOpen] = useState(false);
  // Tapping Proceed answers on the spot -- the button says so and stops taking
  // taps -- until the server's meta confirms the plan has left the bar.
  const [proceeding, setProceeding] = useState(false);
  useEffect(() => {
    if (!session.meta?.consultPending) setProceeding(false);
  }, [session.meta?.consultPending]);
  // Pre-ticked: at this point the meter has already crossed a line the person
  // was told about, and the common answer to "do this every time" here is yes.
  // It is still a checkbox they can clear before tapping.
  const [keepCompacting, setKeepCompacting] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  useEffect(() => {
    const open = () => setSigningIn(true);
    window.addEventListener('roost:claude-signin', open);
    return () => window.removeEventListener('roost:claude-signin', open);
  }, []);
  // You, in the thread. One fetch, because your name does not change per project.
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d?.me) setMe(d.me); })
      .catch(() => { /* the thread works without your face */ });
    return () => { live = false; };
  }, []);
  const recapFetchedFor = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Recovered 2026-09-24: "I can't scroll up and read anything because it
  // jumps me down when there's something new." The thread follows the work
  // only while you are AT the bottom. Scroll up and it holds still; what
  // arrives meanwhile is counted on a pill that takes you back down. Pinned
  // is a ref, not state: it changes on every scroll tick and must not re-render.
  const pinned = useRef(true);
  const seenCount = useRef(0);
  const [unseen, setUnseen] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (pinned.current) {
      el.scrollTop = el.scrollHeight;
      seenCount.current = session.items.length;
      if (unseen) setUnseen(0);
    } else {
      const n = Math.max(0, session.items.length - seenCount.current);
      if (n !== unseen) setUnseen(n);
    }
  }, [session.items, session.status, recap, unseen]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    pinned.current = atBottom;
    if (atBottom && unseen) {
      seenCount.current = session.items.length;
      setUnseen(0);
    }
  };
  const jumpDown = () => {
    pinned.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    seenCount.current = session.items.length;
    setUnseen(0);
  };

  useEffect(() => {
    setRecap(null); // switching sessions — don't show the previous chat's recap
    pinned.current = true;
    seenCount.current = 0;
    setUnseen(0);
  }, [sessionId]);

  // A resumed session's Roost-visible thread starts empty even though the agent
  // remembers everything — without this, every reopened chat looks like it forgot the
  // whole project. Fetch a free (no-token) recap of the underlying history exactly once,
  // and only while the live thread here is still empty — once you've sent something in
  // Roost, that conversation is the context and the recap would just be clutter.
  useEffect(() => {
    const resumedFrom = session.meta?.resumedFrom;
    const meta = session.meta;
    if (!resumedFrom || !meta || session.items.length > 0) return;
    if (recapFetchedFor.current === sessionId) return;
    recapFetchedFor.current = sessionId;
    setRecapLoading(true);
    api
      .preview(meta.agent, meta.cwd, resumedFrom)
      .then((r) => setRecap(r.preview))
      .catch(() => setRecap(null))
      .finally(() => setRecapLoading(false));
  }, [sessionId, session.meta?.resumedFrom, session.meta?.agent, session.meta?.cwd, session.items.length]);

  const agent = session.meta?.agent ?? 'claude';
  const agentConfig = config[agent];
  const isAuto = session.meta?.model === 'auto';
  const activeModelId = isAuto ? session.meta?.routedModel : session.meta?.model;
  const isCurrentModel = (m: { id: string; resolvedModel?: string }) =>
    activeModelId === m.id || (!!m.resolvedModel && activeModelId === m.resolvedModel);
  const concreteLabel = agentConfig.models.find(isCurrentModel)?.label ?? activeModelId;
  const currentModelLabel = isAuto ? `Auto → ${concreteLabel ?? '…'}` : concreteLabel ?? 'default';

  return (
    <div className="chat-page">
      <header className="chat-header">
        <button className="ghost" onClick={onBack}>
          ‹
        </button>
        <button className="chat-title" onClick={() => setShowSwitcher(true)}>
          <span className={`agent-dot ${agent}`} />
          <div className="chat-title-body">
            <div className="chat-title-text">
              {session.meta?.title ?? '…'} <span className="chat-title-chevron">▾</span>
            </div>
            <div className="chat-title-sub">
              {session.meta?.mode ? <span className={`mode-tag ${session.meta.mode}`}>{session.meta.mode}</span> : null} {agent} ·{' '}
              {currentModelLabel} {session.meta?.effort ? `· ${session.meta.effort}` : ''}
              {!session.connected && ' · reconnecting…'}
            </div>
          </div>
        </button>
        <button className="ghost git-btn" onClick={() => setShowGit(true)}>
          ⎇
        </button>
        <button className="ghost" onClick={() => setShowSettings(true)}>
          <Icon name="gear" size={24} title="Session settings" />
        </button>
      </header>

      {showGit && session.meta && (
        <GitSheet
          cwd={session.meta.cwd}
          onClose={() => setShowGit(false)}
          onVerify={(review) => {
            session.send({ type: 'verify', review });
            setShowGit(false);
          }}
          verifyDisabled={session.status === 'working'}
        />
      )}

      {showSwitcher && (
        <SessionSwitcher
          currentId={sessionId}
          onPick={(id) => {
            setShowSwitcher(false);
            onSwitch(id);
          }}
          onAllSessions={() => {
            setShowSwitcher(false);
            onBack();
          }}
          onClose={() => setShowSwitcher(false)}
        />
      )}

      {session.meta?.surplus && !session.meta.boost && (
        <div className="surplus-bar">
          {/* Use it or lose it. The blocks that will expire unused pulse; the
              ones already spent sit still. This repeats, and deliberately: the
              risk persists until the window resets or you take the boost, and
              either one removes the surplus from the meta and unmounts this —
              so the pulse ends because its cause ended. */}
          <span className="expiry-blocks" aria-hidden="true">
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} className={`expiry-block${i >= 10 - expiringBlocks(session.meta!.surplus!.headroomPct) ? ' expiring' : ''}`} />
            ))}
          </span>
          <span>
            Spend it before it resets — {session.meta.surplus.headroomPct}% of your {session.meta.surplus.label} vanishes in{' '}
            {fmtMinutes(session.meta.surplus.minutesLeft)}.
          </span>
          <button className="chip" onClick={() => session.send({ type: 'set_boost', on: true })}>
            Use the good models
          </button>
        </div>
      )}
      {session.meta?.boost && (
        <div className="surplus-bar on">
          <span>Boost on — routing to the heavy tier{session.meta.surplus ? ` until ${session.meta.surplus.label} resets` : ''}.</span>
          <button className="chip" onClick={() => session.send({ type: 'set_boost', on: false })}>
            Turn off
          </button>
        </div>
      )}
      {session.meta?.approvals === 'full-auto' && (
        <div className="surplus-bar on full-auto-bar">
          {/* Full auto is a deliberate, session-wide widening of what runs
              without asking -- it must stay visible for as long as it is on,
              never a one-time toggle that fades from view. User-reported
              2026-09-23: the original two-line copy plus a full chip button
              took up too much real estate at the top of every turn. Shrunk to
              one line, kept always visible either way. */}
          <span className="full-auto-text"><Icon name="bolt" /> Full auto — no approvals this session</span>
          <button className="chip full-auto-off" onClick={() => session.send({ type: 'set_approvals', approvals: 'ask' })}>
            Turn off
          </button>
        </div>
      )}
      {session.usage && (
        <div className="usage-bar">
          {fmtTokens(session.usage.inputTokens)} in · {fmtTokens(session.usage.outputTokens)} out
          {session.usage.contextPct != null && <> · ctx {session.usage.contextPct}%</>}
        </div>
      )}
      {session.context && (
        <div
          className={`context-bar ${session.context.pressure}`}
          title={session.context.categories?.map((c) => `${c.name}: ${fmtTokens(c.tokens)}`).join('\n')}
        >
          {session.meta?.crew?.sprite && (
            <span className="context-face" style={{ '--rot': rotFor(session.context.percent) } as React.CSSProperties}>
              <SpriteAvatar crew={session.meta.crew} pose="idle" size={22} />
            </span>
          )}
          <span>
            Context {session.context.percent != null ? `${session.context.percent}%` : 'no data'}
            {session.context.usedTokens != null && session.context.maxTokens != null
              ? ` · ${fmtTokens(session.context.usedTokens)} of ${fmtTokens(session.context.maxTokens)}`
              : ''}
            {` · ${session.context.pressure}`}
            {session.context.overLimit ? ` · ${fmtTokens(session.context.overLimit.tokensOver)} over the ${session.context.overLimit.kind === 'hard_limit' ? 'hard limit' : 'compaction window'}` : ''}
          </span>
          {session.context.advice && (
            <span className="context-advice">
              {session.context.advice.action}: {session.context.advice.reason}
            </span>
          )}
          {session.meta?.autoCompact && (
            <button
              className="context-auto-off"
              title="Stop compacting automatically — you will be asked again instead"
              onClick={() => session.send({ type: 'set_auto_compact', on: false })}
            >
              auto-compact on · turn off
            </button>
          )}
        </div>
      )}

      {session.meta?.contextOffer && (
        <div className="compact-offer">
          <span className="compact-offer-text">
            {session.meta.contextOffer.reason}. Compacting summarizes the older turns to free room —
            the work stays, the detail thins.
          </span>
          <label className="compact-offer-keep">
            <input
              type="checkbox"
              checked={keepCompacting}
              onChange={(e) => setKeepCompacting(e.target.checked)}
            />
            Keep doing this automatically
          </label>
          <div className="compact-offer-actions">
            <button className="chip" onClick={() => session.send({ type: 'context_dismiss' })}>
              Not now
            </button>
            <button
              className="chip compact-accept"
              onClick={() => session.send({ type: 'context_action', action: 'compact', remember: keepCompacting })}
            >
              Compact now
            </button>
          </div>
        </div>
      )}

      <JobTracker session={session} />

      <div
        className="messages"
        ref={scrollRef}
        onScroll={onScroll}
        data-live-agent={session.meta?.agent}
        style={{ '--rot': rotFor(session.context?.percent) } as React.CSSProperties}
      >
        {(recap || recapLoading) && (
          <div className={`recap-card${recapOpen ? ' open' : ''}`}>
            <button className="recap-toggle" onClick={() => setRecapOpen((v) => !v)}>
              <span className="recap-header">Picking up from before</span>
              <span className="recap-summary">
                {recapLoading
                  ? 'Loading…'
                  : recap && (recap.messages.length || recap.files.length)
                    ? [
                        recap.messages.length ? `${recap.messages.length} message${recap.messages.length === 1 ? '' : 's'}` : '',
                        recap.files.length ? `${recap.files.length} file${recap.files.length === 1 ? '' : 's'} changed` : '',
                      ].filter(Boolean).join(' · ')
                    : 'No history found'}
              </span>
              <span className="recap-chevron">{recapOpen ? '▾' : '▸'}</span>
            </button>
            {recapOpen && (
              <>
                <PreviewContent preview={recap} loading={recapLoading} />
                <div className="recap-divider">continuing below</div>
              </>
            )}
          </div>
        )}
        {session.meta?.recentCrew && session.meta.recentCrew.length > 0 && (
          <CrewWakeUp crew={session.meta.recentCrew} />
        )}
        {(() => {
          // The thread folded into the jobs it did (the Chapters board). One job
          // renders as a plain conversation; with more than one, each gets its
          // named row, and a verified job folds into it.
          const chapters = chaptersOf(session.items);
          const many = chapters.length > 1;
          return chapters.map((ch, ci) => {
            // Consecutive tool calls fold into one line (toolruns.ts); every
            // other item is its own row, as before.
            const rows = segmentsOf(session.items, ch.start, ch.end).map((seg) =>
              seg.kind === 'item' ? (
                <Message key={seg.index} item={session.items[seg.index]} crew={session.meta?.crew} me={me} fresh={seg.index >= session.replayedCount} />
              ) : (
                <ToolRun key={`run-${seg.start}`} items={session.items} start={seg.start} end={seg.end} crew={session.meta?.crew} replayedCount={session.replayedCount} />
              ),
            );
            const last = ci === chapters.length - 1;
            const awaiting = last && (!!session.pendingApproval || !!session.meta?.consultPending);
            if (ch.status !== 'verified' && !many) return <React.Fragment key={ch.start}>{rows}</React.Fragment>;
            return (
              <ChapterFold
                key={ch.start}
                chapter={ch}
                awaiting={awaiting}
                // it closed LIVE, so it folds visibly — after the celebration
                foldingNow={ch.status === 'verified' && ch.end - 1 >= session.replayedCount}
              >
                {rows}
              </ChapterFold>
            );
          });
        })()}
        {/* `triaging` is set locally on tap, before the server has said
            anything -- so it must show the indicator on its own, not wait for
            status to read 'working'. That wait was the reported dead air. */}
        {(session.triaging || session.status === 'working') && !session.closedReason && (
          <WorkingIndicator session={session} />
        )}
        {session.status === 'connecting' && !session.closedReason && <div className="working-indicator">starting agent…</div>}
      </div>
      {unseen > 0 && (
        <button className="new-below" onClick={jumpDown}>
          ↓ {unseen} new
        </button>
      )}

      {session.meta?.consultPending && (
        <div className="consult-bar">
          <span className="consult-bar-text">
            Consult complete{session.meta.planPath ? ` — plan at ${session.meta.planPath.split('/').slice(-3).join('/')}` : ''} — proceed?
          </span>
          <div className="consult-bar-actions">
            <button className="link consult-dismiss" disabled={proceeding} onClick={() => session.send({ type: 'consult_dismiss' })}>
              Dismiss
            </button>
            <button
              className="chip consult-proceed"
              disabled={proceeding}
              onClick={() => {
                setProceeding(true);
                session.send({ type: 'consult_proceed' });
              }}
            >
              {proceeding ? 'Proceeding…' : '▶ Proceed'}
            </button>
          </div>
        </div>
      )}

      {session.closedReason ? (
        <div className="closed-banner">
          <div className="closed-banner-text">{session.closedReason}</div>
          <div className="closed-banner-sub">Your conversation is still saved — reopen it from "Jump back in" on the home screen.</div>
          <button className="primary" onClick={onBack}>
            Back to sessions
          </button>
        </div>
      ) : (
        <Composer
          disabled={!session.connected}
          working={session.status === 'working'}
          onInterrupt={() => session.send({ type: 'interrupt' })}
          onSend={(text, images) => session.send({ type: 'user_message', text, images })}
          onConsult={(text) => session.send({ type: 'consult', text })}
        />
      )}

      {signingIn && <ClaudeSignIn onClose={() => setSigningIn(false)} />}

      {session.pendingApproval && (
        <div className="sheet-backdrop">
          <div className="sheet">
            <h3 className="approval-head">
              {/* An agent that needs you. The peek pose — crouched, leaning in,
                  reading — is what "I am waiting on you" looks like, and it has
                  been drawn and unreferenced until now. */}
              {session.meta?.crew?.sprite && (
                <SpriteAvatar crew={session.meta.crew} pose="peek" size={34} />
              )}
              <span>
                {/* The server names the vendor ("Claude wants to use Bash"); the
                    thread is a crew, so it is the crew member asking. */}
                {crewAsking(session.pendingApproval.title, session.meta?.crew)}
                {session.pendingApprovalCount > 1 ? ` · ${session.pendingApprovalCount - 1} more waiting` : ''}
              </span>
            </h3>
            <pre className="approval-detail">{session.pendingApproval.detail}</pre>
            <div className="sheet-actions">
              <button
                className="danger"
                onClick={() => session.send({ type: 'approval_response', requestId: session.pendingApproval!.requestId, decision: 'deny' })}
              >
                Deny
              </button>
              <button
                className="primary"
                onClick={() => session.send({ type: 'approval_response', requestId: session.pendingApproval!.requestId, decision: 'allow' })}
              >
                Allow
              </button>
            </div>
            <button
              className="link"
              onClick={() => session.send({ type: 'approval_response', requestId: session.pendingApproval!.requestId, decision: 'allow-session' })}
            >
              Allow — and stop asking for this tool
            </button>
            <button
              className="link link-warn"
              onClick={() => {
                // The tool-scoped remember-choice above is deliberately narrow (see
                // sessions.ts) -- it used to silently widen to the whole session and
                // that was removed on purpose. This is the real thing: an explicit,
                // separately-labelled full-auto switch, not a side effect of "allow".
                session.send({ type: 'approval_response', requestId: session.pendingApproval!.requestId, decision: 'allow' });
                session.send({ type: 'set_approvals', approvals: 'full-auto' });
              }}
            >
              Turn on full auto for this session
            </button>
          </div>
        </div>
      )}

      {showSettings && session.meta && (
        <div className="sheet-backdrop" onClick={() => setShowSettings(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>Session settings</h3>
            <div className="field">
              <label>Mode</label>
              <div className="chips">
                {(
                  [
                    ['chat', 'Chat', 'One agent, no ceremony'],
                    ['auto', 'Auto', 'Triage picks the model and effort per message'],
                    ['plan', 'Plan', 'Read-only: every message becomes a plan file, nothing executes'],
                    ['build', 'Build', 'Plan → cross-model review → reconcile → you approve → execute → verify'],
                  ] as Array<[SessionMode, string, string]>
                ).map(([value, label, title]) => (
                  <button
                    key={value}
                    title={title}
                    className={session.meta!.mode === value ? 'chip active' : 'chip'}
                    onClick={() => session.send({ type: 'set_mode', mode: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Model</label>
              <div className="chips">
                <button
                  className={isAuto ? 'chip active' : 'chip'}
                  onClick={() => session.send({ type: 'set_model', model: 'auto' })}
                >
                  <Icon name="bolt" /> Auto
                </button>
                {agentConfig.models.map((m) => (
                  <button
                    key={m.id}
                    className={!isAuto && isCurrentModel(m) ? 'chip active' : 'chip'}
                    onClick={() => session.send({ type: 'set_model', model: m.id })}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Effort</label>
              <div className="chips">
                <button
                  className={session.meta!.effort === '' ? 'chip active' : 'chip'}
                  onClick={() => session.send({ type: 'set_effort', effort: '' })}
                >
                  Auto
                </button>
                {(agentConfig.models.find(isCurrentModel)?.efforts ?? agentConfig.efforts).map((e) => (
                  <button
                    key={e}
                    className={session.meta!.effort === e ? 'chip active' : 'chip'}
                    onClick={() => session.send({ type: 'set_effort', effort: e })}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Approvals</label>
              <div className="chips">
                {(
                  [
                    ['ask', 'Ask me'],
                    ['auto-edits', 'Auto-accept edits'],
                    ['full-auto', 'Full auto'],
                  ] as Array<[ApprovalSetting, string]>
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className={session.meta!.approvals === value ? 'chip active' : 'chip'}
                    onClick={() => session.send({ type: 'set_approvals', approvals: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Session name</label>
              <RenameField current={session.meta.title} onRename={(title) => session.send({ type: 'set_title', title })} />
            </div>
            <div className="field">
              <label>Working directory</label>
              <div className="mono-note">{session.meta.cwd}</div>
            </div>
            <div className="sheet-actions">
              <button className="danger" onClick={() => session.send({ type: 'interrupt' })}>
                Interrupt
              </button>
              <button className="primary" onClick={() => setShowSettings(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Avatar + name + role badge. Persona is WHO (stable per suite+model), role is
 *  WHAT HAT they wear on this turn, so the same face appears as Planner here and
 *  Reviewer there. Falls back to a coloured monogram when no image is set. */
/** A pool avatar arrives as a rooted path ('/avatars/owl.png'); a custom one
 *  as a bare filename under the data dir. Falls back to the monogram, which is
 *  also what every crew member has before anyone picks a face. */
export function avatarUrl(avatar?: string): string | null {
  if (!avatar) return null;
  return avatar.startsWith('/') ? avatar : `/avatars/custom/${avatar}`;
}

/** The poses the drawn sets ship. `idle` is the resting frame every animation
 *  cuts back to. */
export type Pose = 'idle' | 'type' | 'think' | 'blink' | 'cheer' | 'peek' | 'sleep';

/** A drawn crew member, animated by CUTTING between two frames rather than
 *  cross-fading them.
 *
 *  A cross-fade was the first attempt and it read as a smudge, not a character:
 *  for two frames of pixel art, the in-between states are frames that were never
 *  drawn. So both frames are stacked and the top one's opacity is stepped with
 *  `steps(1)` -- it is either there or it is not, which is what a two-frame
 *  animation IS. Motion only ever reflects real state: `type` while a reply is
 *  actually streaming, `think` while the engine is actually reasoning. Nothing
 *  loops on its own schedule. */
export function SpriteAvatar({ crew, pose, size }: { crew: CrewInfo; pose: Pose; size: number }) {
  const [failed, setFailed] = useState(false);
  if (!crew.sprite || failed) return <CrewAvatar crew={crew} size={size} />;
  const moving = pose === 'type' || pose === 'think';
  const base = `/crew/${crew.sprite}`;
  // Exactly ONE drawing visible at any moment. The frames are transparent, so a
  // frame stacked over another does not hide it — the first version kept idle
  // drawn underneath and a typing owl had four wings. A two-frame pose now
  // alternates both frames in antiphase; a held pose draws only itself.
  return (
    <span className={`crew-sprite pose-${pose}${moving ? ' moving' : ''}`} data-agent={crew.agent} style={{ width: size, height: size }}>
      {moving ? (
        <>
          <img className="frame-a" src={`${base}-idle.webp`} alt="" onError={() => setFailed(true)} />
          <img className="frame-b" src={`${base}-${pose}.webp`} alt="" />
        </>
      ) : (
        <img src={`${base}-${pose}.webp`} alt="" onError={() => setFailed(true)} />
      )}
    </span>
  );
}

/** Where the current job is, as a row of steps -- the pizza tracker.
 *
 *  Derived on the client from the thread alone (see tracker.ts), so it never
 *  claims a step the thread does not show. The active step is lit, not
 *  animated: the sprite below is the motion, and one moving thing per state
 *  is enough. Fixed above the thread, so scrolling back through the work does
 *  not lose where the work is. */
function JobTracker({ session }: { session: SessionState }) {
  const t = trackerOf({
    items: session.items,
    mode: session.meta?.mode,
    working: session.status === 'working' || session.triaging,
    statusMessage: session.statusMessage,
    consultPending: !!session.meta?.consultPending,
    approvalPending: !!session.pendingApproval,
  });
  if (!t) return null;
  return (
    <div className={`job-tracker ${t.status}`} aria-label={`Job: ${t.name}`}>
      <span className="tracker-name">{t.name}</span>
      <ol className="tracker-steps">
        {t.steps.map((s) => (
          <li key={s.key} className={`tracker-step ${s.state}`}>
            <span className="tracker-dot" aria-hidden="true">{s.state === 'done' ? '✓' : s.state === 'failed' ? '✗' : ''}</span>
            <span className="tracker-label">{s.state === 'awaiting' ? `${s.label} · you` : s.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Pip, the dispatcher, known locally so the phone can put him on screen the
 *  instant ↑ is tapped -- before the server has sent anything that would name
 *  him. Mirrors DISPATCHER in server/src/crew.ts; doctrine pins the two. */
export const PIP: CrewInfo = {
  name: 'Pip', role: 'dispatcher', roleLabel: 'Dispatch', tier: 'worker',
  color: '#c9803a', initial: 'P', avatar: '/avatars/beacon.png', sprite: 'pip',
  agent: 'claude', model: '',
};

/** Who is working, drawn as them working.
 *
 *  This replaced a line of text reading "working…" on an infinite opacity
 *  pulse -- the flashing that was reported. The character's own frames are the
 *  motion now, and they only move for real state:
 *  - Pip in `think` while he is picking who takes the message (auto mode);
 *  - then the worker, in `type` while a reply streams or a tool runs, and in
 *    `think` in between, when nothing visible is being produced yet.
 *  Text appears only when there is something specific to say. No generic
 *  "working…": the moving sprite already says that. */
function WorkingIndicator({ session }: { session: SessionState }) {
  const last = session.items[session.items.length - 1];
  const producing = (last?.kind === 'assistant' && !last.complete) || (last?.kind === 'tool' && !last.done);
  const crew = session.triaging ? PIP : session.meta?.crew ?? PIP;
  const pose: Pose = !session.triaging && producing ? 'type' : 'think';
  // Local copy, so it shows without waiting on the server's matching status.
  const text = session.triaging ? 'Pip is picking who takes this…' : session.statusMessage;
  return (
    <div className="working-indicator" data-crew={crew.name}>
      <SpriteAvatar crew={crew} pose={pose} size={32} />
      {text && <span className="working-text">{text}</span>}
    </div>
  );
}

/** The crew waking up.
 *
 *  Open a session and the last few who worked here are asleep, then they wake —
 *  slumped, eyes opening, up and ready — in a stagger, so it reads as a room
 *  noticing you walked in rather than three things twitching at once.
 *
 *  It runs ONCE, on mount, and then holds on idle: `animation-fill-mode:
 *  forwards` with no iteration count. That matters, because the rule everywhere
 *  else in this file is that motion reports real state and nothing loops on its
 *  own schedule. Opening a session IS the state change; the sprites are
 *  reporting it, and then they stop.
 *
 *  Three frames from one new drawing: sleep, then blink for the half-second of
 *  eyes opening, then idle. The blink frame already existed for its own sake. */
function CrewWakeUp({ crew }: { crew: CrewInfo[] }) {
  // Art can lag code. A missing sleep frame must degrade to "eyes open and
  // rise" rather than to a broken-image icon, so each frame hides itself if it
  // fails to load and whatever is underneath shows through.
  const [missing, setMissing] = useState<Record<string, true>>({});
  const gone = (key: string) => setMissing((m) => (m[key] ? m : { ...m, [key]: true }));
  const drawn = crew.filter((c) => c.sprite);
  if (drawn.length === 0) return null;
  return (
    <div className="crew-wake" aria-hidden="true">
      {drawn.map((c, i) => (
        <span
          key={c.name}
          className="crew-wake-member"
          style={{ animationDelay: `${i * 220}ms` }}
          title={`${c.name} — ${c.model || c.agent}`}
        >
          <span
            className={`crew-wake-frames${missing[`${c.sprite}-sleep`] ? ' no-sleep' : ''}${missing[`${c.sprite}-blink`] ? ' no-blink' : ''}`}
            style={{ animationDelay: `${i * 220}ms` }}
          >
            {/* Each frame owns a window and is invisible outside it: sleep, then
                blink, then idle. They used to be stacked with the upper ones
                fading out, which drew a standing owl's ears behind a sleeping one. */}
            <img className="wake-idle" src={`/crew/${c.sprite}-idle.webp`} alt="" style={{ animationDelay: `${i * 220}ms` }} />
            {!missing[`${c.sprite}-blink`] && (
              <img
                className="wake-blink"
                src={`/crew/${c.sprite}-blink.webp`}
                alt=""
                style={{ animationDelay: `${i * 220}ms` }}
                onError={() => gone(`${c.sprite}-blink`)}
              />
            )}
            {!missing[`${c.sprite}-sleep`] && (
              <img
                className="wake-sleep"
                src={`/crew/${c.sprite}-sleep.webp`}
                alt=""
                style={{ animationDelay: `${i * 220}ms` }}
                onError={() => gone(`${c.sprite}-sleep`)}
              />
            )}
          </span>
          <span className="crew-wake-name" style={{ color: nameColor(c.color) }}>{c.name}</span>
        </span>
      ))}
    </div>
  );
}

/** The board's thread row, and the iMessage layout that was asked for: the face
 *  BESIDE the bubble, not inside it — 52px, never shrinking — with the name in
 *  Silkscreen and the model small on one line above the bubble. The first
 *  version put a small face inside the bubble, which made every turn read as a
 *  card with a label rather than someone speaking. */
function CrewRow({ crew, pose, head, children }: { crew: CrewInfo; pose: Pose; head?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="crew-row">
      <span className="crew-row-face">
        <SpriteAvatar crew={crew} pose={pose} size={52} />
      </span>
      <div className="crew-row-col">
        <div className="crew-row-head">
          <span className="crew-ident-name" style={{ color: nameColor(crew.color) }}>{crew.name}</span>
          <span className="crew-row-model">
            {crew.model || crew.agent}
            {crew.roleLabel ? ` · ${crew.roleLabel}` : ''}
          </span>
          {head}
        </div>
        {children}
      </div>
    </div>
  );
}

function CrewAvatar({ crew, size }: { crew: CrewInfo; size?: number }) {
  const url = avatarUrl(crew.avatar);
  const [failed, setFailed] = useState(false);
  const box = size ? { width: size, height: size } : undefined;
  if (url && !failed) {
    return (
      <img
        className="crew-avatar crew-avatar-img"
        src={url}
        alt=""
        style={{ background: crew.color, ...box }}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="crew-avatar crew-monogram" style={{ background: crew.color, ...box, fontSize: size ? Math.round(size * 0.42) : undefined }}>
      {crew.initial}
    </span>
  );
}

function fmtMinutes(m: number): string {
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function CrewChip({ crew, sub }: { crew: CrewInfo; sub?: string }) {
  return (
    <span className="crew-chip" title={`${crew.name} · ${crew.roleLabel} · ${crew.model || crew.agent}`}>
      <CrewAvatar crew={crew} />
      <span className="crew-name" style={{ color: nameColor(crew.color) }}>{crew.name}</span>
      <span className="crew-role">{crew.roleLabel}</span>
      {sub && <span className="crew-sub">{sub}</span>}
    </span>
  );
}

function Message({ item, crew, me, fresh = false }: { item: ChatItem; crew?: CrewInfo; me?: Me | null; fresh?: boolean }) {
  switch (item.kind) {
    case 'user':
      // The crew had faces and names from the first commit and you had neither,
      // which is a strange way to build a group chat you are supposed to be IN.
      return (
        <div className="msg-row user">
          <div className="msg user">
            {item.imageCount > 0 && <div className="img-note"><Icon name="camera" /> {item.imageCount} image{item.imageCount > 1 ? 's' : ''}</div>}
            {item.text}
          </div>
          {me && (
            <div className="me-mark" title={me.name}>
              {me.avatar ? (
                <img className="me-avatar" src={avatarUrl(me.avatar) ?? ''} alt="" style={{ background: me.color }} />
              ) : (
                <span className="me-avatar me-monogram" style={{ background: me.color }}>
                  {(me.name[0] ?? 'Y').toUpperCase()}
                </span>
              )}
            </div>
          )}
        </div>
      );
    case 'assistant':
      return (
        item.crew ? (
          <CrewRow crew={item.crew} pose={item.complete ? 'idle' : 'type'}>
            <div className="msg assistant">
              <Markdown text={item.text} />
            </div>
          </CrewRow>
        ) : (
          <div className="msg assistant">
            <Markdown text={item.text} />
          </div>
        )
      );
    case 'thinking':
      return <ThinkingBlock text={item.text} open={item.open} crew={crew} />;
    case 'tool':
      return <ToolChip item={item} fresh={fresh} />;
    case 'approval':
      return (
        <div className="tool-chip approval">
          <Icon name="lock" /> {crewAsking(item.title, crew)}
          {item.decision ? ` — ${item.decision === 'deny' ? 'denied' : 'allowed'}` : ' — waiting'}
        </div>
      );
    case 'routed':
      // The dispatcher's own turn. It used to be the only line in the thread
      // with nobody's name on it, which is odd for the decision that picks who
      // does the work.
      return (
        <div className="routed-chip">
          {item.crew && <SpriteAvatar crew={item.crew} pose="idle" size={22} />}
          {item.crew && <strong style={{ color: nameColor(item.crew.color) }}>{item.crew.name}</strong>}
          {item.crew ? ' sent this to ' : <><Icon name="bolt" /> {item.tier} · routed to </>}
          {/* The crew member, not the model id: "sent this to haiku" named an
              engine where every other line in the thread names a person. The
              id stays, quieter, because which model is still worth knowing.
              Older transcripts have no worker and keep the bare id. */}
          {item.worker ? (
            <>
              <SpriteAvatar crew={item.worker} pose="idle" size={22} />
              <strong style={{ color: nameColor(item.worker.color) }}>{item.worker.name}</strong>
              <span className="routed-model"> ({item.model})</span>
            </>
          ) : (
            <strong>{item.model}</strong>
          )}
          {item.reason ? ` — ${item.reason}` : ''}
        </div>
      );
    case 'verify': {
      const r = item.report;
      return (
        <div className={`verify-msg ${r.passed ? 'pass' : 'fail'}${fresh ? ' fresh' : ''}`}>
          <div className="verify-head">
            {/* Finishing is worth something. The cheer frame has existed, shipped
                and unused, since the sprite work; this is the event it was drawn
                for. Only on a PASS — a failed gate gets no celebration, which is
                the whole point of having a gate. */}
            {r.passed && crew?.sprite && (
              <SpriteAvatar crew={crew} pose="cheer" size={30} />
            )}
            <span className="verify-badge">{r.passed ? 'PASSED' : 'FAILED'}</span> {r.summary}
          </div>
          {r.tampered && <div className="verify-tamper">Gate definitions changed during this session — this result cannot be trusted.</div>}
          {r.gates.map((g, i) => (
            <details key={i} className="verify-gate" open={g.exitCode !== 0}>
              <summary>
                <code>{g.command}</code> · exit {g.exitCode ?? '—'}{g.timedOut ? ' · timed out' : ''} · {Math.round(g.ms / 1000)}s
              </summary>
              <pre className="verify-out">{(g.exitCode === 0 ? g.stdoutTail : g.stderrTail || g.stdoutTail).slice(-1500) || '(no output)'}</pre>
            </details>
          ))}
          {r.images.map((c, i) => (
            <div key={i} className={`verify-image ${c.ok ? 'ok' : 'bad'}`}>
              {c.ok ? '✓' : '✗'} <code>{c.path}</code> · {c.reason}
            </div>
          ))}
          {r.review && (
            <div className="verify-review">
              <div className="review-strength">{r.review.strength}</div>
              <Markdown text={r.review.text} />
            </div>
          )}
        </div>
      );
    }
    case 'consult': {
      const verdict = item.phase === 'critique' ? item.text.match(/VERDICT:\s*(SOLID|NEEDS CHANGES)/i)?.[1]?.toUpperCase() : undefined;
      // Recovered 2026-09-24: "I never saw the back and forth between Ollie
      // and Nell, I only saw the output." The turns were there; they did not
      // say what they were. The phase label lived only in the no-crew
      // fallback below, so a named planner's turn read as an ordinary reply.
      const phaseLabel = item.phase === 'plan' ? 'Plan' : item.phase === 'reconcile' ? 'Reconciled plan' : 'Review';
      const badges = (
        <>
          <span className={`consult-phase ${item.phase}`}>{phaseLabel}</span>
          {verdict && <span className={`verdict-badge ${verdict === 'SOLID' ? 'solid' : 'changes'}`}>{verdict}</span>}
          {item.reviewStrength && (
            <span className="review-strength" title="How independent this reviewer is from the author">{item.reviewStrength}</span>
          )}
        </>
      );
      if (item.crew) {
        return (
          <CrewRow crew={item.crew} pose="idle" head={badges}>
            <div className={`consult-msg ${item.phase}`}>
              <Markdown text={item.text} />
            </div>
          </CrewRow>
        );
      }
      return (
        <div className={`consult-msg ${item.phase}`}>
          {/* Only a turn from before crew badges existed lands here. */}
          <div className="consult-msg-head">
            <span className={`agent-dot ${item.agent}`} />
            {item.phase === 'plan' ? 'Plan' : item.phase === 'reconcile' ? 'Reconciled plan' : 'Critique'} · {item.agent}
            {badges}
          </div>
          <Markdown text={item.text} />
        </div>
      );
    }
    case 'error':
      if (item.code === 'auth') {
        // Not a generic failure: Claude's sign-in has lapsed, and it can be fixed
        // from here. It used to read "Claude turn failed: OAuth…" and nothing else.
        return (
          <div className="msg error auth-needed">
            <strong>Claude isn&rsquo;t signed in on your Mac.</strong>
            <span>You can fix that from here.</span>
            <button className="chip compact-accept" onClick={() => window.dispatchEvent(new Event('roost:claude-signin'))}>
              Sign in to Claude
            </button>
          </div>
        );
      }
      return <div className="msg error">{item.text}</div>;
  }
}

function RenameField({ current, onRename }: { current: string; onRename: (title: string) => void }) {
  const [value, setValue] = useState(current);
  return (
    <div className="rename-row">
      <input className="rename-input" value={value} onChange={(e) => setValue(e.target.value)} maxLength={80} />
      <button className="chip" disabled={!value.trim() || value === current} onClick={() => onRename(value.trim())}>
        Save
      </button>
    </div>
  );
}

function ToolChip({ item, fresh = false }: { item: Extract<ChatItem, { kind: 'tool' }>; fresh?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const expandable = Boolean(item.expand && (item.expand.before || item.expand.after || item.expand.raw));
  return (
    <div className="tool-block">
      <button
        className={`tool-chip ${item.done ? (item.ok ? 'ok' : 'fail') : 'running'}`}
        onClick={() => expandable && setExpanded((v) => !v)}
      >
        <span className="tool-name">{item.name}</span>
        {/* Commands type themselves — the ones being issued NOW. A replayed
            transcript's commands are history and just appear. The reveal is a
            stepped clip, so each step shows whole characters, and its length is
            capped: a 400-character command must not take eight seconds to read. */}
        <span
          className={`tool-detail${fresh ? ' typing' : ''}`}
          style={fresh ? ({ '--steps': typeSteps(item.detail), '--dur': `${typeDurationMs(item.detail)}ms` } as React.CSSProperties) : undefined}
        >
          {item.detail}
        </span>
        {item.done && item.endDetail && <span className="tool-detail"> · {item.endDetail}</span>}
        {!item.done && <span className="spinner" />}
        {expandable && <span className="tool-expand-hint">{expanded ? '▴' : '▾'}</span>}
      </button>
      {expanded && item.expand && (
        <div className="tool-expand">
          {item.expand.path && <div className="preview-file-path tool-expand-path">{item.expand.path}</div>}
          {item.expand.before && <div className="preview-diff-line remove">− {item.expand.before}</div>}
          {item.expand.after && <div className="preview-diff-line add">+ {item.expand.after}</div>}
          {item.expand.raw && <pre className="tool-expand-raw">{item.expand.raw}</pre>}
        </div>
      )}
    </div>
  );
}

/** A stretch of tool calls as one line: who, and what they did in plain words.
 *
 *  Recovered 2026-09-24: "I don't care about bash and read and the actual
 *  code... how we can just consolidate that." Folded by default; the calls
 *  are behind a tap for the people who do care. While the run is still going
 *  the line names the call in progress, so folding hides no state -- the
 *  same rule as everywhere else: what is happening is always on screen. */
function ToolRun({ items, start, end, crew, replayedCount }: { items: ChatItem[]; start: number; end: number; crew?: CrewInfo; replayedCount: number }) {
  const [open, setOpen] = useState(false);
  const tools = items.slice(start, end) as Array<Extract<ChatItem, { kind: 'tool' }>>;
  const s = summarizeRun(tools);
  return (
    <div className={`tool-run${open ? ' open' : ''}${s.running ? ' running' : ''}${s.failed ? ' failed' : ''}`}>
      <button className="tool-run-row" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {crew && <SpriteAvatar crew={crew} pose={s.running ? 'type' : 'idle'} size={22} />}
        <span className="tool-run-text">
          {s.running ? (
            <>
              <span className="tool-name">{s.running.name}</span> <span className="tool-detail">{s.running.detail}</span>
              {s.text ? <span className="tool-run-sofar"> · {s.text} so far</span> : null}
            </>
          ) : (
            s.text
          )}
          {s.failed ? <span className="tool-run-failed"> · {s.failed} failed</span> : null}
        </span>
        {s.running && <span className="spinner" />}
        <span className="tool-expand-hint">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="tool-run-body">
          {tools.map((t, k) => (
            <ToolChip key={start + k} item={t} fresh={start + k >= replayedCount} />
          ))}
        </div>
      )}
    </div>
  );
}

function ThinkingBlock({ text, open, crew }: { text: string; open: boolean; crew?: CrewInfo }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="thinking" onClick={() => setExpanded((v) => !v)}>
      {crew && open && <SpriteAvatar crew={crew} pose="think" size={34} />}
      <span className="thinking-label">{open ? 'thinking…' : 'thought'}</span>
      {expanded && <div className="thinking-text">{text}</div>}
    </div>
  );
}

function Composer(props: {
  disabled: boolean;
  working: boolean;
  onInterrupt: () => void;
  onSend: (text: string, images?: UserImage[]) => boolean;
  onConsult: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<Array<UserImage & { preview: string }>>([]);
  /** A send that could not go out. The draft is kept; this says why. */
  const [unsent, setUnsent] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // The field grows with the text, like Messages, to the CSS max-height; then
  // it scrolls. Measured from the content, not counted from newlines, so a
  // long wrapped line grows it too. Reset to one line after a send.
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  function send() {
    if (!text.trim() && images.length === 0) return;
    // A send while disconnected used to clear the box into the void; now the
    // draft stays until a send actually goes out.
    const sent = props.onSend(text.trim(), images.length ? images.map(({ mediaType, data }) => ({ mediaType, data })) : undefined);
    if (!sent) {
      setUnsent(true);
      return;
    }
    setUnsent(false);
    setText('');
    setImages([]);
  }

  async function onFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      const buf = await file.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const data = btoa(binary);
      setImages((prev) => [...prev, { mediaType: file.type || 'image/png', data, preview: URL.createObjectURL(file) }]);
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="composer">
      {/* Recovered 2026-09-24: the "Working… new messages join the
          conversation as it goes" line was confusing, and its Stop sat right
          above the send arrow. The sentence is gone -- the tracker and the
          sprite say what is happening -- and Stop now lives at the far LEFT
          of the row, the whole width of the box away from Send. */}
      {images.length > 0 && (
        <div className="previews">
          {images.map((img, i) => (
            <div key={i} className="preview">
              <img src={img.preview} alt="" />
              <button onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
      )}
      {unsent && (
        <div className="composer-hint composer-unsent">
          Not connected — your message is kept here until the session reconnects.
        </div>
      )}
      <div className="composer-row">
        {props.working && (
          <button className="stop-btn" onClick={props.onInterrupt} title="Stop the current turn">
            ■ Stop
          </button>
        )}
        <button className="ghost" onClick={() => fileRef.current?.click()}>
          ＋
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
        <div className="composer-field">
          <textarea
            ref={taRef}
            value={text}
            rows={1}
            placeholder="Message…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
                e.preventDefault();
                send();
              }
            }}
          />
          {text.trim() && !props.working && (
            <button
              className="ghost consult-btn"
              title="Consult: plan first, second agent reviews, you approve"
              disabled={props.disabled}
              onClick={() => {
                props.onConsult(text.trim());
                setText('');
              }}
            >
              <Icon name="scales" size={18} />
            </button>
          )}
          <button className="primary send" disabled={props.disabled} onClick={send}>
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

/** "Claude wants to use Bash" → "Wren wants to use Bash", when a crew member is
 *  known. Only the leading vendor word is swapped, so an unfamiliar title passes
 *  through untouched rather than being mangled. */
export function crewAsking(title: string, crew?: CrewInfo | null): string {
  if (!crew?.name) return title;
  return title.replace(/^(Claude|Codex)(?=\s)/, crew.name);
}

/** One job's row, and the job folded behind it (the Chapters board).
 *
 *  A verified job folds; an open one stays open. The fold is the last of the
 *  Effects board's eight: when a job closes LIVE it collapses into its named row
 *  — after a pause long enough for the stamp and the cheer, or the celebration
 *  would be tucked out of sight the instant it happened. A job that closed
 *  before you opened the session is simply folded; replayed history does not
 *  perform. Tapping the row opens or closes it, and that choice wins over the
 *  default. Nothing here touches what the agents remember. */
function ChapterFold({ chapter, awaiting, foldingNow, children }: { chapter: Chapter; awaiting: boolean; foldingNow: boolean; children: React.ReactNode }) {
  const [choice, setChoice] = useState<boolean | null>(null); // true = open, false = folded
  const verified = chapter.status === 'verified';
  const folded = choice === null ? verified : !choice;
  const status = verified ? 'Verified' : chapter.status === 'needs-work' ? 'Needs work' : awaiting ? 'Awaiting you' : 'In progress';
  return (
    <div className={`chapter ${folded ? 'folded' : 'open'}${foldingNow && choice === null ? ' folding' : ''}`}>
      <button className="chapter-row" onClick={() => setChoice(folded)} aria-expanded={!folded}>
        <span className="chapter-faces">
          {chapter.crew.slice(0, 3).map((c) => (
            <SpriteAvatar key={c.name} crew={c} pose="idle" size={28} />
          ))}
        </span>
        <span className="chapter-text">
          <span className="chapter-name">{chapter.name}</span>
          <span className="chapter-sub">
            {chapter.crew.map((c) => c.name).join(', ') || 'You'} · {chapter.turns} turn{chapter.turns === 1 ? '' : 's'}
          </span>
        </span>
        <span className={`chapter-status ${chapter.status}${awaiting ? ' awaiting' : ''}`}>{status}</span>
        <span className="chapter-caret" aria-hidden="true">{folded ? '▸' : '▾'}</span>
      </button>
      <div className="chapter-body">
        <div className="chapter-inner">{children}</div>
      </div>
    </div>
  );
}
