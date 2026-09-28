import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { GAMES, PACK_TITLE } from './registry';
import { fmtScore, sprite, type GameModule, type GameStoreView } from './types';
import type { SessionMeta } from '../types';

/** The arcade (roadmap #55): something to play in line or between meetings
 *  while the crew works. Saves, bests and achievements live on the Mac.
 *  When a chat needs you, a banner slides over the paused game: one tap
 *  answers, and the game is right where you left it. */
export function Arcade({ onBack, onOpenSession }: { onBack: () => void; onOpenSession: (id: string) => void }) {
  const [store, setStore] = useState<GameStoreView | null>(null);
  const [playing, setPlaying] = useState<GameModule | null>(() => {
    const id = new URLSearchParams(location.search).get('game');
    return GAMES.find((g) => g.meta.id === id) ?? null;
  });
  const [waiting, setWaiting] = useState<SessionMeta[]>([]);
  const [hidden, setHidden] = useState(document.hidden);
  const [toast, setToast] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string>('');

  useEffect(() => { api.games().then(setStore).catch(() => setStore({ saves: {}, best: {}, plays: {}, achievements: {} })); }, []);
  useEffect(() => {
    const tick = () => api.sessions().then((r) => setWaiting(r.sessions.filter((s) => s.needsYou))).catch(() => {});
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
  };

  const waitKey = waiting.map((w) => w.id).join(',');
  const banner = waiting.length > 0 && dismissed !== waitKey ? waiting[0] : null;

  if (!store) return <div className="center-note">Opening the arcade…</div>;

  if (playing) {
    return (
      <GameScreen
        key={playing.meta.id}
        game={playing}
        store={store}
        setStore={(f) => setStore((s) => (s ? f(s) : s))}
        paused={!!banner || hidden}
        onBack={() => open(null)}
        toast={setToast}
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
  return (
    <div className="arcade">
      <header className="arcade-head">
        <button className="ghost" onClick={onBack} aria-label="Back">‹</button>
        <h1>Arcade</h1>
        <span className="arcade-trophies" title="Achievements">🏆 {earned}/{total}</span>
      </header>
      {banner && (
        <div className="arcade-banner" role="alert">
          <img src={sprite(banner.crew?.sprite ?? 'pip', 'peek')} alt="" />
          <span><b>{banner.crew?.name ?? 'The crew'}</b> needs you in “{banner.title}”</span>
          <button className="chip" onClick={() => onOpenSession(banner.id)}>Answer</button>
        </div>
      )}
      {packs.map((p) => (
        <section key={p}>
          <h2 className="arcade-pack">{PACK_TITLE[p] ?? p}</h2>
          <div className="arcade-grid">
            {GAMES.filter((g) => (g.meta.pack ?? 'quick') === p).map((g) => {
              const saved = store.saves[g.meta.id] != null;
              const got = g.meta.achievements.filter((a) => store.achievements[`${g.meta.id}:${a.id}`]).length;
              return (
                <button key={g.meta.id} className="arcade-card" onClick={() => open(g)}>
                  <img className="arcade-host" src={sprite(g.meta.host, saved ? 'peek' : 'idle')} alt="" />
                  <span className="arcade-name">{g.meta.name}</span>
                  <span className="arcade-blurb">{g.meta.blurb}</span>
                  <span className="arcade-meta">
                    {saved ? <b>Resume</b> : <>Best {fmtScore(g.meta, store.best[g.meta.id])}</>}
                    {g.meta.achievements.length > 0 && <> · 🏆 {got}/{g.meta.achievements.length}</>}
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

function GameScreen({ game, store, setStore, paused, onBack, banner, toast, toastText }: {
  game: GameModule; store: GameStoreView; setStore: (f: (s: GameStoreView) => GameStoreView) => void;
  paused: boolean; onBack: () => void; banner: React.ReactNode; toast: (t: string) => void; toastText: string | null;
}) {
  const { meta, Game } = game;
  const [save] = useState(() => (store.saves[meta.id] ?? null));
  const pending = useRef<{ state: unknown } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
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
    api.gameScore(meta.id, score, !!meta.lowerIsBetter).then((r) => {
      setStore((s) => ({ ...s, best: { ...s.best, [meta.id]: r.best }, plays: { ...s.plays, [meta.id]: (s.plays[meta.id] ?? 0) + 1 } }));
      if (r.isBest && (store.plays[meta.id] ?? 0) > 0) toast(`New best! ${fmtScore(meta, score)}`);
    }).catch(() => {});
  }, [meta, setStore, store.plays, toast]);
  const onAchieve = useCallback((id: string) => {
    const key = `${meta.id}:${id}`;
    if (store.achievements[key]) return;
    const a = meta.achievements.find((x) => x.id === id);
    setStore((s) => ({ ...s, achievements: { ...s.achievements, [key]: Date.now() } }));
    api.gameAchieve(key).catch(() => {});
    if (a) toast(`🏆 ${a.name}`);
  }, [meta, setStore, store.achievements, toast]);

  return (
    <div className={`arcade game-${meta.id}`}>
      <header className="arcade-head">
        <button className="ghost" onClick={onBack} aria-label="Back to the arcade">‹</button>
        <h1>{meta.name}</h1>
        <span className="arcade-best">Best {fmtScore(meta, store.best[meta.id])}</span>
      </header>
      {banner}
      <div className={`game-stage${paused ? ' paused' : ''}`}>
        <Game save={save} onSave={onSave} onScore={onScore} onAchieve={onAchieve} paused={paused} best={store.best[meta.id]} />
      </div>
      {toastText && <div className="arcade-toast">{toastText}</div>}
    </div>
  );
}
