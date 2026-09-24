import { useState } from 'react';
import { nameColor } from './color';
import { SCENES, placeCrew, sceneIndexFor, type Placed } from './scenes';
import type { CrewInfo } from './types';

/** The crew off duty (docs/SCENES.md): the awake members in a drawn scene,
 *  seated, with props; a working member sits and types with a laptop. Stills
 *  with the crew in them -- nothing inside a scene moves on a timer. The
 *  set changes on the hour; a tap cycles it.
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
