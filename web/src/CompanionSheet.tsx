import { useEffect, useState } from 'react';
import { api } from './api';
import { SpriteAvatar } from './ChatView';
import { nameColor } from './color';
import { fmtAgo } from './format';
import type { Companion, CrewInfo } from './types';

/** A crew member's card (item 40): who they are to you, from what actually
 *  happened. Mood in their own words, energy as what is left of their
 *  subscription, stats from the ledger, milestones they earned doing the
 *  work. Every number here comes from a record; none is decoration, and a
 *  number with no record behind it reads "no data". */

const big = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
const date = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function CompanionSheet({ crew, onClose }: { crew: CrewInfo; onClose: () => void }) {
  const [c, setC] = useState<Companion | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api.crewLife().then((r) => setC(r.companions.find((x) => x.name === crew.name) ?? null)).catch(() => setFailed(true));
  }, [crew.name]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet companion" onClick={(e) => e.stopPropagation()}>
        <div className="companion-head">
          <SpriteAvatar crew={crew} pose={c?.pose ?? 'idle'} size={104} />
          <div className="companion-id">
            <div className="companion-name" style={{ color: nameColor(crew.color) }}>{crew.name}</div>
            <div className="companion-sub">{c ? `Level ${c.level}` : ' '}{crew.model ? ` · ${crew.model}` : ''}</div>
            {c && <div className={`companion-mood ${c.mood.key}`}>{c.mood.line}</div>}
          </div>
        </div>

        {failed && <p className="map-empty">Couldn't reach the crew's records.</p>}
        {!failed && !c && <p className="map-empty">Reading…</p>}
        {c && (
          <>
            <div className="companion-energy">
              <span className="companion-label">Energy</span>
              {c.energy == null ? (
                <span className="companion-none">no data</span>
              ) : (
                <>
                  <span className="companion-bar"><span className={c.energy <= 10 ? 'low' : c.energy <= 30 ? 'mid' : ''} style={{ width: `${c.energy}%` }} /></span>
                  <span className="companion-pct">{c.energy}%</span>
                </>
              )}
            </div>

            <div className="companion-stats">
              <Stat n={big(c.calls)} label={c.callsToday ? `calls · ${c.callsToday} today` : 'calls'} />
              <Stat n={c.calls ? big(c.wrote) : null} label="tokens written" />
              <Stat n={c.longestThink == null ? null : big(c.longestThink)} label="longest think" />
              <Stat n={String(c.jobsVerified)} label={c.gatesFailed ? `shipped · ${c.gatesFailed} failed gates` : 'jobs shipped'} />
              <Stat n={String(c.streak)} label={c.bestStreak > c.streak ? `day streak · best ${c.bestStreak}` : 'day streak'} />
              <Stat n={c.joined == null ? null : date(c.joined)} label={c.lastWorked ? `joined · last ${fmtAgo(c.lastWorked)}` : 'joined'} />
            </div>

            <div className="companion-miles-head">Milestones · {c.milestones.filter((m) => m.earnedAt).length} of {c.milestones.length}</div>
            <ul className="companion-miles">
              {c.milestones.map((m) => (
                <li key={m.id} className={m.earnedAt ? 'earned' : ''}>
                  <span className="mile-label">{m.label}</span>
                  <span className="mile-how">{m.earnedAt ? `earned ${date(m.earnedAt)}` : m.how}</span>
                </li>
              ))}
            </ul>
            <p className="map-note">From the call ledger and the crew's own diary of gates passed and failed. Nothing here is typed for the screen.</p>
          </>
        )}
        <div className="sheet-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Stat({ n, label }: { n: string | null; label: string }) {
  return (
    <div className="map-stat">
      <div className={`map-stat-n${n == null ? ' none' : ''}`}>{n ?? 'no data'}</div>
      <div className="map-stat-label">{label}</div>
    </div>
  );
}

/** "While you were away" (item 40): on coming back after a while, whoever did
 *  the most says what the crew did -- counted, not guessed. Once per return. */
export function AwayGreeting({ crew }: { crew: CrewInfo[] }) {
  const [say, setSay] = useState<{ who: CrewInfo; text: string } | null>(null);
  useEffect(() => {
    let last = 0;
    try { last = Number(localStorage.getItem('roost-last-visit')) || 0; } catch { /* first visit */ }
    const mark = () => { try { localStorage.setItem('roost-last-visit', String(Date.now())); } catch { /* nicety */ } };
    mark();
    const onHide = () => { if (document.visibilityState === 'hidden') mark(); };
    document.addEventListener('visibilitychange', onHide);
    if (last && Date.now() - last > 6 * 3_600_000 && crew.length) {
      api.crewLife(last).then(({ away }) => {
        if (!away || !away.calls || !away.busiest) return;
        const who = crew.find((c) => c.name === away.busiest);
        if (!who) return;
        const bits = [`${away.calls} call${away.calls === 1 ? '' : 's'}`];
        if (away.shipped) bits.push(`${away.shipped} job${away.shipped === 1 ? '' : 's'} shipped`);
        if (away.failed) bits.push(`${away.failed} gate${away.failed === 1 ? '' : 's'} failed`);
        setSay({ who, text: `While you were away: ${bits.join(', ')}. I did the most of it.` });
      }).catch(() => {});
    }
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [crew.length]);
  if (!say) return null;
  return (
    <button className="away-greeting" onClick={() => setSay(null)} title="Tap to dismiss">
      <SpriteAvatar crew={say.who} pose="cheer" size={40} className="away-hop" />
      <span className="away-text"><strong style={{ color: nameColor(say.who.color) }}>{say.who.name}</strong> {say.text}</span>
    </button>
  );
}

/** Open a member's card from anywhere a face is drawn. */
export function openCompanion(crew: CrewInfo): void {
  window.dispatchEvent(new CustomEvent<CrewInfo>('roost:companion', { detail: crew }));
}

/** Mounted once, in App: renders the card that openCompanion asked for. */
export function CompanionHost() {
  const [crew, setCrew] = useState<CrewInfo | null>(null);
  useEffect(() => {
    const on = (e: Event) => setCrew((e as CustomEvent<CrewInfo>).detail);
    window.addEventListener('roost:companion', on);
    return () => window.removeEventListener('roost:companion', on);
  }, []);
  return crew ? <CompanionSheet crew={crew} onClose={() => setCrew(null)} /> : null;
}
