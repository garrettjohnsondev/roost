import { useEffect, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { dayNumber, sprite } from '../types';
import { ROWS, answerFor, finish, forToday, isWord, keyMarks, mark, shareText, untilMidnight, type Save } from './logic';
import './style.css';

/** A five-letter word a day, the same for everyone. Wren watches your guesses.
 *  The save outlives the day on purpose: it carries the streak. */
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
  ],
  inProgress: (s: { day?: number; done?: boolean; guesses?: string[] }) => s?.day === dayNumber() && !s.done && (s.guesses?.length ?? 0) > 0,
};

const KEYS = ['qwertyuiop', 'asdfghjkl', '>zxcvbnm<'];

export function Game({ save, onSave, onScore, onAchieve, paused }: GameProps<Save>) {
  const [today] = useState(dayNumber);
  const [s, setS] = useState<Save>(() => forToday(save, today));
  const [typed, setTyped] = useState('');
  const [shake, setShake] = useState(false);
  const [note, setNote] = useState('');
  const [clock, setClock] = useState(untilMidnight);
  const answer = answerFor(today);
  const won = s.guesses.at(-1) === answer;

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

  const press = (k: string) => {
    if (paused || s.done) return;
    if (k === '<') return setTyped((t) => t.slice(0, -1));
    if (k === '>') {
      if (typed.length < 5 || !isWord(typed)) {
        setShake(true); setTimeout(() => setShake(false), 400);
        setNote(typed.length < 5 ? 'Five letters, please' : 'Not in the word list');
        return;
      }
      const guesses = [...s.guesses, typed];
      let next: Save = { ...s, guesses };
      const hit = typed === answer;
      if (hit || guesses.length >= ROWS) {
        next = finish(next, hit);
        onScore(hit ? guesses.length : 7);
        if (hit) {
          onAchieve('first');
          if (guesses.length <= 3) onAchieve('quick');
          if (next.streak >= 3) onAchieve('streak-3');
          if (next.streak >= 7) onAchieve('streak-7');
        }
      }
      setS(next); setTyped(''); onSave(next);
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

  const keys = keyMarks(s.guesses, answer);
  const last = s.guesses.at(-1);
  const greens = last ? mark(last, answer).filter((m) => m === 'g').length : 0;
  const pose = s.done ? (won ? 'cheer' : 'sleep') : !last ? 'idle' : greens >= 3 ? 'dance' : greens + (last ? mark(last, answer).filter((m) => m === 'y').length : 0) >= 2 ? 'look1' : 'think';
  const says = note || (s.done ? (won ? ['Wow. First try?!', 'Brilliant!', 'Lovely.', 'Nice one.', 'Phew, got it.', 'Just in time!'][s.guesses.length - 1] : `It was ${answer.toUpperCase()}.`) : !last ? 'Guess a word.' : greens >= 3 ? 'So close!' : 'Hmm…');
  const share = () => {
    const text = shareText(today, s.guesses, answer);
    navigator.clipboard?.writeText(text).then(() => setNote('Copied!'), () => setNote('Could not copy'));
  };

  return (
    <div className="game-wordle-wrap">
      <div className="game-wordle-host">
        <img src={sprite('wren', pose)} alt="" />
        <span className="game-wordle-says">{says}</span>
        {s.streak > 0 && <span className="game-wordle-streak">🔥 {s.streak}</span>}
      </div>
      <div className="game-wordle-grid">
        {Array.from({ length: ROWS }, (_, r) => {
          const g = s.guesses[r];
          const cur = r === s.guesses.length && !s.done;
          const word = g ?? (cur ? typed : '');
          const m = g ? mark(g, answer) : null;
          return (
            <div key={r} className={`game-wordle-row${cur && shake ? ' game-wordle-shake' : ''}`}>
              {Array.from({ length: 5 }, (_, i) => (
                <span key={i} className={`game-wordle-tile${m ? ` game-wordle-${m[i]}` : word[i] ? ' game-wordle-filled' : ''}`} style={m ? { animationDelay: `${i * 90}ms` } : undefined}>{word[i] ?? ''}</span>
              ))}
            </div>
          );
        })}
      </div>
      {s.done ? (
        <div className="game-wordle-done">
          <p>{won ? `Solved in ${s.guesses.length}.` : 'Out of guesses.'} Next word in <b>{clock}</b></p>
          <pre className="game-wordle-share">{shareText(today, s.guesses, answer).split('\n\n')[1]}</pre>
          <button className="chip" onClick={share}>Copy result</button>
        </div>
      ) : (
        <div className="game-wordle-kb">
          {KEYS.map((row) => (
            <div key={row}>
              {row.split('').map((k) => (
                <button key={k} className={`game-wordle-key${k === '>' || k === '<' ? ' game-wordle-wide' : ''}${keys[k] ? ` game-wordle-${keys[k]}` : ''}`} onClick={() => press(k)}>
                  {k === '>' ? 'Enter' : k === '<' ? '⌫' : k}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
