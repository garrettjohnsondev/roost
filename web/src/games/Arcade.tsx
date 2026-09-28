import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { buzz } from '../haptics';
import { Icon } from '../icons';
import { GAMES, PACK_TITLE } from './registry';
import { GHOSTS, fmtScore, ghostBeaten, sprite, type Ghost, type GameModule, type GameStoreView } from './types';
import type { SessionMeta } from '../types';
import { Coins, Keys, Locker, type EcoState } from '../economy/Locker';
import { setSound, sfx, soundOn } from '../economy/sound';

/** The arcade (roadmap #55; games wave 2 added the hub, logos, ghosts, the
 *  coding crew member in the corner and sideways games). Saves, bests,
 *  coins and crates live on the Mac. When a chat needs you, a banner slides
 *  over the paused game: one tap answers, and the game is where you left it. */

const GHOSTS_KEY = 'roost:ghosts';
const ghostsOn = () => { try { return localStorage.getItem(GHOSTS_KEY) !== '0'; } catch { return true; } };

/** Your arcade level: every run, achievement and ghost counts. */
export function arcadeLevel(store: GameStoreView, ghosts: number): { level: number; xp: number; next: number; into: number } {
  const plays = Object.values(store.plays).reduce((a, b) => a + b, 0);
  const xp = plays * 10 + Object.keys(store.achievements).length * 50 + ghosts * 80;
  const level = Math.floor(Math.sqrt(xp / 40)) + 1;
  const base = (level - 1) ** 2 * 40;
  const next = level ** 2 * 40;
  return { level, xp, next, into: (xp - base) / (next - base) };
}

/** Which ghost is out today for a game: rotates daily through the crew,
 *  easy first -- beat one and the next-stronger appears. */
function ghostFor(game: GameModule, beaten: Record<string, number>): Ghost | null {
  if (!game.meta.ghostScore) return null;
  const next = GHOSTS.find((g) => !beaten[`${game.meta.id}:${g.name}`]) ?? GHOSTS[GHOSTS.length - 1];
  return { name: next.name, sprite: next.sprite, strength: next.strength, target: Math.round(game.meta.ghostScore(next.strength)) };
}

export function Arcade({ onBack, onOpenSession }: { onBack: () => void; onOpenSession: (id: string) => void }) {
  const [store, setStore] = useState<GameStoreView | null>(null);
  const [eco, setEco] = useState<EcoState | null>(null);
  const [playing, setPlaying] = useState<GameModule | null>(() => {
    const id = new URLSearchParams(location.search).get('game');
    return GAMES.find((g) => g.meta.id === id) ?? null;
  });
  const [locker, setLocker] = useState(false);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [hidden, setHidden] = useState(document.hidden);
  const [toast, setToast] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string>('');
  const [sound, setSoundState] = useState(soundOn());
  const [ghosts, setGhosts] = useState(ghostsOn());

  const loadEco = () => api.economy().then(setEco).catch(() => {});
  useEffect(() => {
    api.games().then(setStore).catch(() => setStore({ saves: {}, best: {}, plays: {}, achievements: {} }));
    loadEco();
  }, []);
  useEffect(() => {
    const tick = () => api.sessions().then((r) => setSessions(r.sessions)).catch(() => {});
    tick();
    const t = setInterval(tick, 5000);
    const vis = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const open = (g: GameModule | null) => {
    setPlaying(g);
    const url = new URL(location.href);
    if (g) url.searchParams.set('game', g.meta.id); else url.searchParams.delete('game');
    history.replaceState(history.state, '', url);
    if (!g) loadEco();
  };

  const waiting = sessions.filter((s) => s.needsYou);
  const waitKey = waiting.map((w) => w.id).join(',');
  // A tap on the wrist-equivalent when someone starts waiting on you.
  const lastWait = useRef('');
  useEffect(() => { if (waitKey && waitKey !== lastWait.current) buzz('approval'); lastWait.current = waitKey; }, [waitKey]);
  const banner = waiting.length > 0 && dismissed !== waitKey ? waiting[0] : null;

  if (!store) return <div className="center-note">Opening the arcade…</div>;
  if (locker) return <Locker onBack={() => { setLocker(false); loadEco(); }} />;

  const ghostsBeaten = eco ? Object.keys((eco as any).ghostsBeaten ?? {}).length : 0;

  if (playing) {
    const ghost = ghosts ? ghostFor(playing, (eco as any)?.ghostsBeaten ?? {}) : null;
    return (
      <GameScreen
        key={playing.meta.id}
        game={playing}
        store={store}
        setStore={(f) => setStore((s) => (s ? f(s) : s))}
        paused={!!banner || hidden}
        onBack={() => open(null)}
        toast={setToast}
        ghost={ghost}
        onEco={loadEco}
        sessions={sessions}
        onOpenSession={onOpenSession}
        banner={banner && (
          <div className="arcade-banner" role="alert">
            <img src={sprite(banner.crew?.sprite ?? 'pip', 'peek')} alt="" />
            <span><b>{banner.crew?.name ?? 'The crew'}</b> needs you in “{banner.title}”</span>
            <button className="chip" onClick={() => onOpenSession(banner.id)}>Answer</button>
            <button className="link" onClick={() => setDismissed(waitKey)}>Later</button>
          </div>
        )}
        toastText={toast}
      />
    );
  }

  const packs = [...new Set(GAMES.map((g) => g.meta.pack ?? 'quick'))];
  const earned = Object.keys(store.achievements).length;
  const total = GAMES.reduce((n, g) => n + g.meta.achievements.length, 0);
  const lvl = arcadeLevel(store, ghostsBeaten);
  const challenge = eco?.challenge;
  const challengeGame = challenge && GAMES.find((g) => g.meta.id === challenge.gameId);
  const bests = GAMES.filter((g) => store.best[g.meta.id] !== undefined).slice(0, 8);
  return (
    <div className="arcade">
      <header className="arcade-head">
        <button className="ghost" onClick={onBack} aria-label="Back">‹</button>
        <h1>Arcade</h1>
        <button className="ghost hub-toggle" onClick={() => { const v = !sound; setSound(v); setSoundState(v); }} aria-label={sound ? 'Sound on' : 'Sound off'} title={sound ? 'Sound on (quiet)' : 'Sound off'}>
          {sound ? '♪' : <span className="muted-note">♪̸</span>}
        </button>
      </header>
      {banner && (
        <div className="arcade-banner" role="alert">
          <img src={sprite(banner.crew?.sprite ?? 'pip', 'peek')} alt="" />
          <span><b>{banner.crew?.name ?? 'The crew'}</b> needs you in “{banner.title}”</span>
          <button className="chip" onClick={() => onOpenSession(banner.id)}>Answer</button>
        </div>
      )}

      {/* The hub (games wave 2): who you are in here, at a glance. */}
      <section className="hub">
        <div className="hub-level">
          <span className="hub-level-n">{lvl.level}</span>
          <span className="hub-level-body">
            <span className="hub-level-label">Arcade level</span>
            <span className="hub-bar"><span style={{ width: `${Math.round(lvl.into * 100)}%` }} /></span>
            <span className="hub-sub">{lvl.xp.toLocaleString()} XP · next at {lvl.next.toLocaleString()}</span>
          </span>
        </div>
        <div className="hub-stats">
          <span><Icon name="trophy" /> {earned}/{total}</span>
          {eco && <Coins n={eco.coins} />}
          {eco && <Keys n={eco.keys} />}
          <span>{ghostsBeaten} ghost{ghostsBeaten === 1 ? '' : 's'}</span>
        </div>
        <div className="hub-actions">
          <button className="chip primary-chip" onClick={() => setLocker(true)}>
            Locker{eco && (eco.crates.length || eco.freeReady) ? ` · ${eco.crates.length + (eco.freeReady ? 1 : 0)} crate${eco.crates.length + (eco.freeReady ? 1 : 0) === 1 ? '' : 's'}` : ''}
          </button>
          <label className="switch-row hub-ghosts">
            <input type="checkbox" checked={ghosts} onChange={(e) => { setGhosts(e.target.checked); try { localStorage.setItem(GHOSTS_KEY, e.target.checked ? '1' : '0'); } catch { /* */ } }} />
            <span>Ghosts</span>
          </label>
        </div>
        {challenge && challengeGame && (
          <button className={`hub-challenge${challenge.done ? ' done' : ''}`} onClick={() => !challenge.done && open(challengeGame)}>
            <img src={sprite(challenge.host, challenge.done ? 'cheer' : 'peek')} alt="" />
            <span>
              <b>{challenge.done ? 'Challenge done!' : 'Today’s challenge'}</b>
              <br />{cap(challenge.host)}: “{challenge.text}.”{!challenge.done && ' Win a key and 50 coins.'}
            </span>
          </button>
        )}
        {bests.length > 0 && (
          <div className="hub-bests">
            {bests.map((g) => (
              <button key={g.meta.id} className="hub-best" onClick={() => open(g)}>
                <img src={`/games/logos/${g.meta.id}.webp`} alt="" />
                <span>{fmtScore(g.meta, store.best[g.meta.id])}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {packs.map((p) => (
        <section key={p}>
          <h2 className="arcade-pack">{PACK_TITLE[p] ?? p}</h2>
          <div className="arcade-grid">
            {GAMES.filter((g) => (g.meta.pack ?? 'quick') === p).map((g) => {
              const sv = store.saves[g.meta.id];
              const saved = g.meta.inProgress ? sv != null && g.meta.inProgress(sv) : sv != null;
              const got = g.meta.achievements.filter((a) => store.achievements[`${g.meta.id}:${a.id}`]).length;
              return (
                <button key={g.meta.id} className="arcade-card" onClick={() => open(g)}>
                  <GameLogo id={g.meta.id} name={g.meta.name} />
                  <span className="arcade-name">{g.meta.name}</span>
                  <span className="arcade-blurb">{g.meta.blurb}</span>
                  <span className="arcade-meta">
                    {saved ? <b>Resume</b> : <>Best {fmtScore(g.meta, store.best[g.meta.id])}</>}
                    {g.meta.achievements.length > 0 && <> · <Icon name="trophy" /> {got}/{g.meta.achievements.length}</>}
                    {g.meta.orientation === 'landscape' && <> · sideways</>}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** The game's own pixel badge (no crew on the tiles, 2026-09-29); the name's
 *  initial on a tile if the art isn't there yet. */
function GameLogo({ id, name }: { id: string; name: string }) {
  const [missing, setMissing] = useState(false);
  if (missing) return <span className="arcade-logo arcade-logo-missing">{name[0]}</span>;
  return <img className="arcade-logo" src={`/games/logos/${id}.webp`} alt="" onError={() => setMissing(true)} />;
}

/** The crew member who's coding right now, in the game's safe corner, with a
 *  bubble for big moments only; tap to open the message they just finished
 *  (the owner, 2026-09-29). */
function CornerCrew({ sessions, corner, onOpen }: { sessions: SessionMeta[]; corner: string; onOpen: (id: string) => void }) {
  const active = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).find((s) => s.state === 'working' || s.needsYou) ?? null;
  const [say, setSay] = useState<string | null>(null);
  const [shown, setShown] = useState<SessionMeta | null>(null);
  const prev = useRef<{ id: string; state: string; needs: boolean } | null>(null);
  useEffect(() => {
    // Track the last active session even after it goes idle, so "Done" shows.
    const cur = active ?? (shown ? sessions.find((s) => s.id === shown.id) ?? null : null);
    if (!cur) return;
    const p = prev.current;
    const now = { id: cur.id, state: cur.state, needs: !!cur.needsYou };
    let line: string | null = null;
    if (!p || p.id !== cur.id) line = cur.state === 'working' ? 'On it!' : null;
    else if (!p.needs && now.needs) line = 'Need your OK';
    else if (p.state === 'working' && now.state === 'idle') line = 'Done! Tap to read';
    else if (p.state !== 'working' && now.state === 'working') line = 'Back at it';
    else if (p.state !== 'error' && now.state === 'error') line = 'Hit a snag';
    prev.current = now;
    setShown(cur);
    if (line) {
      setSay(line);
      const t = setTimeout(() => setSay(null), line.startsWith('Done') ? 9000 : 4000);
      return () => clearTimeout(t);
    }
  }, [active?.id, active?.state, active?.needsYou, sessions]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown?.crew?.sprite) return null;
  return (
    <button className={`corner-crew corner-${corner}`} onClick={() => onOpen(shown.id)} aria-label={`${shown.crew.name}: open the chat`}>
      {say && <span className="corner-say">{say}</span>}
      <img src={sprite(shown.crew.sprite, shown.state === 'working' ? 'type' : shown.needsYou ? 'peek' : 'idle')} alt="" />
    </button>
  );
}

function useLandscape(): boolean {
  const q = () => typeof window !== 'undefined' && window.innerWidth > window.innerHeight;
  const [l, setL] = useState(q);
  useEffect(() => {
    const f = () => setL(q());
    window.addEventListener('resize', f);
    window.addEventListener('orientationchange', f);
    return () => { window.removeEventListener('resize', f); window.removeEventListener('orientationchange', f); };
  }, []);
  return l;
}

function GameScreen({ game, store, setStore, paused, onBack, banner, toast, toastText, ghost, onEco, sessions, onOpenSession }: {
  game: GameModule; store: GameStoreView; setStore: (f: (s: GameStoreView) => GameStoreView) => void;
  paused: boolean; onBack: () => void; banner: React.ReactNode; toast: (t: string) => void; toastText: string | null;
  ghost: Ghost | null; onEco: () => void; sessions: SessionMeta[]; onOpenSession: (id: string) => void;
}) {
  const { meta, Game } = game;
  const [save] = useState(() => (store.saves[meta.id] ?? null));
  const pending = useRef<{ state: unknown } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const landscape = useLandscape();
  const [anyway, setAnyway] = useState(false);
  const wantsSideways = meta.orientation === 'landscape' && !landscape && !anyway;
  const flush = useCallback(() => {
    if (!pending.current) return;
    const { state } = pending.current;
    pending.current = null;
    api.gameSave(meta.id, state).catch(() => {});
  }, [meta.id]);
  useEffect(() => () => { clearTimeout(timer.current); flush(); }, [flush]);
  useEffect(() => {
    const away = () => { if (document.hidden) flush(); };
    document.addEventListener('visibilitychange', away);
    window.addEventListener('pagehide', flush);
    return () => { document.removeEventListener('visibilitychange', away); window.removeEventListener('pagehide', flush); };
  }, [flush]);

  const onSave = useCallback((state: unknown) => {
    pending.current = { state };
    setStore((s) => ({ ...s, saves: { ...s.saves, [meta.id]: state } }));
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, state === null ? 0 : 800);
  }, [flush, meta.id, setStore]);
  const onScore = useCallback((score: number) => {
    api.gameScore(meta.id, score, !!meta.lowerIsBetter).then((r: any) => {
      setStore((s) => ({ ...s, best: { ...s.best, [meta.id]: r.best }, plays: { ...s.plays, [meta.id]: (s.plays[meta.id] ?? 0) + 1 } }));
      const bits: string[] = [];
      if (r.isBest && (store.plays[meta.id] ?? 0) > 0) { bits.push(`New best! ${fmtScore(meta, score)}`); buzz('reward'); }
      if (r.earned?.coins) bits.push(`+${r.earned.coins} coins`);
      if (r.earned?.crate) { bits.push('A crate dropped!'); sfx('fanfare'); }
      if (r.challenge?.keys) { bits.push('Challenge done: +1 key'); buzz('pass'); }
      if (ghost && ghostBeaten(meta, ghost, score)) {
        api.eco('ghost', { gameId: meta.id, crew: ghost.name }).then((g) => {
          if (g.result?.first) {
            toast(`You beat ${ghost.name}'s ghost! +1 key${g.result.item ? ` and ${ghost.name}'s Ghost aura` : ''}`);
            buzz('pass'); sfx('fanfare');
          }
          onEco();
        }).catch(() => {});
      }
      if (bits.length) toast(bits.join(' · '));
      onEco();
    }).catch(() => {});
  }, [meta, setStore, store.plays, toast, ghost, onEco]);
  const onAchieve = useCallback((id: string) => {
    const key = `${meta.id}:${id}`;
    if (store.achievements[key]) return;
    const a = meta.achievements.find((x) => x.id === id);
    setStore((s) => ({ ...s, achievements: { ...s.achievements, [key]: Date.now() } }));
    api.gameAchieve(key).catch(() => {});
    if (a) { toast(`Achievement: ${a.name} · +25 coins`); buzz('reward'); sfx('coin'); }
  }, [meta, setStore, store.achievements, toast]);

  return (
    <div className={`arcade game-${meta.id}${meta.orientation === 'landscape' ? ' sideways' : ''}${landscape ? ' is-landscape' : ''}`}>
      <header className="arcade-head">
        <button className="ghost" onClick={onBack} aria-label="Back to the arcade">‹</button>
        <h1>{meta.name}</h1>
        {ghost && <span className="ghost-chip" title={`${ghost.name}'s ghost`}><img src={sprite(ghost.sprite, 'idle')} alt="" />{fmtScore(meta, ghost.target)}</span>}
        <span className="arcade-best">Best {fmtScore(meta, store.best[meta.id])}</span>
      </header>
      {banner}
      <div className={`game-stage${paused || wantsSideways ? ' paused' : ''}`}>
        <Game save={save} onSave={onSave} onScore={onScore} onAchieve={onAchieve} paused={paused || wantsSideways} best={store.best[meta.id]} ghost={ghost} />
      </div>
      <CornerCrew sessions={sessions} corner={meta.safeCorner ?? 'br'} onOpen={onOpenSession} />
      {wantsSideways && (
        <div className="rotate-prompt">
          <span className="rotate-phone" aria-hidden="true" />
          <p>Turn your phone sideways — {meta.name} plays across the whole screen.</p>
          <button className="link" onClick={() => setAnyway(true)}>Play upright anyway</button>
        </div>
      )}
      {toastText && <div className="arcade-toast">{toastText}</div>}
    </div>
  );
}
