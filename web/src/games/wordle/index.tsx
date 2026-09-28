import { Icon } from '../../icons';
import { useEffect, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { dayNumber, sprite } from '../types';
import { sfx } from '../../economy/sound';
import { buzz, ticks } from '../../haptics';
import {
  ROWS, answerFor, finish, forToday, ghostRows, ghostScore, hardModeError, isWord, keyMarks, mark, practiceAnswer, shareText, untilMidnight,
  type Mark, type Practice, type Save,
} from './logic';
import './style.css';

/** A five-letter word a day, the same for everyone. Wren watches your guesses.
 *  The save outlives the day on purpose: it carries the streak and the stats.
 *  Wave 3: hard mode, unlimited practice words, a stats histogram, and tiles
 *  that flip to reveal. */
export const meta: GameMeta = {
  id: 'wordle',
  name: 'Daily Word',
  blurb: 'One five-letter word a day. Six tries. Wren is rooting for you.',
  host: 'wren',
  pack: 'quick',
  lowerIsBetter: true,
  scoreKind: 'guesses',
  achievements: [
    { id: 'first', name: 'Got it', says: 'Solve a daily word.' },
    { id: 'quick', name: 'Sharp eye', says: 'Solve in three guesses or fewer.' },
    { id: 'streak-3', name: 'Habit', says: 'Solve three days in a row.' },
    { id: 'streak-7', name: 'Every day this week', says: 'Solve seven days in a row.' },
    { id: 'hard', name: 'No shortcuts', says: 'Solve the daily word in hard mode.' },
    { id: 'practice-5', name: 'Warm-up', says: 'Solve five practice words.' },
  ],
  inProgress: (s: { day?: number; done?: boolean; guesses?: string[] }) => s?.day === dayNumber() && !s.done && (s.guesses?.length ?? 0) > 0,
  ghostScore,
  safeCorner: 'tr',
};

const KEYS = ['qwertyuiop', 'asdfghjkl', '>zxcvbnm<'];
const FLIP = 260; // ms between tiles turning over
const WIN_SAYS = ['Wow. First try?!', 'Brilliant!', 'Lovely.', 'Nice one.', 'Phew, got it.', 'Just in time!'];

export function Game({ save, onSave, onScore, onAchieve, paused, ghost }: GameProps<Save & { practiceWins?: number }>) {
  const [today] = useState(dayNumber);
  const [s, setS] = useState<Save & { practiceWins?: number }>(() => forToday(save, today));
  const [mode, setMode] = useState<'daily' | 'practice'>('daily');
  const [typed, setTyped] = useState('');
  const [shake, setShake] = useState(false);
  const [note, setNote] = useState('');
  const [clock, setClock] = useState(untilMidnight);
  const [fresh, setFresh] = useState(-1); // the row flipping over right now
  const [stats, setStats] = useState(false);

  const practice: Practice | null = mode === 'practice' ? (s.practice ?? null) : null;
  const answer = practice ? practice.answer : answerFor(today);
  const guesses = practice ? practice.guesses : s.guesses;
  const done = practice ? practice.done : s.done;
  const hard = practice ? !!practice.hard : !!s.hard;
  const won = guesses.at(-1) === answer;
  const revealing = fresh >= 0;

  useEffect(() => {
    if (!s.done || paused) return;
    const t = setInterval(() => setClock(untilMidnight()), 20_000);
    return () => clearInterval(t);
  }, [s.done, paused]);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(''), 1600);
    return () => clearTimeout(t);
  }, [note]);
  useEffect(() => {
    if (fresh < 0) return;
    const t = setTimeout(() => setFresh(-1), FLIP * 5 + 400);
    return () => clearTimeout(t);
  }, [fresh]);

  const commit = (next: typeof s) => { setS(next); onSave(next); };

  const startPractice = () => {
    const p: Practice = { answer: practiceAnswer(today), guesses: [], done: false, hard: !!s.hard };
    commit({ ...s, practice: p }); setMode('practice'); setTyped(''); sfx('whoosh');
  };

  const bad = (why: string) => {
    setShake(true); setTimeout(() => setShake(false), 400);
    setNote(why); ticks(2); sfx('hit');
  };

  const press = (k: string) => {
    if (paused || done || revealing || stats) return;
    if (k === '<') return setTyped((t) => t.slice(0, -1));
    if (k === '>') {
      if (typed.length < 5) return bad('Five letters, please');
      if (!isWord(typed)) return bad('Not in the word list');
      if (hard) { const why = hardModeError(typed, guesses, answer); if (why) return bad(why); }
      const gs = [...guesses, typed];
      const hit = typed === answer;
      const end = hit || gs.length >= ROWS;
      const m = mark(typed, answer);
      const greens = m.filter((x) => x === 'g').length;
      setFresh(gs.length - 1); setTyped('');
      // The feel lands as the last tile turns over.
      setTimeout(() => {
        if (hit) { buzz('pass'); sfx('win'); }
        else if (end) { buzz('fail'); sfx('lose'); }
        else { ticks(Math.max(1, greens)); sfx(greens ? 'score' : 'tap'); }
      }, FLIP * 5);
      if (practice) {
        const p: Practice = { ...practice, guesses: gs, done: end };
        const wins = (s.practiceWins ?? 0) + (hit ? 1 : 0);
        if (wins >= 5) onAchieve('practice-5');
        commit({ ...s, practice: p, practiceWins: wins });
        return;
      }
      let next: typeof s = { ...s, guesses: gs };
      if (end) {
        next = finish(next, hit);
        onScore(hit ? gs.length : 7);
        if (hit) {
          onAchieve('first');
          if (gs.length <= 3) onAchieve('quick');
          if (next.streak >= 3) onAchieve('streak-3');
          if (next.streak >= 7) onAchieve('streak-7');
          if (s.hard) onAchieve('hard');
        }
      }
      commit(next);
      return;
    }
    if (typed.length < 5) setTyped((t) => t + k);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Enter') press('>');
      else if (e.key === 'Backspace') press('<');
      else if (/^[a-zA-Z]$/.test(e.key)) press(e.key.toLowerCase());
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const toggleHard = () => {
    if (guesses.length > 0 && !done) { setNote('Hard mode locks after your first guess'); return; }
    if (practice) commit({ ...s, practice: { ...practice, hard: !practice.hard } });
    else if (!s.done) commit({ ...s, hard: !s.hard });
    else { setNote('Hard mode applies from tomorrow'); commit({ ...s, hard: !s.hard }); }
    sfx('tap');
  };

  // Keyboard colours wait for the flip to finish on the row being revealed.
  const shown = revealing ? guesses.slice(0, fresh) : guesses;
  const keys = keyMarks(shown, answer);
  const last = shown.at(-1);
  const lastMarks = last ? mark(last, answer) : [];
  const greens = lastMarks.filter((m) => m === 'g').length;
  const yellows = lastMarks.filter((m) => m === 'y').length;
  const finished = done && !revealing;
  const pose = finished ? (won ? 'cheer' : 'sleep') : !last ? 'idle' : greens >= 3 ? 'dance' : greens + yellows >= 2 ? 'look1' : 'think';
  const says = note || (finished
    ? (won ? WIN_SAYS[guesses.length - 1] : `It was ${answer.toUpperCase()}.`)
    : practice && !last ? 'Practice word. No pressure.' : !last ? (hard ? 'Hard mode. Use every hint.' : 'Guess a word.') : greens >= 3 ? 'So close!' : 'Hmm…');
  const share = () => {
    const text = shareText(today, s.guesses, answerFor(today));
    navigator.clipboard?.writeText(text).then(() => setNote('Copied!'), () => setNote('Could not copy'));
  };

  const ghostOn = ghost && mode === 'daily';
  const gRow = ghostOn ? Math.min(ROWS, ghost.target) - 1 : -1;

  return (
    <div className="game-wordle-wrap">
      <div className="game-wordle-host">
        <img src={sprite('wren', pose)} alt="" key={pose} className="game-wordle-wren" />
        <span className="game-wordle-says">{says}</span>
        {s.streak > 0 && <span className="game-wordle-streak"><Icon name="flame" /> {s.streak}</span>}
      </div>
      <div className="game-wordle-modes">
        <button className={`game-wordle-mode${mode === 'daily' ? ' game-wordle-on' : ''}`} onClick={() => { setMode('daily'); setTyped(''); }}>Daily</button>
        <button className={`game-wordle-mode${mode === 'practice' ? ' game-wordle-on' : ''}`} onClick={() => { if (!s.practice) startPractice(); else { setMode('practice'); setTyped(''); } }}>Practice</button>
        <button className={`game-wordle-mode${hard ? ' game-wordle-on game-wordle-hardon' : ''}`} onClick={toggleHard}>Hard</button>
        <button className="game-wordle-mode" onClick={() => setStats(true)}>Stats</button>
      </div>
      {ghostOn && !finished && (
        <div className="game-wordle-ghost">
          <img src={sprite(ghost.sprite, 'think')} alt="" />
          <span>{ghost.target >= 7 ? `${ghost.name}'s ghost missed today` : `${ghost.name}'s ghost solved it in ${ghost.target}. Beat it in ${ghost.target - 1}.`}</span>
        </div>
      )}
      <div className="game-wordle-grid">
        {Array.from({ length: ROWS }, (_, r) => {
          const g = guesses[r];
          const cur = r === guesses.length && !done;
          const word = g ?? (cur ? typed : '');
          const m = g ? mark(g, answer) : null;
          const flipping = r === fresh;
          const winRow = finished && won && r === guesses.length - 1;
          return (
            <div key={`${mode}${r}`} className={`game-wordle-row${cur && shake ? ' game-wordle-shake' : ''}${r === gRow ? ' game-wordle-ghostrow' : ''}`}>
              {Array.from({ length: 5 }, (_, i) => (
                <span
                  key={i}
                  className={`game-wordle-tile${m ? ` game-wordle-${m[i]}` : word[i] ? ' game-wordle-filled' : ''}${flipping ? ' game-wordle-flip' : ''}${winRow ? ' game-wordle-hop' : ''}`}
                  style={flipping ? { animationDelay: `${i * FLIP}ms` } : winRow ? { animationDelay: `${i * 90}ms` } : undefined}
                >{word[i] ?? ''}</span>
              ))}
              {r === gRow && !finished && <img className="game-wordle-ghostface" src={sprite(ghost!.sprite, 'idle')} alt="" />}
            </div>
          );
        })}
      </div>
      {finished ? (
        <div className="game-wordle-done">
          {practice ? <>
            <p>{won ? `Solved in ${guesses.length}.` : `It was ${answer.toUpperCase()}.`} Practice doesn't touch your streak.</p>
            <button className="chip" onClick={startPractice}>Another word</button>
          </> : <>
            <p>{won ? `Solved in ${guesses.length}.` : 'Out of guesses.'} Next word in <b>{clock}</b></p>
            <div className="game-wordle-compare">
              <div>
                <small>You</small>
                <pre className="game-wordle-share">{shareText(today, s.guesses, answer).split('\n\n')[1]}</pre>
              </div>
              {ghost && <GhostBoard name={ghost.name} sprite={ghost.sprite} rows={ghostRows(ghost.target, today)} target={ghost.target} mine={won ? guesses.length : 7} />}
            </div>
            <div className="game-wordle-actions">
              <button className="chip" onClick={share}>Copy result</button>
              <button className="chip" onClick={startPractice}>Practice</button>
            </div>
          </>}
        </div>
      ) : (
        <div className="game-wordle-kb">
          {KEYS.map((row) => (
            <div key={row}>
              {row.split('').map((k) => (
                <button key={k} className={`game-wordle-key${k === '>' || k === '<' ? ' game-wordle-wide' : ''}${keys[k] ? ` game-wordle-${keys[k]}` : ''}`} onClick={() => press(k)} aria-label={k === '<' ? 'Delete' : k === '>' ? 'Enter' : k}>
                  {k === '>' ? 'Enter' : k === '<' ? <span className="game-wordle-del" /> : k}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      {stats && <Stats s={s} today={s.done && mode === 'daily' && won ? guesses.length : 0} onClose={() => setStats(false)} />}
    </div>
  );
}

function GhostBoard({ name, sprite: who, rows, target, mine }: { name: string; sprite: string; rows: Mark[][]; target: number; mine: number }) {
  return (
    <div className="game-wordle-ghostboard">
      <small><img src={sprite(who, mine < target ? 'sleep' : 'cheer')} alt="" /> {name}'s ghost</small>
      <div className="game-wordle-minigrid">
        {rows.map((r, i) => <div key={i}>{r.map((m, j) => <span key={j} className={`game-wordle-mini game-wordle-${m}`} />)}</div>)}
      </div>
      <small className="game-wordle-verdict">{mine < target ? 'You beat the ghost!' : mine === target ? 'A tie. The ghost holds.' : 'The ghost wins today.'}</small>
    </div>
  );
}

function Stats({ s, today, onClose }: { s: Save; today: number; onClose: () => void }) {
  const dist = s.dist ?? Array(ROWS + 1).fill(0);
  const played = s.played ?? 0;
  const wins = dist.slice(0, ROWS).reduce((a, b) => a + b, 0);
  const peak = Math.max(1, ...dist);
  return (
    <div className="game-wordle-stats" onClick={onClose}>
      <div className="game-wordle-card" onClick={(e) => e.stopPropagation()}>
        <h3>Stats</h3>
        <div className="game-wordle-nums">
          <div><b>{played}</b><small>played</small></div>
          <div><b>{played ? Math.round((wins / played) * 100) : 0}%</b><small>solved</small></div>
          <div><b>{s.streak}</b><small>streak</small></div>
          <div><b>{s.maxStreak ?? s.streak}</b><small>best streak</small></div>
        </div>
        <div className="game-wordle-hist">
          {dist.map((n, i) => (
            <div key={i} className="game-wordle-bar-row">
              <span>{i < ROWS ? i + 1 : 'X'}</span>
              <div className={`game-wordle-bar${today === i + 1 ? ' game-wordle-today' : ''}`} style={{ width: `${Math.max(8, (n / peak) * 100)}%`, animationDelay: `${i * 50}ms` }}>{n}</div>
            </div>
          ))}
        </div>
        <button className="chip" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
