import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { fmtAgo, shortPath } from './format';
import { GitSheet } from './GitSheet';
import { Markdown } from './Markdown';
import { PreviewContent } from './PreviewContent';
import { useSession } from './useSession';
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

export function ChatView(props: { sessionId: string; config: RoostConfigResponse; onBack: () => void; onSwitch: (id: string) => void }) {
  const { sessionId, config, onBack, onSwitch } = props;
  const session = useSession(sessionId);
  const [showSettings, setShowSettings] = useState(false);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showGit, setShowGit] = useState(false);
  const [recap, setRecap] = useState<PreviewResult | null>(null);
  const [recapLoading, setRecapLoading] = useState(false);
  // Pre-ticked: at this point the meter has already crossed a line the person
  // was told about, and the common answer to "do this every time" here is yes.
  // It is still a checkbox they can clear before tapping.
  const [keepCompacting, setKeepCompacting] = useState(true);
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

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session.items, session.status, recap]);

  useEffect(() => {
    setRecap(null); // switching sessions — don't show the previous chat's recap
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
          <div>
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
          ⚙
        </button>
      </header>

      {showGit && session.meta && <GitSheet cwd={session.meta.cwd} onClose={() => setShowGit(false)} />}

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

      <div className="verify-bar">
        <button className="chip" disabled={session.status === 'working'} title="Run the project's gates and record command, exit code and output" onClick={() => session.send({ type: 'verify' })}>
          ✓ Run gates
        </button>
        <button className="chip" disabled={session.status === 'working'} title="Gates, then a fresh-context review of the diff against the criteria" onClick={() => session.send({ type: 'verify', review: true })}>
          ✓ Gates + review diff
        </button>
      </div>
      {session.meta?.surplus && !session.meta.boost && (
        <div className="surplus-bar">
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

      <div className="messages" ref={scrollRef}>
        {(recap || recapLoading) && (
          <div className="recap-card">
            <div className="recap-header">Picking up from before</div>
            <PreviewContent preview={recap} loading={recapLoading} />
            <div className="recap-divider">continuing below</div>
          </div>
        )}
        {session.meta?.recentCrew && session.meta.recentCrew.length > 0 && (
          <CrewWakeUp crew={session.meta.recentCrew} />
        )}
        {session.items.map((item, i) => (
          <Message key={i} item={item} crew={session.meta?.crew} me={me} />
        ))}
        {session.status === 'working' && !session.closedReason && (
          <div className="working-indicator">{session.statusMessage ?? 'working…'}</div>
        )}
        {session.status === 'connecting' && !session.closedReason && <div className="working-indicator">starting agent…</div>}
      </div>

      {session.meta?.consultPending && (
        <div className="consult-bar">
          <span className="consult-bar-text">
            Consult complete{session.meta.planPath ? ` — plan at ${session.meta.planPath.split('/').slice(-3).join('/')}` : ''} — proceed?
          </span>
          <div className="consult-bar-actions">
            <button className="chip" onClick={() => session.send({ type: 'consult_dismiss' })}>
              Dismiss
            </button>
            <button className="chip consult-proceed" onClick={() => session.send({ type: 'consult_proceed' })}>
              ▶ Proceed
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

      {session.pendingApproval && (
        <div className="sheet-backdrop">
          <div className="sheet">
            <h3>
              {session.pendingApproval.title}
              {session.pendingApprovalCount > 1 ? ` · ${session.pendingApprovalCount - 1} more waiting` : ''}
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
              Allow and stop asking this session
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
                  ⚡ Auto
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
export type Pose = 'idle' | 'type' | 'think' | 'blink' | 'cheer' | 'peek';

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
function SpriteAvatar({ crew, pose, size }: { crew: CrewInfo; pose: Pose; size: number }) {
  const [failed, setFailed] = useState(false);
  if (!crew.sprite || failed) return <CrewAvatar crew={crew} />;
  const moving = pose === 'type' || pose === 'think';
  return (
    <span className={`crew-sprite${moving ? ' moving' : ''}`} style={{ width: size, height: size }}>
      <img src={`/crew/${crew.sprite}-idle.webp`} alt="" onError={() => setFailed(true)} />
      {moving && <img className="frame-b" src={`/crew/${crew.sprite}-${pose}.webp`} alt="" />}
      {!moving && pose !== 'idle' && (
        <img className="frame-static" src={`/crew/${crew.sprite}-${pose}.webp`} alt="" />
      )}
    </span>
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
          <span className="crew-wake-frames" style={{ animationDelay: `${i * 220}ms` }}>
            <img src={`/crew/${c.sprite}-idle.webp`} alt="" />
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
          <span className="crew-wake-name" style={{ color: c.color }}>{c.name}</span>
        </span>
      ))}
    </div>
  );
}

/** Name large, model small underneath -- "Sol" then "gpt-5.2-codex · reviewer".
 *  The chip put them on one line at one size, which made the model id compete
 *  with the name for the same glance. */
function CrewHeader({ crew, pose, size = 46 }: { crew: CrewInfo; pose: Pose; size?: number }) {
  return (
    <div className="crew-header">
      <SpriteAvatar crew={crew} pose={pose} size={size} />
      <span className="crew-ident">
        <span className="crew-ident-name" style={{ color: crew.color }}>{crew.name}</span>
        <span className="crew-ident-sub">
          {crew.model || crew.agent}
          {crew.roleLabel ? ` · ${crew.roleLabel}` : ''}
        </span>
      </span>
    </div>
  );
}

function CrewAvatar({ crew }: { crew: CrewInfo }) {
  const url = avatarUrl(crew.avatar);
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      <img
        className="crew-avatar crew-avatar-img"
        src={url}
        alt=""
        style={{ background: crew.color }}
        onError={() => setFailed(true)}
      />
    );
  }
  return <span className="crew-avatar crew-monogram" style={{ background: crew.color }}>{crew.initial}</span>;
}

function fmtMinutes(m: number): string {
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function CrewChip({ crew, sub }: { crew: CrewInfo; sub?: string }) {
  return (
    <span className="crew-chip" title={`${crew.name} · ${crew.roleLabel} · ${crew.model || crew.agent}`}>
      <CrewAvatar crew={crew} />
      <span className="crew-name" style={{ color: crew.color }}>{crew.name}</span>
      <span className="crew-role">{crew.roleLabel}</span>
      {sub && <span className="crew-sub">{sub}</span>}
    </span>
  );
}

function Message({ item, crew, me }: { item: ChatItem; crew?: CrewInfo; me?: Me | null }) {
  switch (item.kind) {
    case 'user':
      // The crew had faces and names from the first commit and you had neither,
      // which is a strange way to build a group chat you are supposed to be IN.
      return (
        <div className="msg-row user">
          <div className="msg user">
            {item.imageCount > 0 && <div className="img-note">📷 {item.imageCount} image{item.imageCount > 1 ? 's' : ''}</div>}
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
        <div className="msg assistant">
          {item.crew && <CrewHeader crew={item.crew} pose={item.complete ? 'idle' : 'type'} />}
          <Markdown text={item.text} />
        </div>
      );
    case 'thinking':
      return <ThinkingBlock text={item.text} open={item.open} crew={crew} />;
    case 'tool':
      return <ToolChip item={item} />;
    case 'approval':
      return (
        <div className="tool-chip approval">
          🔐 {item.title}
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
          {item.crew && <strong style={{ color: item.crew.color }}>{item.crew.name}</strong>}
          {item.crew ? ' sent this to ' : `⚡ ${item.tier} · routed to `}
          <strong>{item.model}</strong>
          {item.reason ? ` — ${item.reason}` : ''}
        </div>
      );
    case 'verify': {
      const r = item.report;
      return (
        <div className={`verify-msg ${r.passed ? 'pass' : 'fail'}`}>
          <div className="verify-head">
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
      return (
        <div className={`consult-msg ${item.phase}`}>
          <div className="consult-msg-head">
            {item.crew ? (
              <CrewHeader crew={item.crew} pose="idle" size={38} />
            ) : (
              <>
                <span className={`agent-dot ${item.agent}`} />
                {item.phase === 'plan' ? 'Plan' : item.phase === 'reconcile' ? 'Reconciled plan' : 'Critique'} · {item.agent}
              </>
            )}
            {verdict && <span className={`verdict-badge ${verdict === 'SOLID' ? 'solid' : 'changes'}`}>{verdict}</span>}
            {item.reviewStrength && (
              <span className="review-strength" title="How independent this reviewer is from the author">{item.reviewStrength}</span>
            )}
          </div>
          <Markdown text={item.text} />
        </div>
      );
    }
    case 'error':
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

function ToolChip({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }) {
  const [expanded, setExpanded] = useState(false);
  const expandable = Boolean(item.expand && (item.expand.before || item.expand.after || item.expand.raw));
  return (
    <div className="tool-block">
      <button
        className={`tool-chip ${item.done ? (item.ok ? 'ok' : 'fail') : 'running'}`}
        onClick={() => expandable && setExpanded((v) => !v)}
      >
        <span className="tool-name">{item.name}</span>
        <span className="tool-detail">{item.detail}</span>
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
      {props.working && (
        <div className="composer-hint">
          Working… new messages join the conversation as it goes
          <button className="stop-btn" onClick={props.onInterrupt}>
            ■ Stop
          </button>
        </div>
      )}
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
        <button className="ghost" onClick={() => fileRef.current?.click()}>
          ＋
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
        <textarea
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
            ⚖
          </button>
        )}
        <button className="primary send" disabled={props.disabled} onClick={send}>
          ↑
        </button>
      </div>
    </div>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}
