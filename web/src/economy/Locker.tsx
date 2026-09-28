import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { buzz } from '../haptics';
import { Icon } from '../icons';
import { SpriteAvatar } from '../ChatView';
import { CERT_NAME, PAINT_FILTER, PAINT_NAME, refreshLooks, setLooks } from './looks';
import { sfx } from './sound';

/** The locker (games wave 1): Roost Crates, the wardrobe and trade-ups.
 *  Rocket League's original crates, minus the money: coins buy crates,
 *  keys (from the daily challenge and ghosts) open them. */

export const RARITY_COLOR: Record<string, string> = {
  rare: '#6fb3ff', 'very-rare': '#8a7bff', import: '#e25555', exotic: '#e2c23c', 'black-market': '#d64fd6', ghost: '#e8f4ff',
};
const SLOT_NAME: Record<string, string> = { hat: 'Hats', prop: 'Props', aura: 'Auras', frame: 'Frames', title: 'Titles', celebration: 'Celebrations' };
const CREW = ['ollie', 'bram', 'wren', 'moss', 'fig', 'nell', 'juno', 'rue', 'bly', 'tuck', 'otto', 'pip'];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export interface EcoState {
  coins: number; keys: number;
  crates: Array<{ uid: string; crate: string; at: number; source: string }>;
  items: Array<{ uid: string; itemId: string; paint?: string; cert?: string; at: number; source: string }>;
  equipped: Record<string, Record<string, string>>;
  stats: Record<string, number>;
  shop: Array<{ id: string; name: string; price: number; onSale: boolean; free?: boolean; blurb: string; months?: number[] }>;
  freeReady: boolean;
  challenge: { gameId: string; target: number; text: string; host: string; done: boolean; lowerIsBetter?: boolean };
  log: Array<{ at: number; text: string; coins?: number; keys?: number }>;
  looks: Record<string, unknown>;
}
interface Def { id: string; slot: string; name: string; rarity: string; art: string; text?: string; series: string[] }

export function itemDef(id: string, catalog: Def[]): Def | undefined {
  if (id.startsWith('ghost-')) { const n = cap(id.slice(6)); return { id, slot: 'aura', name: `${n}'s Ghost`, rarity: 'ghost', art: id, series: [] }; }
  return catalog.find((d) => d.id === id);
}

export function ItemArt({ def, paint, size = 56 }: { def: Def; paint?: string; size?: number }) {
  const filter = paint ? PAINT_FILTER[paint] : undefined;
  if (def.slot === 'hat' || def.slot === 'prop') return <img className="item-art" src={`/items/${def.slot}s/${def.art}.webp`} alt="" style={{ width: size, height: size, filter }} />;
  if (def.slot === 'aura') return <span className="item-art item-aura" style={{ width: size, height: size }}><span className={`aura aura-${def.art}`} style={{ filter }} /></span>;
  if (def.slot === 'frame') return <span className={`item-art item-frame look-wrap frame-${def.art}`} style={{ width: size * 0.7, height: size * 0.7, margin: size * 0.15 }} />;
  if (def.slot === 'title') return <span className={`item-art crew-title title-${def.art}`}>{def.text}</span>;
  return <span className={`item-art item-cele confetti cele-${def.art}`} style={{ width: size, height: size }}><Icon name="sparkle" size={24} /></span>;
}

export function Coins({ n }: { n: number }) {
  return <span className="eco-coins"><img src="/items/coin.webp" alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />{n.toLocaleString()}</span>;
}
export function Keys({ n }: { n: number }) {
  return <span className="eco-keys"><img src="/items/key.webp" alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />{n} key{n === 1 ? '' : 's'}</span>;
}

export function Locker({ onBack, initialTab = 'crates' }: { onBack: () => void; initialTab?: 'crates' | 'wardrobe' | 'items' }) {
  const [s, setS] = useState<EcoState | null>(null);
  const [catalog, setCatalog] = useState<Def[]>([]);
  const [tab, setTab] = useState(initialTab);
  const [err, setErr] = useState<string | null>(null);
  const [opening, setOpening] = useState<{ crate: string; result?: { itemId: string; paint?: string; cert?: string } } | null>(null);
  const [crew, setCrew] = useState('ollie');
  const [slot, setSlot] = useState('hat');
  const [picking, setPicking] = useState<string[] | null>(null);

  useEffect(() => {
    api.economy().then(setS).catch((e) => setErr(String(e.message ?? e)));
    api.economyCatalog().then((c) => setCatalog(c.items)).catch(() => {});
  }, []);
  const act = async (action: Parameters<typeof api.eco>[0], body: object = {}) => {
    setErr(null);
    try {
      const r = await api.eco(action, body);
      setS(r.state);
      setLooks(r.state.looks);
      return r.result;
    } catch (e: any) { setErr(String(e.message ?? e)); return null; }
  };

  const open = async (uid: string, crate: string) => {
    setOpening({ crate });
    sfx('crate-shake');
    const r = await act('open', { uid });
    if (!r) { setOpening(null); return; }
    // Let the crate shake before the reveal.
    setTimeout(() => {
      setOpening({ crate, result: r });
      const rarity = r.item?.rarity ?? 'rare';
      sfx(rarity === 'black-market' || rarity === 'exotic' ? 'fanfare' : 'reveal');
      buzz(rarity === 'black-market' || rarity === 'exotic' ? 'pass' : 'reward');
    }, 1300);
  };

  const name = (crate: string) => s?.shop.find((c) => c.id === crate)?.name ?? crate;
  const byRarity = useMemo(() => {
    if (!s) return [];
    return [...s.items].sort((a, b) => (itemDef(b.itemId, catalog)?.rarity ?? '').localeCompare(itemDef(a.itemId, catalog)?.rarity ?? '') || b.at - a.at);
  }, [s, catalog]);
  if (!s) return <div className="center-note">{err ?? 'Opening the locker…'}</div>;
  const worn = new Set(Object.values(s.equipped).flatMap((l) => Object.values(l)));
  const crewName = cap(crew);
  const wearing = s.equipped[crewName] ?? {};

  return (
    <div className="arcade locker">
      <header className="arcade-head">
        <button className="ghost" onClick={onBack} aria-label="Back">‹</button>
        <h1>Locker</h1>
        <Coins n={s.coins} /> <Keys n={s.keys} />
      </header>
      <div className="segmented locker-tabs">
        {(['crates', 'wardrobe', 'items'] as const).map((t) => (
          <button key={t} className={tab === t ? 'seg active' : 'seg'} onClick={() => { setTab(t); setPicking(null); }}>
            {t === 'crates' ? `Crates${s.crates.length ? ` (${s.crates.length})` : ''}` : t === 'wardrobe' ? 'Dress up' : `Items (${s.items.length})`}
          </button>
        ))}
      </div>
      {err && <div className="error-note">{err}</div>}

      {tab === 'crates' && (
        <>
          <section>
            <h2 className="arcade-pack">Your crates</h2>
            {s.freeReady && (
              <button className="crate-card free" onClick={() => act('free').then((c) => c && open(c.uid, 'free'))}>
                <img src="/items/crates/free.webp" alt="" />
                <span><b>Daily Drop</b><br />Free today — tap to open.</span>
              </button>
            )}
            {s.crates.length === 0 && !s.freeReady && <p className="section-hint">No crates yet. They drop from game runs and shipped jobs, or buy one below.</p>}
            <div className="crate-grid">
              {s.crates.map((c) => (
                <button key={c.uid} className="crate-card" onClick={() => open(c.uid, c.crate)} disabled={c.crate !== 'free' && s.keys < 1}>
                  <img src={`/items/crates/${c.crate}.webp`} alt="" />
                  <span><b>{name(c.crate)}</b><br /><small>from {c.source}</small><br />{c.crate === 'free' || s.keys > 0 ? 'Open' : 'Needs a key'}</span>
                </button>
              ))}
            </div>
            {s.keys < 1 && s.crates.some((c) => c.crate !== 'free') && <p className="section-hint">Keys come from the daily challenge and beating ghosts in the arcade.</p>}
          </section>
          <section>
            <h2 className="arcade-pack">Shop</h2>
            <div className="crate-grid">
              {s.shop.filter((c) => !c.free).map((c) => (
                <button key={c.id} className={`crate-card${c.onSale ? '' : ' off'}`} disabled={!c.onSale || s.coins < c.price} onClick={() => act('buy', { crate: c.id })}>
                  <img src={`/items/crates/${c.id}.webp`} alt="" />
                  <span><b>{c.name}</b><br /><small>{c.blurb}</small><br />{c.onSale ? <Coins n={c.price} /> : 'Out of season'}</span>
                </button>
              ))}
            </div>
            <p className="section-hint">Odds, like the original Rocket League crates: Rare 55% · Very Rare 28% · Import 12% · Exotic 4% · Black Market 1%. One in five comes Painted, and a few come Certified. No real money, ever.</p>
          </section>
          <section>
            <h2 className="arcade-pack">Lately</h2>
            <ul className="eco-log">{s.log.slice(0, 8).map((l, i) => <li key={i}>{l.text}{l.coins ? <span className={l.coins > 0 ? 'plus' : 'minus'}> {l.coins > 0 ? '+' : ''}{l.coins}</span> : null}{l.keys ? <span className="plus"> {l.keys > 0 ? '+' : ''}{l.keys} key</span> : null}</li>)}</ul>
          </section>
        </>
      )}

      {tab === 'wardrobe' && (
        <>
          <div className="wardrobe-crew">
            {CREW.map((c) => (
              <button key={c} className={`wardrobe-pick${c === crew ? ' on' : ''}`} onClick={() => setCrew(c)} aria-label={cap(c)}>
                <img src={`/crew/${c}-idle.webp`} alt="" />
              </button>
            ))}
          </div>
          <div className="wardrobe-stage">
            <SpriteAvatar crew={{ name: crewName, sprite: crew, color: '#888', agent: 'claude', initial: crewName[0], role: 'chat', roleLabel: '', tier: 'worker', model: '' }} pose="idle" size={150} alive />
            <div className="wardrobe-name">{crewName}</div>
          </div>
          <div className="segmented wardrobe-slots">
            {Object.keys(SLOT_NAME).map((k) => (
              <button key={k} className={slot === k ? 'seg active' : 'seg'} onClick={() => setSlot(k)}>{SLOT_NAME[k]}</button>
            ))}
          </div>
          <div className="item-grid">
            <button className={`item-card none${!wearing[slot] ? ' worn' : ''}`} onClick={() => act('equip', { crew: crewName, slot, uid: null })}>Nothing</button>
            {s.items.filter((i) => itemDef(i.itemId, catalog)?.slot === slot).map((i) => {
              const d = itemDef(i.itemId, catalog)!;
              return (
                <button key={i.uid} className={`item-card${wearing[slot] === i.uid ? ' worn' : ''}`} style={{ '--rar': RARITY_COLOR[d.rarity] } as React.CSSProperties} onClick={() => { act('equip', { crew: crewName, slot, uid: i.uid }); sfx('equip'); }}>
                  <ItemArt def={d} paint={i.paint} />
                  <span className="item-name">{d.name}</span>
                  {i.paint && <span className="item-tag">{PAINT_NAME[i.paint]}</span>}
                  {i.cert && <span className="item-tag">Certified: {CERT_NAME[i.cert]}</span>}
                </button>
              );
            })}
          </div>
          {!s.items.some((i) => itemDef(i.itemId, catalog)?.slot === slot) && <p className="section-hint">No {SLOT_NAME[slot].toLowerCase()} yet — open crates to find some.</p>}
          <p className="section-hint">What they wear shows everywhere: the chat, home, the arcade and their card.</p>
        </>
      )}

      {tab === 'items' && (
        <>
          <div className="tradeup-bar">
            {picking ? (
              <>
                <span>Pick 5 of one rarity ({picking.length}/5)</span>
                <button className="chip" disabled={picking.length !== 5} onClick={async () => {
                  const r = await act('tradeup', { uids: picking });
                  setPicking(null);
                  if (r) setOpening({ crate: 'tradeup', result: r });
                }}>Trade up</button>
                <button className="link" onClick={() => setPicking(null)}>Cancel</button>
              </>
            ) : (
              <button className="chip" onClick={() => setPicking([])}>Trade up: 5 → 1 better</button>
            )}
          </div>
          <div className="item-grid">
            {byRarity.map((i) => {
              const d = itemDef(i.itemId, catalog);
              if (!d) return null;
              const on = picking?.includes(i.uid);
              const blocked = !!picking && (worn.has(i.uid) || d.rarity === 'black-market' || d.rarity === 'ghost');
              return (
                <button key={i.uid} className={`item-card${on ? ' picked' : ''}${worn.has(i.uid) ? ' worn' : ''}`} disabled={blocked} style={{ '--rar': RARITY_COLOR[d.rarity] } as React.CSSProperties}
                  onClick={() => picking && setPicking(on ? picking.filter((u) => u !== i.uid) : picking.length < 5 ? [...picking, i.uid] : picking)}>
                  <ItemArt def={d} paint={i.paint} />
                  <span className="item-name">{d.name}</span>
                  <span className="item-rarity">{d.rarity.replace('-', ' ')}</span>
                  {i.paint && <span className="item-tag">{PAINT_NAME[i.paint]}</span>}
                  {i.cert && <span className="item-tag">Certified</span>}
                </button>
              );
            })}
          </div>
          {s.items.length === 0 && <p className="section-hint">Nothing yet. Your first crate is waiting in Crates.</p>}
        </>
      )}

      {opening && (
        <div className="crate-open" onClick={() => opening.result && (setOpening(null), refreshLooks(true))}>
          {!opening.result ? (
            <img className="crate-shake" src={`/items/crates/${opening.crate === 'tradeup' ? 'season1' : opening.crate}.webp`} alt="" />
          ) : (() => {
            const d = itemDef(opening.result.itemId, catalog);
            if (!d) return null;
            return (
              <div className="crate-reveal" style={{ '--rar': RARITY_COLOR[d.rarity] } as React.CSSProperties}>
                <img className="crate-burst" src="/items/crates/open-burst.webp" alt="" />
                <ItemArt def={d} paint={opening.result.paint} size={120} />
                <div className="crate-rarity">{d.rarity === 'ghost' ? 'Ghost' : d.rarity.replace('-', ' ')}</div>
                <div className="crate-item">{opening.result.paint ? `${PAINT_NAME[opening.result.paint]} ` : ''}{d.name}</div>
                {opening.result.cert && <div className="item-tag">Certified: {CERT_NAME[opening.result.cert]}</div>}
                <div className="section-hint">Tap to keep it</div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
