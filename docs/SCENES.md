# Scenes — the crew off duty

*Design, 2026-09-24. Belongs on the design canvas as a board; written here first because the canvas was unreachable the day it was designed. Roadmap item 26.*

> Bulk the sleeping ones together in one area, maybe slightly stacked, one Zzz. Then turn the main area into a fun scene we rotate between — Pip, Ollie and Moss sitting around a table playing a game, throwing a ball in a bucket, a campfire with one on guitar, one on flute, one dancing. I want to come back to the app and laugh and then get excited to get back to work. Ten scenes, props, every character pluggable.

## What the home screen becomes

```
┌─────────────────────────────────────┐
│ ROOST                            ⚙  │
│ your crew, mid-conversation         │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │  THE SCENE  (512×256 backdrop)  │ │   ← the awake members, seated,
│ │     [Ollie]   ~fire~   [Moss]   │ │     with props; one of them
│ │   guitar        [Pip] dancing   │ │     typing if they are working
│ └─────────────────────────────────┘ │
│  Bunks:  (Bly)(Rue)(Tuck)(Otto)… zZ │   ← sleepers, stacked, one Zzz
├─────────────────────────────────────┤
│ NOW …  FUEL …                       │
└─────────────────────────────────────┘
```

- **The scene** holds the *awake* crew: anyone who is the crew of an open session or in one's `recentCrew`. Most recently active fills the first seat. A member who is **working right now** still sits in the scene, in the `type` pose at their seat, laptop prop — that is honest and it is funny. Up to four seats; a fifth awake member waits on the bunks edge, awake (idle pose), not asleep.
- **The bunks** hold the sleepers: overlapping by ~40%, `sleep` pose, dimmed as today, and **one** Zzz that visits them in turn (the visitor already built for item 16).
- **Rotation**: the scene index is `(dayOfYear × 24 + hour) mod 10`. It changes on the hour, on its own — the one ambient change on the page, and it is a *set change*, not a loop: nothing inside a scene moves on a timer. Tapping the scene cycles to the next one (a per-viewer convenience, not remembered).
- **Motion still reports state**: the only things that move are the members' existing two-frame cuts — `type` while working, the visiting Zzz, and the wake-up when you open a thread. The fire does not flicker. The ball does not fly. They are stills with the crew *in* them, which is the joke.

## The plug-in system

A scene is a backdrop plus **seats**. A seat is a position, a **pose**, an optional **prop** and an optional horizontal flip. Any member can take any seat because every member gets the same four new poses, drawn to the same layout rules as the seven they have:

| pose | what it is | why it is enough |
|---|---|---|
| `sit` | sitting on the ground, facing front, paws in lap | tables, blankets, logs, the bench |
| `side` | sitting, three-quarter view **facing left** | anything with a focal point; **flipped in CSS** for facing right, so one drawing serves both sides |
| `hold` | sitting facing front, both paws raised together in front of the chest | every hand-prop: guitar, flute, cards, ball, book, ladle, wrench, snowball, telescope — the prop is a separate drawing overlaid at a fixed offset over the paws |
| `dance` | standing, one foot up, arms out, eyes happy arcs | the dancer, the cheer at a snowman, the one who just won |

Props are drawn **once**, not per character (`web/public/scenes/props/<name>.webp`, 256px transparent). The `hold` pose's paws are at the same place on every character by prompt ("both paws raised together in front of the chest, at the vertical centre of the body"), so one offset works for all. Where it does not quite, `seats[].propOffset` nudges per seat, never per character.

Four new poses × 13 characters = 52 drawings, plus 10 backdrops and ~12 props. At ~50s a drawing that is about an hour of generation, plus the hue check and the crew-comparison sheet that caught Bram's and Rue's drift last time. **Done in slices**: the proof scene first with three characters, checked on the phone, then the poses for the rest of the crew, then the backdrops.

## The ten scenes

Backdrops are 512×256, drawn at 1024×512 and BOX-reduced. Seat positions are in the 512×256 space. Each scene lists its seats in fill order.

| # | scene | backdrop | seats (pose · prop) |
|---|---|---|---|
| 1 | **Campfire** | night, pines, a log ring, a fire in the middle | side · guitar (flip) · side · flute · dance · sit |
| 2 | **Card table** | a round table, four stools, cards and chips on the felt | hold · cards · hold · cards (flip) · side · cards · sit |
| 3 | **Ball and bucket** | a lawn, a bucket at the right, a chalk line | hold · ball · sit · sit · dance |
| 4 | **Picnic** | a checked blanket under a tree, a basket, sandwiches | sit · hold · sandwich · side · sit |
| 5 | **Stargazing** | a hill at night, a big sky, one shooting star | hold · telescope · side · side (flip) · sit |
| 6 | **Kitchen** | a counter, a big pot on the stove, hanging pans | hold · ladle · sit · hold · bowl · side |
| 7 | **Library** | tall shelves, a reading lamp, a rug | hold · book · side · sit · hold · book (flip) |
| 8 | **Workshop** | a bench, a pegboard of tools, a half-built robot | hold · wrench · side (flip) · sit · hold · gear |
| 9 | **Rooftop** | the roost at dusk, a chimney, string lights, the city below | side · side (flip) · dance · sit |
| 10 | **Snow day** | a snowy yard, a snowman they built, a sled | hold · snowball · dance · sit · side |

Backdrops share the crew's palette rules: flat blocks, one-pixel dark outline on objects, no gradients, a dark navy base that sits on the app's `--bg`. The sky in night scenes is the app's background colour so the card has no hard edge.

## The generation prompt, in one place

`scripts/scenes/gen.mjs` — the same `codex exec` + `image_gen` path as the crew, the same STYLE block verbatim, and `roster.json` carrying every character's `DESC` and `BODY` (moved out of the seven per-character `gen.mjs` files so the next drawing of Ollie is the same Ollie). Each character's `idle` frame is attached as a reference image so identity is held by picture, not only by words — the thing the hue check was guarding by hand.

## What is not in this

- The logo revisit (item 17) waits for this to exist, so the mark and the scene share a language.
- No sound, no parallax, no weather. The scenes are stills.
- ~~Scenes tied to the project~~ — built 2026-09-24: `## scene` in a project's `.roost/project.md` names a set by id (`campfire`, `library`, …); the most recently active session's project picks the home-screen set, until a tap moves on. `?scene=` still pins for review shots. A member's *own* preference remains an idea.
