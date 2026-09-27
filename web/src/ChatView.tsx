import React, { useEffect, useRef, useState } from 'react';
import { buzz } from './haptics';
import { rotFor, expiringBlocks, typeSteps, typeDurationMs, thinkBeatMs, effortWord, asleepOnIdle } from './motion';
import { nameColor } from './color';
import { chaptersOf, groupChaptersByDay, type Chapter } from './chapters';
import { trackerOf, type TrackerStep } from './tracker';
import { Icon, type IconName } from './icons';
import { segmentsOf, summarizeRun, workSegments } from './toolruns';
import { ClaudeSignIn } from './ClaudeSignIn';
import { Contained } from './ErrorBoundary';
import { openCompanion } from './CompanionSheet';
import { api } from './api';
import { fmtAgo, shortPath } from './format';
import { GitSheet } from './GitSheet';
import { DeployContext, DeploySheet } from './DeploySheet';
import { Markdown } from './Markdown';
import { useMinute } from './useMinute';
import { ImageStrip } from './ImageView';
import { LiveView } from './LiveView';
import { findImagePaths } from './imagePaths';
import { PreviewContent } from './PreviewContent';
import { useSession, type SessionState } from './useSession';
import type { ApprovalSetting, AskLevel, ChatItem, CrewInfo, Me, RoostConfigResponse, PreviewResult, SessionMeta, SessionMode, UserImage, Builder, DeploySuggestion } from './types';

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
  const [deploy, setDeploy] = useState<{ proposal?: DeploySuggestion } | null>(null);
  const [deployCommand, setDeployCommand] = useState<{ cwd: string; command: string } | null>(null);
  const cwd = session.meta?.cwd;
  useEffect(() => {
    if (!cwd || fixture) return;
    let cancelled = false;
    api.deploy(cwd).then((state) => {
      if (!cancelled) setDeployCommand(state.recipe ? { cwd, command: state.recipe.command } : null);
    }).catch(() => {
      if (!cancelled) setDeployCommand(null);
    });
    return () => { cancelled = true; };
  }, [cwd, deploy, fixture]);
  // A question from the crew, answered one at a time like texts; the answers
  // go back together once the last one is in.
  const [askDraft, setAskDraft] = useState<{ id: string; answers: Record<string, string> } | null>(null);
  const pendingQ = (() => {
    for (let i = session.items.length - 1; i >= 0; i--) {
      const it = session.items[i];
      if (it.kind === 'question') return it.answered ? null : it;
    }
    return null;
  })();
  const answerQuestion = (text: string): boolean => {
    const q = pendingQ;
    if (!q) return false;
    const draft = askDraft?.id === q.requestId ? askDraft.answers : {};
    const next = q.questions.find((x) => draft[x.question] == null);
    if (!next) return false;
    const answers = { ...draft, [next.question]: text };
    setAskDraft({ id: q.requestId, answers });
    if (q.questions.every((x) => answers[x.question] != null)) return session.send({ type: 'question_answer', requestId: q.requestId, answers });
    return true;
  };
  const skipQuestion = () => {
    if (pendingQ) session.send({ type: 'question_answer', requestId: pendingQ.requestId, answers: null });
  };
  const [showLive, setShowLive] = useState(false);
  const [recap, setRecap] = useState<PreviewResult | null>(null);
  const [recapLoading, setRecapLoading] = useState(false);
  // User-reported 2026-09-23: scrolled into the middle of a resumed session's
  // recap -- a wall of old diffs with no header in view -- and could not tell
  // it from live work, or find the actual live thread underneath it. Collapsed
  // by default: a one-line summary you open on purpose, never a wall you
  // scroll past by accident.
  const [recapOpen, setRecapOpen] = useState(false);
  // The crew, by name, for @-mentions in the composer and the handoff offer.
  // One fetch; the roster is a greeting, not a dependency.
  const [crewNames, setCrewNames] = useState<MentionTarget[]>([]);
  useEffect(() => {
    if (fixture) return;
    fetch('/api/crew')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        const seen = new Set<string>();
        const rows: MentionTarget[] = [];
        for (const p of d.crew ?? []) {
          if (seen.has(p.name)) continue;
          seen.add(p.name);
          rows.push({ name: p.name, color: p.color, sprite: p.sprite, suite: p.suite ?? 'claude', tier: p.tier, model: d.models?.[p.name] });
        }
        setCrewNames(rows);
      })
      .catch(() => {});
  }, [fixture]);
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
  // The status line's detail: remembered per phone, closed by default.
  const [stripOpen, setStripOpenState] = useState(() => {
    try { return localStorage.getItem('roost-strip-open') === '1'; } catch { return false; }
  });
  const setStripOpen = (v: boolean) => {
    setStripOpenState(v);
    try { localStorage.setItem('roost-strip-open', v ? '1' : '0'); } catch { /* per-phone nicety */ }
  };
  const [signingIn, setSigningIn] = useState(false);
  useEffect(() => {
    const open = () => setSigningIn(true);
    window.addEventListener('roost:claude-signin', open);
    return () => window.removeEventListener('roost:claude-signin', open);
  }, []);
  // "Start fresh": a new session on the same project and engine, opened in place.
  useEffect(() => {
    const fresh = async () => {
      const m = session.meta;
      if (!m) return;
      try {
        const r = await fetch('/api/sessions', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ agent: m.agent, cwd: m.cwd, title: `Fresh start — ${m.title}`.slice(0, 80) }),
        });
        const d = await r.json();
        const id = d.id ?? d.session?.id;
        if (id) onSwitch(id);
      } catch {
        /* the button stays; nothing was lost */
      }
    };
    window.addEventListener('roost:start-fresh', fresh);
    return () => window.removeEventListener('roost:start-fresh', fresh);
  }, [session.meta, onSwitch]);
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

  // 2026-09-26: "where I was on your last message was not all the way at the
  // bottom" when the keyboard opened. Being pinned re-scrolls to the bottom
  // whenever new items arrive, but the keyboard opening isn't a new item --
  // it shrinks this panel's own height (--vvh, main.tsx), which moves the
  // bottom without moving scrollTop's numeric value. Re-pin on that too.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !window.visualViewport) return;
    const onResize = () => {
      if (pinned.current) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    };
    window.visualViewport.addEventListener('resize', onResize);
    return () => window.visualViewport?.removeEventListener('resize', onResize);
  }, []);

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

  // An agent that needs you: one short tap when a NEW approval arrives, so it
  // can be felt without looking. `requestId` changing is the trigger -- the
  // same one-shot-per-arrival rule as the ring below, not a timer. iOS Safari
  // does not implement navigator.vibrate; those readers still get the visual
  // ring, and the existing ntfy push when nobody is watching.
  useEffect(() => {
    if (session.pendingApproval) buzz('approval');
  }, [session.pendingApproval?.requestId]);
  // A question is someone needing you too: the same tap, once per question.
  useEffect(() => {
    if (pendingQ) buzz('approval');
  }, [pendingQ?.requestId]);

  // A verdict you can feel: a LIVE verify buzzes pass or fail with its own
  // pattern (haptics.ts). Keyed on the verify's index past replay, so history
  // never buzzes and each new verdict buzzes once.
  const lastVerify = (() => {
    for (let i = session.items.length - 1; i >= session.replayedCount; i--) {
      const it = session.items[i];
      if (it.kind === 'verify') return { i, passed: it.report.passed };
    }
    return null;
  })();
  useEffect(() => {
    if (lastVerify) buzz(lastVerify.passed ? 'pass' : 'fail');
  }, [lastVerify?.i]);

  const agent = session.meta?.agent ?? 'claude';
  const agentConfig = config[agent];
  const isAuto = session.meta?.model === 'auto';
  const activeModelId = isAuto ? session.meta?.routedModel : session.meta?.model;
  const isCurrentModel = (m: { id: string; resolvedModel?: string }) =>
    activeModelId === m.id || (!!m.resolvedModel && activeModelId === m.resolvedModel);
  const concreteLabel = agentConfig.models.find(isCurrentModel)?.label ?? activeModelId;
  const currentModelLabel = isAuto ? `Auto → ${concreteLabel ?? '…'}` : concreteLabel ?? 'default';

  return (
    <DeployContext.Provider value={{ open: (proposal) => setDeploy({ proposal }) }}>
    <AskContext.Provider value={{ draft: askDraft, answer: answerQuestion, skip: skipQuestion, crew: session.meta?.crew, me }}>
    <ApprovalContext.Provider value={(requestId, decision) => session.send({ type: 'approval_response', requestId, decision })}>
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
              {/* The badge says what the NEXT message does (item 36). A name you
                  asked for sticks and goes straight to them, around plan and
                  build -- so "PLAN" while Ollie edits files was a lie. */}
              {session.meta?.sticky ? (
                <span className="mode-tag direct" title={`Messages go straight to ${session.meta.sticky}; the ${session.meta.mode ?? 'session'} mode is not applied until you clear them.`}>with {session.meta.sticky}</span>
              ) : session.meta?.mode ? (
                <span className={`mode-tag ${session.meta.mode}`}>{session.meta.mode}</span>
              ) : null}{' '}
              {/* Who, on what, at what effort is on every reply now; the line
                  keeps only what the next message does (2026-09-25). */}
              {!session.connected && <span className="chat-title-warn">reconnecting…</span>}
            </div>
          </div>
        </button>
        {session.meta && (
          <button className="ghost" onClick={() => setDeploy({})} title={deployCommand && deployCommand.cwd === cwd ? `Deploy: ${deployCommand.command}` : 'Set up deploy'}>
            <Icon name="rocket" size={22} />
            <span className="hdr-label">Deploy</span>
          </button>
        )}
        <button className="ghost git-btn" onClick={() => setShowGit(true)} title="Changes (git)">
          <Icon name="github" size={22} />
          <span className="hdr-label">Changes</span>
        </button>
        {session.meta && (
          <button className="ghost" onClick={() => setShowLive(true)} title="Live preview">
            <Icon name="eye" size={20} />
            <span className="hdr-label">Preview</span>
          </button>
        )}
        <button className="ghost" onClick={() => setShowSettings(true)} aria-label="Session settings">
          <Icon name="gear" size={22} title="Session settings" />
          <span className="hdr-label">Settings</span>
        </button>
      </header>

      {showLive && session.meta && <LiveView cwd={session.meta.cwd} onClose={() => setShowLive(false)} onAsk={(text) => session.send({ type: 'user_message', text })} crewName={session.meta?.crew?.name} />}

      {deploy && session.meta && (
        <DeploySheet
          cwd={session.meta.cwd}
          proposal={deploy.proposal}
          onAsk={(text) => session.send({ type: 'user_message', text })}
          crewName={session.meta?.crew?.name}
          onClose={() => setDeploy(null)}
        />
      )}

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

      {/* One status line, not six bars (item 35, 2026-09-25): header, Spend-it,
          full auto, a raw token line, the context bar and the tracker stacked
          until the conversation started 40% down the screen. The line carries
          what matters at a glance; a tap opens the detail that was always there. */}
      <StatusStrip session={session} open={stripOpen} onToggle={() => setStripOpen(!stripOpen)} />
      {stripOpen && (
        <div className="status-detail">
        {session.meta?.surplus && !session.meta.boost && <SpendIt surplus={session.meta.surplus} onBoost={() => session.send({ type: 'set_boost', on: true })} />}
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
            {/* Plain words (2026-09-27 audit: "63.4M in · 187.4k out"). */}
            This chat so far: {fmtTokens(session.usage.inputTokens)} read · {fmtTokens(session.usage.outputTokens)} written
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
              Context {session.context.overLimit?.kind === 'hard_limit' ? 'over this model’s window' : session.context.percent != null ? `${session.context.percent}%` : 'no data'}
              {session.context.usedTokens != null && session.context.maxTokens != null
                ? ` · ${fmtTokens(session.context.usedTokens)} of ${fmtTokens(session.context.maxTokens)}`
                : ''}
              {PRESSURE_WORDS[session.context.pressure] ? ` · ${PRESSURE_WORDS[session.context.pressure]}` : ''}
              {session.context.overLimit ? ` · ${fmtTokens(session.context.overLimit.tokensOver)} over the ${session.context.overLimit.kind === 'hard_limit' ? 'hard limit' : 'compaction window'}` : ''}
            </span>
            {session.context.advice && (
              <span className="context-advice">{ADVICE_WORDS[session.context.advice.action] ?? session.context.advice.reason}</span>
            )}
            {/* The third rung (Context board): hand off at 80%, a different
                decision from compacting, so it asks on its own. */}
            {session.context.pressure === 'critical' && (() => {
              // The handoff, offered where the meter says it is time: the other
              // vendor's flagship is briefed from the plan and the thread and
              // continues with a fresh window (§4c).
              const other = crewNames.find((c) => c.suite !== agent && c.tier === 'flagship') ?? crewNames.find((c) => c.suite !== agent);
              if (!other) return null;
              return (
                <button className="context-handoff" onClick={() => session.send({ type: 'context_action', action: 'handoff', to: other.name })}>
                  Hand off to {other.name}
                </button>
              );
            })()}
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
        {/* Computing the chapters can itself throw (it did, all day); inside
            Contained, that costs the transcript, not the header and composer. */}
        <Contained what="The conversation" retryOn={session.items.length}>{() => {
          // The thread folded into the jobs it did (the Chapters board). One job
          // renders as a plain conversation; with more than one, each gets its
          // named row, and a verified job folds into it.
          const chapters = chaptersOf(session.items);
          const many = chapters.length > 1;
          // Day and week rows (§12d), the last gap MOTION.md §7 named once its
          // real blocker (transcripts not surviving a restart) was fixed: a
          // header only when the thread actually crosses into a new bucket --
          // a single day of work, which is most threads, shows none of this.
          const groups = many ? groupChaptersByDay(chapters, Date.now()) : [];
          const showDayRows = groups.length > 1;
          let chapterIndex = -1;
          return groups.length
            ? groups.map((g) => (
                <React.Fragment key={g.key}>
                  {showDayRows && <div className="day-row">{g.label}</div>}
                  {g.chapters.map((ch) => {
                    chapterIndex++;
                    return renderChapter(ch, chapterIndex);
                  })}
                </React.Fragment>
              ))
            // Zero or one job: render what there is. This used to render the FIRST chapter
            // unconditionally, which read `.start` off undefined for a session with no messages yet — a
            // new session, or every session after a restart — and crashed the whole
            // chat view. The phone could list its sessions but not open one, all day.
            : chapters.map((ch, ci) => renderChapter(ch, ci));

          function renderChapter(ch: Chapter, ci: number) {
            // Consecutive tool calls fold into one line (toolruns.ts); every
            // other item is its own row, as before.
            // Work folds into one card per stretch (the work stream): what the
            // crew said on the way and the calls between them, behind their
            // latest line. The live tail stays in the card until the turn ends.
            const liveTail = ci === chapters.length - 1 && session.status === 'working';
            const rows = workSegments(session.items, ch.start, ch.end, liveTail).map((seg) =>
              seg.kind === 'work' ? (
                <Contained key={`work-${seg.start}`} what="This work">
                  <WorkStream items={session.items} start={seg.start} end={seg.end} crew={session.meta?.crew} live={liveTail && seg.end === ch.end} replayedCount={session.replayedCount} />
                </Contained>
              ) : seg.kind === 'item' ? (
                <Contained key={seg.index} what="This message" retryOn={session.items[seg.index]}>
                  <Message item={session.items[seg.index]} crew={session.meta?.crew} chapterCrew={ch.crew} me={me} fresh={seg.index >= session.replayedCount} aside={isNarration(session.items, seg.index, ch.end)} asking={awaitingReply(session.items, seg.index, session.status)} />
                </Contained>
              ) : (
                <Contained key={`run-${seg.start}`} what="These tool calls">
                  <ToolRun items={session.items} start={seg.start} end={seg.end} crew={session.meta?.crew} replayedCount={session.replayedCount} />
                </Contained>
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
          }
        }}</Contained>
        {/* The two questions the crew ask you in person (Control and Context
            boards): in the thread, from whoever is asking, where the reply
            would have been -- not as a bar pinned above the work. */}
        {session.meta?.escalation && (
          <PipProposes
            offer={session.meta.escalation}
            onAnswer={(go) => session.send({ type: 'escalation_response', go })}
          />
        )}
        {session.meta?.contextOffer && session.meta.crew && (
          <CompactAsk
            crew={session.meta.crew}
            percent={session.context?.percent ?? session.meta.contextOffer.percent}
            keep={keepCompacting}
            onKeep={setKeepCompacting}
            onCompact={() => session.send({ type: 'context_action', action: 'compact', remember: keepCompacting })}
            onNotYet={() => session.send({ type: 'context_dismiss' })}
          />
        )}
        {/* `triaging` is set locally on tap, before the server has said
            anything -- so it must show the indicator on its own, not wait for
            status to read 'working'. That wait was the reported dead air. */}
        {(session.triaging || session.status === 'working') && !session.closedReason && !pendingQ && !session.pendingApproval && !typingNow(session.items) && !(!session.triaging && liveWorkCard(session.items, session.status)) && (
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
            {session.meta.planHasRemainder && (
              <button className="link" disabled={proceeding} title="The plan says it will not all fit; keep the rest in the project's ROADMAP.md" onClick={() => session.send({ type: 'park_remainder' })}>
                Park the remainder
              </button>
            )}
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
        <>
        {session.meta?.sticky && (
          <div className="sticky-chip-row">
            <span className="sticky-chip">
              With <b>{session.meta.sticky}</b> — messages go to them until you clear this
              <button className="sticky-clear" aria-label="Clear: send to Pip again" onClick={() => session.send({ type: 'set_sticky', name: null })}>
                ✕
              </button>
            </span>
          </div>
        )}
        <Composer
          disabled={!session.connected}
          working={session.status === 'working'}
          onInterrupt={() => session.send({ type: 'interrupt' })}
          onSend={(text, images) => {
            // A question waiting on you: what you text back is the answer.
            if (pendingQ && text.trim()) return answerQuestion(text.trim());
            return session.send({ type: 'user_message', text, images });
          }}
          placeholder={pendingQ ? `Reply to ${pendingQ.crew?.name ?? session.meta?.crew?.name ?? 'the crew'}…` : undefined}
          onConsult={(text) => session.send({ type: 'consult', text })}
          crew={crewNames}
        />
        </>
      )}

      {signingIn && <ClaudeSignIn onClose={() => setSigningIn(false)} />}

      {showSettings && session.meta && (
        <div className="sheet-backdrop" onClick={() => setShowSettings(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>Session settings</h3>
            {/* 2026-09-27: eight rows and ~30 buttons, where mode, "before
                building" and effort all answered one question -- how careful
                should the crew be? One choice now; the full set is in Fine-tune. */}
            {session.meta.sticky && (
              <div className="settings-sticky">
                <span>You're talking straight to <b>{session.meta.sticky}</b>, so the choice below waits until you hand back.</span>
                <button className="chip" onClick={() => session.send({ type: 'set_sticky', name: null })}>Hand back to Pip</button>
              </div>
            )}
            <div className="field">
              <label>How should the crew work?</label>
              <div className="presets">
                {PRESETS.map((p) => {
                  const active = presetOf(session.meta!) === p.key;
                  return (
                    <button key={p.key} className={`preset${active ? ' active' : ''}`} onClick={() => applyPreset(p, session.send)}>
                      <span className="preset-name">{p.name}</span>
                      <span className="preset-says">{p.says}</span>
                    </button>
                  );
                })}
              </div>
              {presetOf(session.meta) === 'custom' && <div className="field-hint">Custom — you've changed things in Fine-tune. Pick one above to go back to a preset.</div>}
            </div>
            <div className="field">
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={session.meta.approvals === 'ask'}
                  onChange={(e) => session.send({ type: 'set_approvals', approvals: e.target.checked ? 'ask' : 'auto-edits' })}
                />
                <span>
                  Ask before changing files
                  <span className="field-hint">
                    {session.meta.approvals === 'ask' ? 'They ask in the chat before editing files or running commands.'
                      : session.meta.approvals === 'full-auto' ? 'Full auto is on (in Fine-tune): nothing asks.'
                      : 'File edits go ahead; commands still ask first.'}
                  </span>
                </span>
              </label>
            </div>
            <details className="fine-tune">
              <summary>Fine-tune</summary>
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
              {/* How much they talk it over with you first (2026-09-25). Every
                  level is still just texting -- one question at a time. */}
              <label>Before building</label>
              <div className="chips">
                {ASK_CHOICES.map(([value, label, title]) => (
                  <button
                    key={value}
                    title={title}
                    className={(session.meta!.ask ?? 'quick') === value ? 'chip active' : 'chip'}
                    onClick={() => session.send({ type: 'set_ask', ask: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="field-hint">{ASK_CHOICES.find(([v]) => v === (session.meta!.ask ?? 'quick'))?.[2]}</div>
            </div>
            <div className="field">
              <label>Who builds</label>
              <div className="chips">
                {(
                  [
                    ['auto', 'Auto', 'The vendor with more headroom builds a consulted plan'],
                    ['claude', 'Claude', 'Claude always builds'],
                    ['codex', 'Codex', 'Codex always builds'],
                  ] as Array<[Builder, string, string]>
                ).map(([value, label, title]) => (
                  <button
                    key={value}
                    title={title}
                    className={(session.meta!.builder ?? 'auto') === value ? 'chip active' : 'chip'}
                    onClick={() => session.send({ type: 'set_builder', builder: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="section-hint">A consulted plan is built by this vendor. The other vendor builds as a one-shot briefed with the plan; the gates run on it the same way.</p>
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
                {uniqueModels(agentConfig.models).map((m) => (
                  <button
                    key={m.id}
                    title={m.label}
                    className={`${!isAuto && isCurrentModel(m) ? 'chip active' : 'chip'} model-chip`}
                    onClick={() => session.send({ type: 'set_model', model: m.id })}
                  >
                    {/* Clean names here too; the context size is this
                        picker's detail, said once, under the name. */}
                    <span className="model-chip-name">{modelName(m.resolvedModel ?? m.id)}</span>
                    {(contextWords(m.id) ?? contextWords(m.resolvedModel)) || m.id === 'default' ? (
                      <span className="model-chip-sub">
                        {[contextWords(m.id) ?? contextWords(m.resolvedModel), m.id === 'default' ? 'default' : null].filter(Boolean).join(' · ')}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
              {/* A session runs on one vendor; the other vendor's crew is a
                  message away. Said here, where "where are the Codex models?"
                  was asked (2026-09-24). */}
              {crewNames.some((c) => c.suite !== agent) && (
                <p className="section-hint">
                  {agent === 'claude' ? 'Codex' : 'Claude'} crew: ask them by name in the message box —{' '}
                  {crewNames.filter((c) => c.suite !== agent).map((c) => `@${c.name}`).join(', ')}. They answer in this thread.
                </p>
              )}
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
              <div className="field-hint">
                {session.meta.approvals === 'full-auto'
                  ? 'They run commands and change files without asking. Anything they ask you is still a question in the chat.'
                  : session.meta.approvals === 'auto-edits'
                    ? 'File edits go ahead; commands and anything else ask you first, in the chat.'
                    : 'They ask in the chat before running commands or changing files.'}
              </div>
            </div>
            </details>
            <div className="field">
              <label>Session name</label>
              <RenameField current={session.meta.title} onRename={(title) => session.send({ type: 'set_title', title })} />
            </div>
            <div className="field">
              <label>Project folder</label>
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
    </ApprovalContext.Provider>
    </AskContext.Provider>
    </DeployContext.Provider>
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
export type Pose = 'idle' | 'type' | 'think' | 'blink' | 'cheer' | 'peek' | 'sleep' | 'sit' | 'side' | 'hold' | 'dance' | PhasePose;
/** The phase bar's poses (2026-09-25): two drawings each -- looking through a
 *  magnifying glass, writing on a clipboard, reading a page, hammering, a
 *  flask. A character without them yet falls back to typing. */
export type PhasePose = 'look' | 'plan' | 'review' | 'build' | 'test';
const PHASE_POSES = new Set<string>(['look', 'plan', 'review', 'build', 'test']);

/** Four drawings per working pose (item 38): the pose's own frame, then the
 *  three drawn for it -- left paw, right paw, a pause to read back; tilt one
 *  way, the other, then the idea. Played in order, one at a time. */
const WORK_FRAMES: Record<'type' | 'think', string[]> = {
  type: ['type', 'type2', 'type3', 'type4'],
  think: ['think', 'think2', 'think3', 'think4'],
};

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
/** A stable per-name 0..1, so each member keeps their own rhythm and a crew
 *  of six never blinks in unison. */
export function nameSeed(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/** Idle, alive (2026-09-27: "the crew is frozen"): the crew breathe, blink and
 *  now and then glance aside, from their own drawn idle/blink/side frames --
 *  only where they're standing around (the home screen, a chat's crew line),
 *  never on a message in the thread, where stillness keeps the work readable.
 *  Exactly one drawing shows at a time; a missing frame just never shows. */
function AliveSprite({ crew, size, className }: { crew: CrewInfo; size: number; className?: string }) {
  const [missing, setMissing] = useState<Record<string, true>>({});
  const seed = nameSeed(crew.name);
  const base = `/crew/${crew.sprite}`;
  const style = {
    width: size,
    height: size,
    '--cycle': `${12 + seed * 6}s`,
    '--offset': `${-seed * 18}s`,
    '--breath': `${3 + seed * 1.4}s`,
    '--lift': `${Math.max(1, Math.round(size / 28))}px`,
  } as React.CSSProperties;
  return (
    <span className={`crew-sprite pose-idle alive${missing.blink ? ' no-blink' : ''}${missing.side ? ' no-side' : ''}${className ? ` ${className}` : ''}`} data-agent={crew.agent} style={style}>
      <img className="alive-idle" src={`${base}-idle.webp`} alt="" />
      {!missing.blink && <img className="alive-blink" src={`${base}-blink.webp`} alt="" onError={() => setMissing((m) => ({ ...m, blink: true }))} />}
      {!missing.side && <img className="alive-side" src={`${base}-side.webp`} alt="" onError={() => setMissing((m) => ({ ...m, side: true }))} />}
    </span>
  );
}

export function SpriteAvatar({ crew, pose, size, className, alive }: { crew: CrewInfo; pose: Pose; size: number; className?: string; alive?: boolean }) {
  const [failed, setFailed] = useState(false);
  // A working pose plays four drawings (item 38) when all four are drawn;
  // until then -- or if one fails to load -- the original two-frame cut.
  const [short, setShort] = useState(false);
  const [noPhase, setNoPhase] = useState(false);
  if (!crew.sprite || failed) return <CrewAvatar crew={crew} size={size} />;
  if (alive && pose === 'idle') return <AliveSprite crew={crew} size={size} className={className} />;
  if (PHASE_POSES.has(pose)) {
    if (noPhase) pose = 'type';
    else {
      const b = `/crew/${crew.sprite}`;
      return (
        <span className={`crew-sprite pose-${pose} phase moving${className ? ` ${className}` : ''}`} data-agent={crew.agent} style={{ width: size, height: size }}>
          <img className="frame-a" src={`${b}-${pose}1.webp`} alt="" onError={() => setNoPhase(true)} />
          <img className="frame-b" src={`${b}-${pose}2.webp`} alt="" onError={() => setNoPhase(true)} />
        </span>
      );
    }
  }
  const moving = pose === 'type' || pose === 'think';
  const base = `/crew/${crew.sprite}`;
  if (moving && !short) {
    return (
      <span className={`crew-sprite four pose-${pose} moving${className ? ` ${className}` : ''}`} data-agent={crew.agent} style={{ width: size, height: size }}>
        {WORK_FRAMES[pose as 'type' | 'think'].map((f, i) => (
          <img key={f} className={`f${i}`} src={`${base}-${f}.webp`} alt="" onError={() => (i === 0 ? setFailed(true) : setShort(true))} />
        ))}
      </span>
    );
  }
  // Exactly ONE drawing visible at any moment. The frames are transparent, so a
  // frame stacked over another does not hide it — the first version kept idle
  // drawn underneath and a typing owl had four wings. A two-frame pose now
  // alternates both frames in antiphase; a held pose draws only itself.
  return (
    <span className={`crew-sprite pose-${pose}${moving ? ' moving' : ''}${className ? ` ${className}` : ''}`} data-agent={crew.agent} style={{ width: size, height: size }}>
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

const CONFETTI_COLOURS = ['lamp', 'claude', 'codex', 'pass', 'lamp', 'claude', 'codex', 'paper'] as const;

/** A handful of pixels in the crew's own colours, rising off the verdict and
 *  fading, once. The board's one unprompted moment ("Finishing is worth
 *  something") -- earned because a whole job just verified, never decoration.
 *  Pure CSS, `aria-hidden`, gone under reduced motion. */
/** A deterministic 0..1 per piece and channel: every burst looks hand-thrown,
 *  and the same burst every time (tests and screenshots can rely on it). */
const scatter = (i: number, ch: number) => {
  const x = Math.sin(i * 12.9898 + ch * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const CONFETTI_PIECES = Array.from({ length: 26 }, (_, i) => ({
  colour: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length],
  x: Math.round((scatter(i, 1) - 0.5) * 320),
  y: -Math.round(70 + scatter(i, 2) * 120),
  r: Math.round(scatter(i, 3) * 720 - 360),
  d: Math.round(scatter(i, 4) * 220),
  w: 4 + Math.round(scatter(i, 5) * 4),
  h: scatter(i, 6) > 0.6 ? 10 : 4 + Math.round(scatter(i, 7) * 4),
}));

/** 2026-09-27 audit: the old confetti was five 5px dots rising 26px -- filmed
 *  frame by frame, you could barely find it. This is a burst: two dozen
 *  pixels thrown up and out from the verdict, falling back under their own
 *  weight. Still once, still only for a pass that arrived live. */
function Confetti() {
  return (
    <span className="confetti" aria-hidden="true">
      {CONFETTI_PIECES.map((p, i) => (
        <i
          key={i}
          className={`confetti-piece ${p.colour}`}
          style={{ '--x': `${p.x}px`, '--y': `${p.y}px`, '--r': `${p.r}deg`, '--d': `${p.d}ms`, width: p.w, height: p.h } as React.CSSProperties}
        />
      ))}
    </span>
  );
}

/** "Spend it before it resets" (redesigned 2026-09-24): only when a WEEKLY
 *  window resets within a day with over 30% unused, with every weekly window
 *  shown -- for Claude, all-models and Fable -- and a countdown that goes
 *  down on its own. The blocks that would expire unused pulse; the pulse
 *  ends when its cause does (the window resets, or you take the boost). */
function SpendIt({ surplus, onBoost }: { surplus: NonNullable<SessionMeta['surplus']>; onBoost: () => void }) {
  const now = useMinute(true);
  const minutes = surplus.resetsAt ? Math.max(0, Math.round((surplus.resetsAt - now) / 60_000)) : surplus.minutesLeft;
  return (
    <div className="surplus-bar spend-it">
      <span className="expiry-blocks" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={`expiry-block${i >= 10 - expiringBlocks(surplus.headroomPct) ? ' expiring' : ''}`} />
        ))}
      </span>
      <div className="spend-it-text">
        <span>
          Spend it before it resets — {surplus.headroomPct}% of your {surplus.label} vanishes in {fmtMinutes(minutes)}.
        </span>
        {surplus.weekly && surplus.weekly.length > 0 && (
          <span className="spend-it-weekly">
            {surplus.weekly.map((w) => `${w.label}: ${w.usedPercent != null ? `${w.usedPercent}% used` : 'no data'}`).join(' · ')}
          </span>
        )}
      </div>
      <button className="chip" onClick={onBoost}>
        Use the good models
      </button>
    </div>
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
  const seenStates = useRef<{ job: string; states: Record<string, string> } | null>(null);
  // Sleeping on idle (§12a): a minute tick, only while idle -- the one clock
  // the motion doctrine allows, because the quiet IS the state.
  const now = useMinute(session.status === 'idle');
  const lastTs = Math.max(session.openedAt, session.items.length ? session.items[session.items.length - 1].ts : 0);
  const asleep = asleepOnIdle(lastTs, now, session.status);
  const t = trackerOf({
    items: session.items,
    mode: session.meta?.mode,
    working: session.status === 'working' || session.triaging,
    statusMessage: session.statusMessage,
    consultPending: !!session.meta?.consultPending,
    approvalPending: !!session.pendingApproval || session.items.some((it) => it.kind === 'question' && !it.answered),
  });
  // Where they stand on the path: the phase happening now, or how it ended.
  const at = walkerAt(t);
  // They walk to the next stop when the phase really changes: `walk` is set
  // from the change itself and cleared by the walk's own transitionend --
  // no timer. On opening a thread they are simply standing there.
  const prevAt = useRef<number | null>(null);
  const [walk, setWalk] = useState<{ from: number; to: number } | null>(null);
  useEffect(() => {
    if (at >= 0 && prevAt.current != null && prevAt.current >= 0 && prevAt.current !== at) setWalk({ from: prevAt.current, to: at });
    prevAt.current = at;
  }, [at, t?.name]);
  if (!t) return null;
  // A finished beat for a plain chat turn (2026-09-24): "a plain-chat turn
  // that ends after real work has no finished beat at all." The trigger is
  // the same evidence the tracker uses -- Done, and the job's last item is
  // newer than replay (it just happened in THIS session) -- never a timer.
  // Keyed on endIndex, so it plays once per finish and replays on the next.
  const doneStep = t.steps.find((s) => s.key === 'done');
  // A turn that finished -- proven (Done) or handed back (Your turn).
  const justFinished = (doneStep?.state === 'done' || doneStep?.state === 'awaiting') && !session.triaging && session.status !== 'working' && t.endIndex > session.replayedCount;
  // One-shot beats on real change only (the Effects board): a segment whose
  // state differs from how this job looked when it was first seen gets `just`,
  // and is keyed by its state, so it plays once when the state changes and
  // never on opening a thread. The snapshot resets when a new job starts.
  if (!seenStates.current || seenStates.current.job !== t.name) {
    seenStates.current = { job: t.name, states: Object.fromEntries(t.steps.map((s) => [s.key, s.state])) };
  }
  const first = seenStates.current.states;
  const landing = justFinished && (t.outcome === 'verified' || t.outcome === 'failed');
  const n = t.steps.length;
  // Whoever is on the job: the last to speak, else the session's own member --
  // so the path is never empty while the work has started but nobody has said
  // anything yet (2026-09-25: "the character wasn't visible... then all of a
  // sudden they were").
  const walker = t.who ?? session.meta?.crew;
  const skippedTest = t.outcome === 'yours' && t.steps.some((s) => s.key === 'test' && s.state === 'todo');
  const pose: Pose = walk ? 'side'
    : justFinished ? (t.outcome === 'failed' ? 'think' : 'cheer')
    : session.status === 'working' ? (t.steps[at]?.state === 'awaiting' ? 'peek' : (t.steps[at]?.key && t.steps[at].key !== 'done' ? t.steps[at].key as PhasePose : 'type'))
    : asleep ? 'sleep'
    : t.outcome === 'yours' ? 'peek' : 'idle';
  const label = (st: TrackerStep, k: number): string => {
    // A gap to know about, not a failure (2026-09-27 audit: red "Not tested"
    // on ordinary turns read like something broke).
    if (st.key === 'test' && skippedTest) return 'Unchecked';
    if (st.key === 'done') return t.outcome === 'verified' ? 'Verified' : 'Done';
    if (st.state === 'failed') return 'Failed';
    if (k === at && (st.state === 'active' || st.state === 'awaiting') && session.status === 'working') return t.headline.word;
    return st.label;
  };
  return (
    <div className={`job-tracker ${t.status} outcome-${t.outcome ?? 'live'}`} aria-label={`Job: ${t.name}. ${t.headline.word}`}>
      {/* One line: the job, and what it is on right now. The path below says
          where it is, so nothing here repeats it (2026-09-25). */}
      <div className="trail-line">
        <span className="trail-job">{t.name}</span>
      </div>
      {/* A plain answer with no work behind it has no path to walk. */}
      {n > 1 && (
      <ol className="trail" style={{ '--n': n, '--at': at } as React.CSSProperties}>
        {t.steps.map((st, k) => (
          <li
            key={`${st.key}:${st.state}`}
            className={`stop k-${st.key} ${st.key === 'test' && skippedTest ? 'skipped' : st.state}${k === at ? ' here' : ''}${first[st.key] !== st.state ? ' just' : ''}${st.state === 'active' ? ' working' : ''}`}
          >
            <span className="stop-mark"><Icon name={STOP_ICON[st.key]} size={12} /></span>
            <span className="stop-label">{label(st, k)}</span>
          </li>
        ))}
        {walker?.sprite && (
          <li
            className={`walker${walk ? ' walking' : ''}${walk && walk.to < walk.from ? ' leftward' : ''}`}
            onTransitionEnd={(e) => { if (e.propertyName === 'left') setWalk(null); }}
            aria-hidden="true"
          >
            <SpriteAvatar key={justFinished ? `f${t.endIndex}` : 'w'} crew={walker} pose={pose} size={30} className={justFinished && !walk ? 'tracker-cheer' : undefined} />
            {/* Your turn is said once: by them, to you. */}
            {t.outcome === 'yours' && !walk && <span className="walker-says">your turn</span>}
          </li>
        )}
        {(t.outcome === 'verified' || t.outcome === 'failed') && (
          <li key={`stamp-${t.endIndex}`} className={`tracker-stamp ${t.outcome}${landing ? ' land' : ''}`} aria-hidden="true">
            {t.outcome === 'verified' ? 'VERIFIED' : 'FAILED'}
            {landing && t.outcome === 'verified' && (
              <span className="stamp-confetti">{[0, 1, 2, 3, 4, 5].map((c) => <span key={c} />)}</span>
            )}
          </li>
        )}
      </ol>
      )}
    </div>
  );
}

/** The stop they stand at: the phase happening now, or how the job ended. */
function walkerAt(t: ReturnType<typeof trackerOf>): number {
  if (!t) return -1;
  const n = t.steps.length;
  if (t.outcome === 'verified' || t.outcome === 'yours') return n - 1;
  if (t.outcome === 'failed') return Math.max(0, t.steps.findIndex((s) => s.key === 'test'));
  const live = t.steps.findIndex((s) => s.state === 'active' || s.state === 'awaiting' || s.state === 'failed');
  if (live >= 0) return live;
  let last = 0;
  t.steps.forEach((s, k) => { if (s.state === 'done') last = k; });
  return last;
}

const STOP_ICON: Record<TrackerStep['key'], IconName> = { look: 'lens', plan: 'scroll', review: 'eye', build: 'hammer', test: 'flask', done: 'flag' };

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
/** True for a crew line followed by more tool work before you speak again:
 *  said on the way, not the answer. Pure of the items. */
export function isNarration(items: ChatItem[], i: number, end: number): boolean {
  if (items[i]?.kind !== 'assistant') return false;
  for (let j = i + 1; j < end; j++) {
    const k = items[j].kind;
    if (k === 'user' || k === 'verify' || k === 'consult') return false;
    if (k === 'tool') return true;
  }
  return false;
}

/** "Ollie is running a command…" -- from the last item alone, no guessing. */
function doingNow(name: string, last: ChatItem | undefined): string {
  if (last?.kind === 'tool' && !last.done) {
    const n = last.name.toLowerCase();
    if (/edit|write|patch|create|delete|rename|notebook/.test(n)) return `${name} is editing a file…`;
    if (/bash|exec|command|shell|run|terminal/.test(n)) return `${name} is running a command…`;
    if (/read|grep|glob|search|list|find|cat|view|fetch/.test(n)) return `${name} is reading…`;
    return `${name} is using ${last.name}…`;
  }
  if (last?.kind === 'assistant' && !last.complete) return `${name} is writing…`;
  return `${name} is thinking…`;
}

function WorkingIndicator({ session }: { session: SessionState }) {
  const last = session.items[session.items.length - 1];
  const producing = (last?.kind === 'assistant' && !last.complete) || (last?.kind === 'tool' && !last.done);
  const crew = session.triaging ? PIP : session.meta?.crew ?? PIP;
  const pose: Pose = !session.triaging && producing ? 'type' : 'think';
  // Local copy, so it shows without waiting on the server's matching status.
  // Never a face with no words (item 36): when the server has not said what
  // is happening, the thread's last item does.
  const text = session.triaging ? 'Pip is picking who takes this…' : session.statusMessage ?? doingNow(crew.name, last);
  // Effort, visible (§12a): the think beat slows with the effort the session
  // is set to -- `xhigh` sits with it, `low` fidgets. Pip's triage is always
  // quick and is not the session's effort, so it keeps the house beat.
  const effort = session.triaging || pose !== 'think' ? '' : session.meta?.effort ?? '';
  const word = effortWord(effort);
  return (
    <div className="working-indicator" data-crew={crew.name} data-effort={effort || undefined} style={{ '--beat': `${thinkBeatMs(effort)}ms` } as React.CSSProperties}>
      <SpriteAvatar crew={crew} pose={pose} size={32} />
      {text && <span className="working-text">{text}{word ? <span className="working-effort"> · {word}</span> : null}</span>}
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
  // Once everyone is up (each rises 220ms after the one before), they stop
  // holding one drawing and start living: breathing, blinking, glancing.
  const [woke, setWoke] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWoke(true), 900 + drawn.length * 220 + 150);
    return () => clearTimeout(t);
  }, [drawn.length]);
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
          {woke ? (
            <span className="crew-wake-frames lived"><SpriteAvatar crew={c} pose="idle" size={56} alive /></span>
          ) : (
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
          )}
          <span className="crew-wake-name" style={{ color: nameColor(c.color) }}>{c.name}</span>
        </span>
      ))}
    </div>
  );
}

/** A handoff between vendors (§12a): the one stepping back and the one
 *  stepping in, on one line, so the pass is seen rather than inferred from a
 *  new face appearing. Live, the outgoing member steps back and dims while the
 *  incoming one steps forward -- one move each, then both hold, because the
 *  handoff has happened and stays happened. Replayed, the line is static: the
 *  pass was yesterday's news. */
function HandoffPass({ from, to, fresh }: { from: CrewInfo; to: CrewInfo; fresh: boolean }) {
  return (
    <div className={`handoff-pass${fresh ? ' live' : ''}`} aria-label={`${from.name} handed off to ${to.name}`}>
      <span className="handoff-from">
        <SpriteAvatar crew={from} pose="idle" size={28} />
        <span style={{ color: nameColor(from.color) }}>{from.name}</span>
      </span>
      <span className="handoff-arrow" aria-hidden="true">→</span>
      <span className="handoff-to">
        <SpriteAvatar crew={to} pose="idle" size={28} />
        <span style={{ color: nameColor(to.color) }}>{to.name}</span>
      </span>
      <span className="handoff-why">picks it up with a fresh window</span>
    </div>
  );
}

/** "claude-opus-5-5[1m]" -> "Opus 5.5 1M", "gpt-5.6-sol" -> "GPT-5.6 Sol". */
/** The model and its version, and nothing else (2026-09-25): "Opus 5.5",
 *  not "claude-opus-5-5[1m] · Chat". The context size is a setting's detail;
 *  it lives with the model picker (contextWords). */
/** One tile per real model (2026-09-27: "two Claude Opus 5.5 tiles, both
 *  highlighted" -- "Default" and "Opus (1M context)" resolve to the very same
 *  model on that Mac). The first entry wins, so "Default" stays: it follows
 *  the CLI if its default ever moves. */
export function uniqueModels<T extends { id: string; resolvedModel?: string }>(models: T[]): T[] {
  const seen = new Set<string>();
  return models.filter((m) => {
    const key = m.resolvedModel ?? m.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The context meter's words for people, not for the router (2026-09-27 audit:
 *  "dispatch: context 44% full — send read-heavy work to a subagent"). */
const PRESSURE_WORDS: Record<string, string> = { clear: '', filling: 'filling up', degrading: 'getting crowded', critical: 'nearly full' };
const ADVICE_WORDS: Record<string, string> = {
  dispatch: 'Big reading jobs go to a helper now, so this chat stays sharp.',
  compact: 'Answers get worse before this fills up — tidying it (compact) keeps them sharp.',
  handoff: 'Nearly full — time for a fresh session that picks up from here.',
};
const STRENGTH_WORDS: Record<string, string> = { 'cross-vendor': 'other company', 'cross-model': 'different model', 'same-model': 'fresh eyes' };

export function modelName(id: string): string {
  return modelWords(id).replace(/ 1M$/, '');
}

/** The context window, when the id says it -- never guessed. */
export function contextWords(id: string | undefined): string | null {
  return id && /\[1m\]/i.test(id) ? '1M context' : null;
}

export function modelWords(id: string): string {
  if (!id) return 'model not reported';
  const long = /\[1m\]$/i.test(id) ? ' 1M' : '';
  const base = id.replace(/\[1m\]$/i, '').replace(/-\d{8}$/, '');
  const c = base.match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?$/i);
  if (c) return `${c[1][0].toUpperCase()}${c[1].slice(1)} ${c[2]}${c[3] ? '.' + c[3] : ''}${long}`;
  const g = base.match(/^gpt-([\d.]+)(?:-([a-z]+))?$/i);
  if (g) return `GPT-${g[1]}${g[2] ? ' ' + g[2][0].toUpperCase() + g[2].slice(1) : ''}${long}`;
  return base.charAt(0).toUpperCase() + base.slice(1) + long;
}

/** The status line (item 35): each thing that used to be a bar is a small
 *  mark on one line -- context as a meter, Spend-it as its expiring blocks,
 *  boost and full auto as lit words. Nothing is shown that is not live: no
 *  surplus, no Spend-it mark; approvals asked for, no full-auto mark. */
function StatusStrip({ session, open, onToggle }: { session: SessionState; open: boolean; onToggle: () => void }) {
  const ctx = session.context;
  const surplus = session.meta?.boost ? null : session.meta?.surplus;
  const now = useMinute(!!surplus);
  const minutes = surplus ? (surplus.resetsAt ? Math.max(0, Math.round((surplus.resetsAt - now) / 60_000)) : surplus.minutesLeft) : null;
  const pct = ctx?.overLimit?.kind === 'hard_limit' ? 100 : ctx?.percent ?? null;
  if (!ctx && !surplus && !session.meta?.boost && session.meta?.approvals !== 'full-auto') return null;
  return (
    <button className={`status-strip${open ? ' open' : ''}`} onClick={onToggle} aria-expanded={open}>
      {ctx && (
        <span className={`strip-ctx ${ctx.pressure}`} title="Context">
          {/* No reading, no bar (decision 7) -- never an empty one that reads as 0%. */}
          {pct != null && <span className="strip-ctx-bar"><span style={{ width: `${Math.min(100, pct)}%` }} /></span>}
          <span className="strip-label">{pct != null ? `${pct}%` : 'no data'}</span>
        </span>
      )}
      {surplus && (
        <span className="strip-spend" title="Spend it before it resets">
          <span className="expiry-blocks" aria-hidden="true">
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} className={`expiry-block${i >= 5 - Math.ceil(expiringBlocks(surplus.headroomPct) / 2) ? ' expiring' : ''}`} />
            ))}
          </span>
          <span className="strip-label">{surplus.headroomPct}% · {minutes != null ? fmtMinutes(minutes) : 'soon'}</span>
        </span>
      )}
      {session.meta?.boost && <span className="strip-word lamp">Boost</span>}
      {session.meta?.approvals === 'full-auto' && (
        <span className="strip-word lamp"><Icon name="bolt" /> Full auto</span>
      )}
      <span className="strip-more" aria-hidden="true">{open ? '▴' : '▾'}</span>
    </button>
  );
}

/** Effort, in the thread (Control board): six blocks and the word, on every
 *  turn that ran at a set effort. A model that budgets its own thinking has no
 *  meter -- there is no number to show, and inventing one would be a lie. */
const EFFORT_BLOCKS: Record<string, number> = { minimal: 1, low: 1, medium: 2, high: 3, xhigh: 4, max: 5, ultra: 6 };
function EffortMeter({ effort }: { effort: string }) {
  const lit = EFFORT_BLOCKS[effort];
  if (!lit) return null;
  return (
    <span className="effort-meter" title={`Thinking effort: ${effort}`}>
      <span className="effort-blocks" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={`effort-block${i < lit ? ' lit' : ''}`} />
        ))}
      </span>
      <span className="effort-word">{effort}</span>
    </span>
  );
}

/** Pip proposes, you dispose (Control board). The cheapest agent sizes the
 *  job and says so before the expensive ones start; one message, one way to
 *  decline. The message waits on the answer -- nothing has run yet. */
function PipProposes({ offer, onAnswer }: { offer: NonNullable<SessionMeta['escalation']>; onAnswer: (go: boolean) => void }) {
  const [sent, setSent] = useState(false);
  const answer = (go: boolean) => {
    setSent(true);
    onAnswer(go);
  };
  return (
    <CrewRow crew={PIP} pose="peek">
      <div className="crew-ask">
        <div className="crew-ask-text">
          This looks large — {offer.reason}. I'll get {offer.planner} to plan it and have {offer.reviewer} review before anything runs.
        </div>
        <div className="crew-ask-actions">
          <button className="crew-ask-go" disabled={sent} onClick={() => answer(true)}>Go ahead</button>
          <button className="crew-ask-no" disabled={sent} onClick={() => answer(false)}>Just chat</button>
        </div>
      </div>
    </CrewRow>
  );
}

/** The moment it asks (Context board): the agent whose context it is, their
 *  colour already leaving them, asking once -- with the box that stops it
 *  asking again. Compacting loses detail, so it is never done unasked. */
function CompactAsk({ crew, percent, keep, onKeep, onCompact, onNotYet }: {
  crew: CrewInfo; percent: number | null; keep: boolean; onKeep: (v: boolean) => void; onCompact: () => void; onNotYet: () => void;
}) {
  // The asking face is already losing its colour: it asks BECAUSE it is
  // degrading, so it never shows as fresh here even just past the threshold.
  return (
    <div className="compact-ask" style={{ '--rot-face': Math.max(0.5, rotFor(percent)) } as React.CSSProperties}>
    <CrewRow
      crew={crew}
      pose="idle"
      head={percent != null ? (
        <span className="compact-meter">
          <span className="compact-meter-bar"><span style={{ width: `${Math.min(100, percent)}%` }} /></span>
          <span className="compact-meter-pct">{percent}%</span>
        </span>
      ) : undefined}
    >
      <div className="crew-ask">
        <div className="crew-ask-text">
          {percent != null ? `I'm ${percent}% full and I can feel it` : "My context is filling and I can feel it"} — answers get worse before the
          window actually runs out. Want me to compact? I'll keep the plan and the criteria.
        </div>
        <label className="crew-ask-keep">
          <input type="checkbox" checked={keep} onChange={(e) => onKeep(e.target.checked)} />
          Do this automatically from now on
        </label>
        <div className="crew-ask-actions">
          <button className="crew-ask-go wide" onClick={onCompact}>Compact now</button>
          <button className="crew-ask-no" onClick={onNotYet}>Not yet</button>
        </div>
      </div>
    </CrewRow>
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
    <div className="crew-row" style={{ '--crew': nameColor(crew.color) ?? crew.color } as React.CSSProperties}>
      <span className="crew-row-face" role="button" tabIndex={0} title={`${crew.name} — tap for their card`} onClick={() => openCompanion(crew)}>
        <SpriteAvatar crew={crew} pose={pose} size={52} />
      </span>
      <div className="crew-row-col">
        <div className="crew-row-head">
          <span className="crew-ident-name" style={{ color: nameColor(crew.color) }}>{crew.name}</span>
          <span className="crew-row-model" title={crew.model || undefined}>
            {crew.model ? modelName(crew.model) : crew.agent === 'codex' ? 'Codex' : 'Claude'}
          </span>
          {head}
          {crew.effort && <EffortMeter effort={crew.effort} />}
        </div>
        {crew.effortNote && <div className="crew-row-effort-note">{crew.effortNote}</div>}
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
    <span className="crew-chip" title={`${crew.name} · ${crew.model ? modelName(crew.model) : crew.agent}`}>
      <CrewAvatar crew={crew} />
      <span className="crew-name" style={{ color: nameColor(crew.color) }}>{crew.name}</span>
      <span className="crew-role">{crew.roleLabel}</span>
      {sub && <span className="crew-sub">{sub}</span>}
    </span>
  );
}

function Message({ item, crew, chapterCrew, me, fresh = false, aside = false, asking = false }: { item: ChatItem; crew?: CrewInfo; chapterCrew?: CrewInfo[]; me?: Me | null; fresh?: boolean; aside?: boolean; asking?: boolean }) {
  const deploy = React.useContext(DeployContext);
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
      // Narration, not the reply (item 36): a line said on the way to more
      // work -- "Endpoint and tests pass. Next, the map screen." -- sits as a
      // quiet aside; the turn's last word stays a full bubble.
      if (aside && item.complete) {
        return (
          <div className="msg-aside">
            {item.crew && <strong style={{ color: nameColor(item.crew.color) }}>{item.crew.name}</strong>} <Markdown text={item.text} />
          </div>
        );
      }
      // No reply prints in pieces (2026-09-25): "I don't need to see the
      // responses get generated in glitchy chunks. Just give me the output
      // already in place." While it is being written, they are typing; the
      // finished text lands whole.
      if (!item.complete) {
        return (
          <CrewRow crew={item.crew ?? crew ?? PIP} pose="type">
            <div className="msg assistant typing-bubble" aria-label="typing">
              <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>
            </div>
          </CrewRow>
        );
      }
      return (
        item.crew ? (
          <CrewRow crew={item.crew} pose={item.complete ? (asking ? 'peek' : 'idle') : 'type'}>
            <div className={`msg assistant${asking ? ' ask-pulse' : ''}`}>
              <Markdown text={item.text} />
            </div>
          </CrewRow>
        ) : (
          <div className="msg assistant">
            <Markdown text={item.text} />
          </div>
        )
      );
    case 'question':
      return <QuestionThread item={item} />;
    case 'milestone':
      // A moment (item 40): a level or a milestone crossed on this turn. Said
      // once, where it happened; replayed history shows it without the hop.
      return (
        <button className={`milestone-row${fresh ? ' fresh' : ''}`} onClick={() => openCompanion(item.crew)}>
          <SpriteAvatar crew={item.crew} pose="cheer" size={36} className={fresh ? 'tracker-cheer' : undefined} />
          <span className="milestone-text">
            <span className="milestone-label">{item.label}</span>
            <span className="milestone-detail">{item.detail}</span>
          </span>
          {fresh && <Confetti />}
        </button>
      );
    case 'thinking':
      return <ThinkingBlock text={item.text} open={item.open} crew={crew} />;
    case 'tool':
      return <ToolChip item={item} fresh={fresh} />;
    case 'approval':
      return <ApprovalText item={item} crew={item.crew ?? crew} me={me} />;
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
              {/* Someone being sent out (§12a): live, the worker steps off
                  toward the work -- one short move that settles. Replayed
                  history just stands there; nobody was sent anywhere today. */}
              <SpriteAvatar crew={item.worker} pose="idle" size={22} className={fresh ? 'sent-out' : undefined} />
              <strong style={{ color: nameColor(item.worker.color) }}>{item.worker.name}</strong>
              <span className="routed-model"> ({modelName(item.model)})</span>
            </>
          ) : (
            <strong>{modelName(item.model)}</strong>
          )}
          {item.reason ? ` — ${item.reason}` : ''}
        </div>
      );
    case 'verify': {
      const r = item.report;
      // Finishing is worth something, and it is the WHOLE job's crew, not
      // just whoever is live right now: chapterCrew is everyone who spoke in
      // this chapter, in order of first appearance (chapters.ts). Falls back
      // to the single live `crew` for a verify item with no chapter context.
      const cheerers = r.passed ? (chapterCrew?.length ? chapterCrew : crew ? [crew] : []) : [];
      return (
        <div className={`verify-msg ${r.passed ? 'pass' : r.unverified ? 'unverified' : 'fail'}${fresh ? ' fresh' : ''}`}>
          <div className="verify-head">
            {/* Finishing is worth something. Only on a PASS -- a failed gate
                gets no celebration, which is the whole point of having a gate. */}
            {cheerers.filter((c) => c.sprite).map((c) => (
              <SpriteAvatar key={c.name} crew={c} pose="cheer" size={30} />
            ))}
            <span className="verify-badge">{r.passed ? 'PASSED' : r.unverified ? 'NOT VERIFIED' : 'FAILED'}</span> {r.summary}
            {/* Earned delight, once: a handful of pixels in the crew's own
                colours rising off the verdict and fading. The board's one
                unprompted moment, and it only fires because something real
                just passed. */}
            {r.passed && fresh && <Confetti />}
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
          {r.passed && r.changed && deploy && (
            <button className="deploy-go" onClick={() => deploy.open()}>Deploy</button>
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
      const phaseLabel = item.phase === 'plan' ? 'Plan' : item.phase === 'reconcile' ? 'Reconciled plan' : item.phase === 'mention' ? 'Asked by name' : item.phase === 'handoff' ? 'Handoff' : 'Review';
      const badges = (
        <>
          <span className={`consult-phase ${item.phase}`}>{phaseLabel}</span>
          {verdict && <span className={`verdict-badge ${verdict === 'SOLID' ? 'solid' : 'changes'}`}>{verdict}</span>}
          {item.reviewStrength && (
            <span className="review-strength" title="How independent this reviewer is from the author">{STRENGTH_WORDS[item.reviewStrength] ?? item.reviewStrength}</span>
          )}
        </>
      );
      if (item.crew) {
        return (
          <>
            {item.phase === 'handoff' && item.from && <HandoffPass from={item.from} to={item.crew} fresh={fresh} />}
            <CrewRow crew={item.crew} pose="idle" head={badges}>
              <div className={`consult-msg ${item.phase}`}>
                <Markdown text={item.text} />
              </div>
            </CrewRow>
          </>
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
      if (item.code === 'context') {
        // Every later message fails the same way, and a restart resumes the same
        // oversized conversation — so the only way on is a fresh session.
        return (
          <div className="msg error auth-needed">
            <strong>This conversation is too long for Claude to continue.</strong>
            <span>Every message here will fail the same way. A fresh session on this project picks up where you are; this one stays readable.</span>
            <button className="chip compact-accept" onClick={() => window.dispatchEvent(new Event('roost:start-fresh'))}>
              Start fresh on this project
            </button>
          </div>
        );
      }
      if (item.code === 'gate') {
        // The gate refusing (§12a) should look refused, not read like a crash:
        // a lock, not a sentence in the same red box as a stack trace.
        return (
          <div className="msg error gate-refused">
            <Icon name="lock" size={16} className="gate-lock" />
            <span>{item.text}</span>
          </div>
        );
      }
      return <div className="msg error">{item.text}</div>;
    case 'notice':
      // A restart naming what shipped, a routing decision, a concurrent-
      // session warning: worth keeping in the thread, but not a crew reply --
      // no avatar, no name, quieter than an error (2026-09-26).
      return <div className="msg notice">{item.text}</div>;
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
        {/* Commands type themselves (item 05): a caret while the call is
            actually running. Rendered as its own element, not a pseudo-
            element inside .tool-detail -- that span clips with an ellipsis,
            which would have hidden the caret on any truncated (i.e. most)
            command the instant it mattered. Gated on the same boolean the
            chip's own colour is (!item.done), never a timer. */}
        {!item.done && <span className="tool-caret" aria-hidden="true" />}
        {item.done && item.endDetail && <span className="tool-detail"> · {item.endDetail}</span>}
        {!item.done && <span className="spinner" />}
        {expandable && <span className="tool-expand-hint">{expanded ? '▴' : '▾'}</span>}
      </button>
      {/* A tool that read or wrote a picture shows it: the Read of a
          screenshot was a chip you could tap and get nothing (2026-09-24). */}
      <ImageStrip paths={findImagePaths(`${item.detail ?? ''} ${item.expand?.path ?? ''}`, 3)} />
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
              {/* The folded row is the one actually on screen during a live
                  run -- calls fold into this line by default (4edc827) -- so
                  the caret has to live here too, not only on the expanded
                  ToolChip nobody is looking at. */}
              <span className="tool-caret" aria-hidden="true" />
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

/** The thread ends in a reply being written: its typing bubble already says so. */
function typingNow(items: ChatItem[]): boolean {
  const last = items[items.length - 1];
  return last?.kind === 'assistant' && !last.complete;
}

/** True when the thread ends in a live work card, which already shows who is
 *  working and on what -- the separate "is thinking…" row would say it twice. */
function liveWorkCard(items: ChatItem[], status: string): boolean {
  if (status !== 'working' || !items.length) return false;
  const chapters = chaptersOf(items);
  const ch = chapters[chapters.length - 1];
  if (!ch) return false;
  const segs = workSegments(items, ch.start, ch.end, true);
  const last = segs[segs.length - 1];
  return last?.kind === 'work' && last.end === ch.end;
}

/** One card for a stretch of work (the work stream, toolruns.ts). Live: the
 *  crew member's latest line, in their voice and at full size, and what is
 *  running now. Done: one line -- how much they did and the last thing they
 *  said. A tap opens the whole timeline: every line, every call, in order. */
function WorkStream({ items, start, end, crew, live, replayedCount }: { items: ChatItem[]; start: number; end: number; crew?: CrewInfo; live: boolean; replayedCount: number }) {
  const [open, setOpen] = useState(false);
  const slice = items.slice(start, end);
  const tools = slice.filter((x): x is Extract<ChatItem, { kind: 'tool' }> => x.kind === 'tool');
  const lines = slice.filter((x): x is Extract<ChatItem, { kind: 'assistant' }> => x.kind === 'assistant' && !!x.text.trim());
  const s = summarizeRun(tools);
  const who = lines[lines.length - 1]?.crew ?? crew;
  const writing = !!lines.length && !lines[lines.length - 1].complete;
  // Only whole lines are shown; one still being written reads as typing.
  const done = lines.filter((l) => l.complete);
  const latest = done[done.length - 1];
  const thinking = live && !s.running && !writing;
  const pose: Pose = live ? (s.running || (latest && !latest.complete) ? 'type' : 'think') : 'idle';
  const mins = Math.round((slice[slice.length - 1].ts - slice[0].ts) / 60_000);
  const tally = [lines.length ? `${lines.length} update${lines.length === 1 ? '' : 's'}` : '', s.text, !live && mins >= 1 ? `${mins}m` : ''].filter(Boolean).join(' · ');
  return (
    <div className={`work-stream${live ? ' live' : ''}${open ? ' open' : ''}${s.failed ? ' failed' : ''}`}>
      <button className="work-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {who && <SpriteAvatar crew={who} pose={pose} size={live ? 40 : 28} />}
        <span className="work-head-text">
          {who && <span className="work-who" style={{ color: nameColor(who.color) }}>{who.name}</span>}
          <span className="work-tally">{tally}{s.failed ? <span className="tool-run-failed"> · {s.failed} failed</span> : null}</span>
        </span>
        <span className="tool-expand-hint">{open ? '▴' : '▾'}</span>
      </button>
      {!open && latest && (
        <div className={`work-latest${live ? '' : ' folded'}`}>
          <Markdown text={latest.text} />
        </div>
      )}
      {!open && live && (
        <div className="work-now">
          {s.running ? (
            <>
              <span className="tool-name">{s.running.name}</span> <span className="tool-detail">{s.running.detail}</span>
              <span className="tool-caret" aria-hidden="true" />
            </>
          ) : writing ? (
            <span className="work-thinking">{who?.name ?? 'They'} is typing <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span></span>
          ) : thinking ? (
            <span className="work-thinking">thinking…</span>
          ) : null}
        </div>
      )}
      {open && (
        <div className="work-timeline">
          {segmentsOf(items, start, end).map((seg) => {
            if (seg.kind === 'run') return <ToolRun key={`r${seg.start}`} items={items} start={seg.start} end={seg.end} replayedCount={replayedCount} />;
            const it = items[seg.index];
            if (it.kind === 'assistant') return it.text.trim() && it.complete ? <div key={seg.index} className="work-line"><Markdown text={it.text} /></div> : null;
            if (it.kind === 'thinking') return <ThinkingBlock key={seg.index} text={it.text} open={it.open} />;
            return null;
          })}
        </div>
      )}
    </div>
  );
}

/** Session settings' one choice (2026-09-27). Each is a bundle of the finer
 *  controls; anything else is "custom", said plainly rather than pretended. */
type Preset = { key: 'quick' | 'normal' | 'careful'; name: string; says: string; mode: SessionMode; ask: AskLevel; effort: string };
const PRESETS: Preset[] = [
  { key: 'quick', name: 'Quick', says: 'Just chat and do it.', mode: 'chat', ask: 'off', effort: '' },
  { key: 'normal', name: 'Normal', says: 'Pip picks who, and how hard.', mode: 'auto', ask: 'quick', effort: '' },
  { key: 'careful', name: 'Careful', says: 'Plan first, a second opinion, then build.', mode: 'build', ask: 'talk', effort: 'high' },
];
export function presetOf(meta: { mode?: SessionMode; ask?: AskLevel; effort?: string }): Preset['key'] | 'custom' {
  const hit = PRESETS.find((p) => (meta.mode ?? 'auto') === p.mode && (meta.ask ?? 'quick') === p.ask && (meta.effort ?? '') === p.effort);
  return hit?.key ?? 'custom';
}
function applyPreset(p: Preset, send: (m: any) => unknown) {
  send({ type: 'set_mode', mode: p.mode });
  send({ type: 'set_ask', ask: p.ask });
  send({ type: 'set_effort', effort: p.effort });
}

const ASK_CHOICES: Array<[AskLevel, string, string]> = [
  ['off', 'Just build', 'No questions -- they make the calls and tell you what they assumed.'],
  ['quick', 'Quick check', 'A question or two, only when something important is unclear.'],
  ['talk', 'Talk it through', 'A short design chat first -- planning, but it feels like texting.'],
  ['grill', 'Grill me', 'A relentless interview until nothing is left assumed.'],
];

/** The turn's last word, still waiting on you: a finished reply that ends in
 *  a question, with nothing after it and nobody working. Codex asks this way
 *  (it has no question tool); so does anyone who just asks. */
function awaitingReply(items: ChatItem[], i: number, status: string): boolean {
  const it = items[i];
  return i === items.length - 1 && status === 'idle' && it?.kind === 'assistant' && it.complete && /\?\s*$/.test(it.text.trim());
}

const AskContext = React.createContext<{
  draft: { id: string; answers: Record<string, string> } | null;
  answer: (text: string) => boolean;
  skip: () => void;
  crew?: CrewInfo;
  me?: Me | null;
} | null>(null);

/** A crew member's question, as texts (2026-09-25): "The agent should have
 *  just asked me like a normal text... It also shouldn't be multiple questions
 *  in a bullet point list." One question per bubble, in their colours, with
 *  the replies they suggest as chips you can tap -- or just text back. The one
 *  waiting on you pulses until you answer; the next appears once you have. */
function QuestionThread({ item }: { item: Extract<ChatItem, { kind: 'question' }> }) {
  const ctx = React.useContext(AskContext);
  const [picked, setPicked] = useState<string[]>([]);
  const crew = item.crew ?? ctx?.crew;
  const answers = item.answered ? item.answers ?? {} : ctx?.draft?.id === item.requestId ? ctx.draft.answers : {};
  const skipped = item.answered && !item.answers;
  const shown = skipped ? 1 : item.answered ? item.questions.length : Math.min(item.questions.length, Object.keys(answers).length + 1);
  return (
    <>
      {item.questions.slice(0, shown).map((q, i) => {
        const a = answers[q.question];
        const current = !item.answered && a == null;
        const bubble = (
          <div className={`msg assistant ask${current ? ' ask-pulse' : ''}`}>
            <Markdown text={q.question} />
            {current && q.options.length > 0 && (
              <div className="ask-options">
                {q.options.map((o) => {
                  const pick = /\(recommended\)/i.test(o.label);
                  const label = o.label.replace(/\s*\(recommended\)\s*/i, '').trim();
                  const on = picked.includes(label);
                  return (
                    <button
                      key={o.label}
                      className={`ask-option${pick ? ' pick' : ''}${on ? ' on' : ''}`}
                      onClick={() => {
                        if (!q.multiSelect) { ctx?.answer(label); return; }
                        setPicked((p) => (on ? p.filter((x) => x !== label) : [...p, label]));
                      }}
                    >
                      <span className="ask-option-label">
                        {label}
                        {pick && <span className="ask-pick">{crew ? `${crew.name}'s pick` : 'suggested'}</span>}
                      </span>
                      {o.description && <span className="ask-option-desc">{o.description}</span>}
                    </button>
                  );
                })}
                {q.multiSelect && (
                  <button className="ask-send" disabled={!picked.length} onClick={() => { ctx?.answer(picked.join(', ')); setPicked([]); }}>
                    Send {picked.length ? `(${picked.length})` : ''}
                  </button>
                )}
              </div>
            )}
            {current && (
              <div className="ask-hint">
                {q.options.length ? 'Tap one, or just text back.' : 'Just text back.'}
                {item.questions.length > 1 && <span> · {i + 1} of {item.questions.length}</span>}
                <button className="ask-skip" onClick={() => ctx?.skip()}>Skip</button>
              </div>
            )}
          </div>
        );
        return (
          <React.Fragment key={q.question}>
            {crew ? <CrewRow crew={crew} pose={current ? 'peek' : 'idle'}>{bubble}</CrewRow> : bubble}
            {a != null && <Message item={{ kind: 'user', text: a, imageCount: 0, ts: item.ts }} me={ctx?.me} />}
          </React.Fragment>
        );
      })}
      {skipped && <div className="ask-skipped">Skipped — {crew?.name ?? 'they'} carried on with their best judgement.</div>}
    </>
  );
}

/** A permission request, asked as a text (2026-09-25). It was a pop-up over
 *  raw JSON with two link-styled lines that "didn't even look like buttons".
 *  Now whoever wants it asks in the thread -- "Can I run a command?", the
 *  command, their reason -- and three real buttons answer it. The one waiting
 *  pulses in their colour. Answered, it reads as a short exchange. Full auto
 *  lives in the session settings, not here. */
function ApprovalText({ item, crew, me }: { item: Extract<ChatItem, { kind: 'approval' }>; crew?: CrewInfo; me?: Me | null }) {
  const send = React.useContext(ApprovalContext);
  const w = item.words;
  const ask = w ? `Can I ${w.action}?` : crewAsking(item.title, crew);
  const waiting = !item.decision;
  const reply = item.decision === 'deny' ? 'Not now' : item.decision === 'allow-session' ? `Yes — and don't ask again for ${w?.kind ?? 'this'}` : item.decision ? 'Yes' : null;
  const bubble = (
    <div className={`msg assistant approval-ask${waiting ? ' ask-pulse' : ''}`}>
      <p className="approval-q">{ask}</p>
      {w?.target ? <pre className="approval-target">{w.target}</pre> : !w ? <pre className="approval-target">{item.detail}</pre> : null}
      {w?.note && <p className="approval-note">{w.note}</p>}
      {waiting && send && (
        <div className="approval-buttons">
          <button className="approval-yes" onClick={() => send(item.requestId, 'allow')}>Yes</button>
          <button className="approval-no" onClick={() => send(item.requestId, 'deny')}>Not now</button>
          <button className="approval-always" onClick={() => send(item.requestId, 'allow-session')}>
            Yes, and don't ask again for {w?.kind ?? 'this'}
          </button>
        </div>
      )}
    </div>
  );
  return (
    <>
      {crew ? <CrewRow crew={crew} pose={waiting ? 'peek' : 'idle'}>{bubble}</CrewRow> : bubble}
      {reply && <Message item={{ kind: 'user', text: reply, imageCount: 0, ts: item.ts }} me={me} />}
    </>
  );
}

const ApprovalContext = React.createContext<((requestId: string, decision: 'allow' | 'allow-session' | 'deny') => void) | null>(null);

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

/** A crew member the composer can @-mention. */
interface MentionTarget { name: string; color: string; sprite?: string; suite: 'claude' | 'codex'; tier: 'flagship' | 'worker'; model?: string }

function Composer(props: {
  disabled: boolean;
  working: boolean;
  onInterrupt: () => void;
  onSend: (text: string, images?: UserImage[]) => boolean;
  onConsult: (text: string) => void;
  crew?: MentionTarget[];
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  // "@" then letters at the end of the draft opens the crew; a tap completes
  // the name. Matched on the draft's tail, so a finished "@Nell " closes it.
  const atMatch = text.match(/(^|\s)@([A-Za-z]*)$/);
  const mentionable = atMatch
    ? (props.crew ?? []).filter((c) => c.name.toLowerCase().startsWith(atMatch[2].toLowerCase()))
    : [];
  const completeMention = (name: string) => setText((t) => t.replace(/@([A-Za-z]*)$/, `@${name} `));
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
      {mentionable.length > 0 && (
        <div className="mention-pop" role="listbox" aria-label="Crew">
          {mentionable.map((c) => (
            <button key={c.name} className="mention-opt" role="option" onMouseDown={(e) => e.preventDefault()} onClick={() => completeMention(c.name)}>
              {c.sprite ? <SpriteAvatar crew={{ name: c.name, color: c.color, sprite: c.sprite, agent: c.suite, initial: c.name[0], role: '', roleLabel: '', tier: c.tier, model: '' }} pose="idle" size={22} /> : null}
              <span className="mention-text">
                <span style={{ color: nameColor(c.color) }}>{c.name}</span>
                {/* The model, with its version, as a small second line: who
                    you are asking for, without crowding the pop-up. */}
                <span className="mention-model">{c.model ?? c.suite}</span>
              </span>
            </button>
          ))}
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
            placeholder={props.placeholder ?? 'Message…'}
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
