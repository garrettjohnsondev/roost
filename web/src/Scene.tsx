import { useState } from 'react';
import { nameColor } from './color';
import { SCENES, placeCrew, sceneIndexFor, type Ambient, type Placed } from './scenes';
import type { CrewInfo } from './types';

/** The crew off duty (docs/SCENES.md): the awake members in a drawn scene,
 *  seated, with props; a working member sits and types with a laptop. The
 *  crew only move for real state; the SET moves -- stars, fire, lamps, snow
 *  (AmbientLayer, CSS only, off under reduced motion; 2026-09-24: "each scene
 *  needs something animated"). The set changes on the hour; a tap cycles it.
 *
 *  A member without the scene pose drawn yet falls back to their idle frame
 *  in the seat, not to nothing and not to someone else's art. */
export function SceneView({ awake, onOverflow }: { awake: Array<{ member: CrewInfo; working: boolean }>; onOverflow?: (rest: CrewInfo[]) => void }) {
  const [taps, setTaps] = useState(0);
  const [missing, setMissing] = useState(false);
  if (!SCENES.length || missing) return null;
  // ?scene=<id> pins a set, for review shots (scripts/shoot.mjs).
  const pinned = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('scene') : null;
  const scene = SCENES.find((s) => s.id === pinned) ?? SCENES[sceneIndexFor(new Date(), taps)];
  const { placed, overflow } = placeCrew(awake, scene);
  onOverflow?.(overflow);
  return (
    <button
      className="scene"
      onClick={() => setTaps((t) => t + 1)}
      title={`${scene.name} — tap for the next scene`}
      aria-label={`${scene.name}: ${placed.map((p) => p.member.name).join(', ') || 'nobody is up yet'}`}
    >
      <img className="scene-bg" src={`/scenes/${scene.id}.webp`} alt="" onError={() => setMissing(true)} draggable={false} />
      {scene.ambient && <AmbientLayer id={scene.id} a={scene.ambient} />}
      {placed.map((p) => (
        <Seated key={p.member.name} placed={p} />
      ))}
      <span className="scene-name">{scene.name}</span>
    </button>
  );
}

function Seated({ placed: { member, seat, working } }: { placed: Placed }) {
  const [poseMissing, setPoseMissing] = useState(false);
  const pose = working ? 'type' : poseMissing ? 'idle' : seat.pose;
  // An idle fallback has its paws at its sides; a prop over them would float.
  const prop = working ? 'laptop' : poseMissing ? undefined : seat.prop;
  const flip = !working && seat.flip;
  // 512×256 space -> percentages, so the scene scales with the card.
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  // Lower on the ground draws in front: depth from y, not from seat order.
  const style = { left: pct(seat.x - seat.size / 2, 512), top: pct(seat.y - seat.size / 2, 256), width: pct(seat.size, 512), height: pct(seat.size, 256), zIndex: Math.round(seat.y) };
  const [ox, oy] = seat.propOffset ?? [0, 0];
  return (
    <span className={`seat${flip ? ' flip' : ''}${working ? ' working' : ''}`} style={style} title={`${member.name}${working ? ' — working' : ''}`}>
      {member.sprite ? (
        <img className="seat-sprite" src={`/crew/${member.sprite}-${pose}.webp`} alt="" onError={() => !poseMissing && setPoseMissing(true)} draggable={false} />
      ) : (
        <span className="seat-mono" style={{ background: nameColor(member.color) }}>{member.initial}</span>
      )}
      {prop && (
        <img
          className={`seat-prop prop-${prop}`}
          src={`/scenes/props/${prop}.webp`}
          alt=""
          style={{ transform: `translate(${(ox / seat.size) * 100}%, ${(oy / seat.size) * 100}%)${flip ? ' scaleX(-1)' : ''}` }}
          onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
          draggable={false}
        />
      )}
    </span>
  );
}

/** A small deterministic generator: the same scene always has the same
 *  stars in the same places, so nothing reshuffles on a re-render. */
function seeded(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

/** What moves in the set (see Ambient in scenes.ts). CSS animations only,
 *  each with its own duration and delay so nothing pulses in unison; all of
 *  it stops under reduced motion. Sits between the backdrop and the crew. */
function AmbientLayer({ id, a }: { id: string; a: Ambient }) {
  const rnd = seeded(id);
  const stars = a.stars
    ? Array.from({ length: a.stars.n }, (_, i) => {
        const x = a.stars!.x0 + rnd() * (a.stars!.x1 - a.stars!.x0);
        const y = a.stars!.y0 + rnd() * (a.stars!.y1 - a.stars!.y0);
        const big = rnd() < 0.18;
        return (
          <i
            key={`s${i}`}
            className={`amb-star${big ? ' big' : ''}`}
            style={{ left: pct(x, 512), top: pct(y, 256), animationDuration: `${3.5 + rnd() * 5}s`, animationDelay: `${-rnd() * 8}s` }}
          />
        );
      })
    : null;
  const snow = a.snow
    ? Array.from({ length: 34 }, (_, i) => (
        <i
          key={`f${i}`}
          className="amb-flake"
          style={{ left: pct(rnd() * 512, 512), animationDuration: `${7 + rnd() * 7}s`, animationDelay: `${-rnd() * 14}s`, opacity: 0.55 + rnd() * 0.45 }}
        />
      ))
    : null;
  const sh = a.shooting;
  return (
    <span className="amb" aria-hidden="true">
      {a.glows?.map((g, i) => (
        <i
          key={`g${i}`}
          className={`amb-glow ${g.kind}`}
          style={{
            left: pct(g.x - g.r, 512), top: pct(g.y - g.r, 256), width: pct(2 * g.r, 512), height: pct(2 * g.r, 256),
            background: `radial-gradient(closest-side, ${g.color}66, ${g.color}22 55%, transparent)`,
            animationDelay: `${-i * 0.7}s`,
          }}
        />
      ))}
      {stars}
      {sh && (
        <i
          className="amb-shooting"
          style={{
            left: pct(sh.x0, 512), top: pct(sh.y0, 256),
            ['--dx' as string]: `${((sh.x1 - sh.x0) / 512) * 100}cqw`,
            ['--dy' as string]: `${((sh.y1 - sh.y0) / 256) * 100}cqh`,
            // The backdrop's units are square (512x256 drawn 2:1), so this is the true angle.
            ['--angle' as string]: `${(Math.atan2(sh.y1 - sh.y0, sh.x1 - sh.x0) * 180) / Math.PI}deg`,
            animationDuration: `${sh.every}s`,
            animationDelay: `${-(rnd() * sh.every * 0.6) - sh.every * 0.2}s`,
          }}
        />
      )}
      {a.bulbs?.map(([x, y], i) => (
        <i key={`b${i}`} className="amb-bulb" style={{ left: pct(x, 512), top: pct(y, 256), animationDelay: `${i * 0.45}s` }} />
      ))}
      {a.steam && [0, 1, 2].map((i) => (
        <i key={`st${i}`} className="amb-steam" style={{ left: pct(a.steam![0] + (i - 1) * 5, 512), top: pct(a.steam![1], 256), animationDelay: `${i * 1.1}s` }} />
      ))}
      {a.blink && <i className="amb-blink" style={{ left: pct(a.blink.x, 512), top: pct(a.blink.y, 256), background: a.blink.color, color: a.blink.color }} />}
      {snow}
    </span>
  );
}
