// Draw scene assets with the same pipeline that drew the crew: `codex exec`
// with image_gen, 1024px transparent frames, the crew's STYLE block verbatim.
//
//   node scripts/scenes/gen.mjs poses pip ollie moss      # 4 scene poses each
//   node scripts/scenes/gen.mjs scene campfire            # one backdrop
//   node scripts/scenes/gen.mjs props guitar flute laptop # hand props
//   node scripts/scenes/gen.mjs work ollie juno           # 6 working frames each (item 38)
//   node scripts/scenes/gen.mjs relight all                # AM twin of every backdrop
//
// Output: .roost-data/scene-raw/{poses/<name>,scenes,props}/. Then
// scripts/scenes/convert.py checks hue against the character's idle frame
// and writes the 256px webps the app serves. Idempotent: an existing file
// is skipped, so a failed run is re-run, not redone.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const RAW = join(REPO, '.roost-data', 'scene-raw');
const SPRITE_RAW = join(REPO, '.roost-data', 'sprite-raw');
const ROSTER = JSON.parse(readFileSync(join(HERE, 'roster.json'), 'utf8'));

// The crew's style block, verbatim from the per-character gen scripts.
const STYLE = [
  'CRITICAL: genuinely TRANSPARENT background (alpha channel, nothing behind the character).',
  'CRITICAL: save the image into the CURRENT WORKING DIRECTORY under the exact filename given.',
  'CRITICAL: this MUST be literal retro PIXEL ART -- like a 16-bit console game sprite -- NOT a smooth',
  'painterly illustration, NOT soft-shaded, NOT airbrushed, NOT a glossy vector/clipart mascot.',
  '',
  'Style, changing only the pose:',
  '"Pixel art creature sprite on a fully transparent background, cute chunky round-bodied character with a',
  'crisp dark one-pixel outline, LOW RESOLUTION with large VISIBLE SQUARE PIXEL BLOCKS and hard aliased',
  'edges (absolutely no smoothing, no soft gradients, no anti-aliasing, no airbrush shading -- flat blocks',
  'of colour only, like classic 16-bit game sprite art), centered, full body, short stubby legs,',
  'BIG FRIENDLY PIXEL EYES with a single white highlight pixel in each, NO SCARF, no clothing,',
  'no accessories of any kind other than described, no text, no lettering, no letter Z, no drop shadow,',
  'the character fills about 80 percent of the frame."',
].join('\n');

// The four scene poses (docs/SCENES.md). `hold` draws EMPTY paws: the prop
// is a separate drawing overlaid at a fixed offset, one per prop, not per
// character. `side` faces LEFT only; the app flips it for the other side.
export const SCENE_POSES = [
  ['sit', 'SITTING on the ground facing front, feet out in front, both paws resting in its lap, eyes open and content, looking straight ahead'],
  ['side', 'SITTING, seen in THREE-QUARTER VIEW FACING LEFT (face and body turned toward the left edge of the image), paws resting in front, eyes open, looking toward the left'],
  ['hold', 'SITTING facing front with BOTH PAWS RAISED TOGETHER in front of its chest, side by side at the vertical centre of the body, as if about to hold a small object -- draw NO object, the paws are EMPTY -- eyes open, looking down at its paws'],
  ['dance', 'DANCING: standing on one foot with the other foot kicked up to the side, both arms stretched out wide, body leaning to one side, eyes squeezed into happy curved arcs, a big open smile'],
];

// Item 38: four drawings each for typing and thinking. The existing `type` and
// `think` frames are the first of each; these are the other three. Each set
// reads as a little loop -- left paw, right paw, a finished flourish; tilt one
// way, the other, then the idea.
export const WORK_POSES = [
  ['type2', 'WORKING HARD at an invisible keyboard: leaning slightly forward, LEFT paw pressed down low as if striking a key, RIGHT paw lifted high above it, eyes looking down, focused'],
  ['type3', 'WORKING HARD at an invisible keyboard: leaning slightly forward, RIGHT paw pressed down low as if striking a key, LEFT paw lifted high above it, eyes looking down, the tip of its tongue poking out in concentration'],
  ['type4', 'WORKING HARD, a pause between keystrokes: sitting up straight, both paws resting together low in front, eyes looking up and to the side as if reading back what it wrote, small content smile'],
  ['think2', 'THINKING: head tilted to its LEFT, one paw resting on its chin, eyes looking up and to the left, mouth a small flat line'],
  ['think3', 'THINKING: head tilted to its RIGHT, both paws folded across its belly, eyes half closed, a small pondering frown'],
  ['think4', 'THINKING, the idea arriving: looking straight up, one paw raised high with the paw tip pointing upward, eyes wide, mouth open in a small round "oh"'],
];

/** The phase bar's poses (2026-09-25): "two new animations per character per
 *  status... build the character is building something, plan writing on a
 *  clipboard." Two drawings per phase, played as a pair while the phase runs. */
export const PHASE_POSES = [
  ['look1', 'LOOKING THINGS OVER: holding a small magnifying glass up to one eye with one paw, leaning a little to its LEFT, peering closely, the other paw on its hip'],
  ['look2', 'LOOKING THINGS OVER: holding the same small magnifying glass out at arm length to its RIGHT, eyes wide and curious, eyebrows raised'],
  ['plan1', 'PLANNING: holding a small brown clipboard with white paper against its belly with one paw, a yellow pencil in the other paw touching the paper as it writes, eyes down on the page'],
  ['plan2', 'PLANNING: holding the same small clipboard, the yellow pencil lifted and tapping its chin, eyes looking up thoughtfully'],
  ['review1', 'REVIEWING: holding a single white page of paper up in front of it with both paws, reading it closely, small round glasses on its face, a serious look'],
  ['review2', 'REVIEWING: holding the same white page lowered to one side, small round glasses pushed up, one paw giving a small thumbs up, a satisfied nod'],
  ['build1', 'BUILDING: holding a small wooden hammer raised high above its head with both paws, about to strike a small wooden block on the ground in front of it, determined look'],
  ['build2', 'BUILDING: the same small wooden hammer brought down striking the small wooden block on the ground in front of it, a tiny spark at the point of impact, eyes squeezed with effort'],
  ['test1', 'TESTING: holding up a small glass flask with bright green liquid in one paw, peering at it closely, the other paw raised a little'],
  ['test2', 'TESTING: gently swirling the same small glass flask of bright green liquid, three small bubbles rising out of it, eyes wide watching the result'],
];

const SCENES = {
  campfire: 'a night campsite: a small campfire with an orange-and-yellow flame in the lower middle, three short brown logs arranged around it as seats (one at the left, one at the right, one at the front-left), a few dark pine trees behind, a scatter of small stars in the navy sky',
  cards: 'a round wooden card table seen slightly from above, four short stools around it, a few playing cards and small poker chips on the green felt top, a warm hanging lamp above, a dark room behind',
  bucket: 'a small green lawn at dusk, a grey metal bucket standing at the right, a chalk line on the grass at the left, a low wooden fence behind, the navy sky above',
  picnic: 'a red-and-white checked picnic blanket on grass under one big leafy tree, a wicker basket and two sandwiches on the blanket, the navy evening sky',
  stargazing: 'a grassy hill at night under a huge navy sky full of small stars and one shooting star, a small telescope on a tripod at the right',
  kitchen: 'a cosy kitchen counter with a big pot steaming on a stove, a few pans hanging above, a window with night outside, tiled floor',
  library: 'a library nook: tall wooden bookshelves full of colourful book spines, a warm reading lamp, a round rug on the floor',
  workshop: 'a workshop bench with a pegboard of tools behind it, a half-built small robot on the bench, a toolbox on the floor, a hanging work lamp',
  rooftop: 'a flat rooftop at dusk with a brick chimney, a string of small warm lights, a low parapet, and a city of small lit windows below under a navy sky',
  snow: 'a snowy yard at night: a snowman with a carrot nose and a scarf, a wooden sled, a snow-covered fence, falling snow dots against the navy sky',
  // Item 39: thirty more, one a day.
  beach: 'a sandy beach at night with a small bonfire on the sand at the left, dark waves rolling in with white foam lines, a full moon over the sea',
  lighthouse: 'a rocky grassy point at night with a tall white-and-red lighthouse at the right casting a pale yellow beam across the navy sky, the dark sea behind',
  arcade: 'a retro video arcade at night: a row of glowing arcade cabinets along the back wall with bright pixel screens, a checkered floor, neon strip lights',
  greenhouse: 'inside a glass greenhouse at night: potted plants and hanging ferns on wooden shelves, moonlight through the glass panes, a watering can on the floor',
  station: 'an empty train platform at night: a wooden bench, a round station clock on a post, a hanging lamp, rails and a dark tunnel mouth at the back',
  treehouse: 'the wooden deck of a treehouse at night: plank floor, a rope railing, a hanging paper lantern, thick branches and leaves around, stars through the gaps',
  bakery: 'a cosy bakery at night: a wooden counter with loaves and round pastries, a brick oven glowing orange at the back, flour sacks on the floor',
  ramen: 'a small street ramen stall at night: a wooden counter with stools, red paper lanterns hanging from the awning, a big steaming pot at the right, a dark alley behind',
  observatory: 'inside an observatory dome at night: a huge brass telescope pointing up through an open slit in the dome, stars visible through the slit, a curved metal wall',
  cafe: 'a cafe table by a big rainy window at night: raindrops on the glass, city lights blurred outside, two coffee cups and a small plant on the table',
  studio: 'a music recording studio: a microphone on a stand at the left, a mixing desk with many small lit buttons, two speakers, foam panels on the walls',
  pottery: 'a pottery studio: a potter\'s wheel with a half-made clay pot, wooden shelves of finished pots and bowls behind, a bucket of water on the floor',
  bowling: 'a bowling alley: one polished wooden lane stretching back to ten white pins at the far end, a ball return at the side, neon score screen above',
  aquarium: 'inside an aquarium tunnel: a curved glass tunnel with deep blue water around it, colourful pixel fish and a small shark swimming past, soft blue light',
  orchard: 'an apple orchard in autumn at dusk: rows of trees with red apples, a wooden crate full of apples, orange leaves on the grass, a navy evening sky',
  lanterns: 'a lantern festival at night: dozens of glowing paper lanterns floating up over a calm dark river, a small wooden bridge at the right',
  icerink: 'an outdoor ice rink at night: pale blue ice, a low wooden boundary wall, pine trees with string lights behind, snow on the ground at the edges',
  summit: 'a mountain summit just before dawn: rocky ground, a small flag on a pole, a sea of clouds below, the sky navy at the top fading to pink at the horizon',
  oasis: 'a desert oasis at night: a small pool of water ringed by palm trees, sand dunes behind, a crescent moon and stars in the navy sky',
  spaceship: 'the bridge of a small spaceship: a huge window showing stars and a ringed planet, blinking control consoles along the bottom, a captain\'s chair',
  submarine: 'inside a small submarine cabin: a big round porthole showing deep blue water and a jellyfish, brass pipes and dials on the walls, a metal floor',
  castle: 'a castle great hall at night: a long wooden table, stone walls with hanging banners, iron wall torches burning, a tall arched window with the moon',
  garage: 'a garage band practice space: a drum kit at the back, a guitar amplifier, posters on the walls, a string of fairy lights, a concrete floor',
  laundromat: 'a laundromat at night: a row of front-loading washing machines along the back wall with round glowing doors, a folding table, flickering ceiling lights',
  busstop: 'a bus stop on a rainy night: a small glass shelter with a bench, a streetlight casting a yellow pool of light, puddles reflecting it, rain streaks',
  lake: 'a still lake at night: a small wooden rowboat on the water, tall reeds at the edge, the full moon and its reflection on the water, dark hills behind',
  blossom: 'a park in spring at dusk: cherry blossom trees heavy with pink flowers, a wooden bench, pink petals on the path, a lamppost',
  mushrooms: 'a forest floor at night full of giant glowing mushrooms in teal and purple, mossy roots, tiny floating firefly dots',
  hotspring: 'an outdoor hot spring at night: a steaming rocky pool, snow on the rocks around it, a small wooden sign, pine trees and stars behind',
  carnival: 'a carnival at night: a big ferris wheel lit with many small bulbs at the back, striped tents, a ticket booth, lights strung between poles',
};

const PROPS = {
  guitar: 'a small acoustic guitar with a warm wood body, standing upright at a slight angle',
  flute: 'a small silver flute, horizontal',
  laptop: 'a small open laptop seen from the front, dark screen showing a few short light-green code-line pixels',
  cards: 'a small fan of three playing cards held together, faces showing',
  ball: 'a small red rubber ball',
  telescope: 'a small brass hand telescope, angled up to the right',
  ladle: 'a small wooden soup ladle',
  bowl: 'a small steaming bowl of soup',
  book: 'a small open book with cream pages',
  wrench: 'a small grey adjustable wrench',
  gear: 'a small brass cog wheel',
  snowball: 'a small round white snowball',
  sandwich: 'a small sandwich on a plate',
};


// Each crew member's level-up hat (tier 2 onward) and sash colour.
const OUTFIT = {
  pip: ['a small red baseball cap', 'red'],
  ollie: ['a small dark-blue scholar mortarboard cap with a gold tassel', 'gold'],
  bram: ['a small green feathered hunter hat with a red feather', 'green'],
  wren: ['a small pink beret', 'pink'],
  moss: ['a small straw sun hat with a band of tiny flowers', 'leaf-green'],
  fig: ['a small wreath of tiny pink and white flowers worn as a flower hat', 'pink'],
  nell: ['a small navy sailor captain cap with a white top', 'navy-blue'],
  juno: ['a small black top hat with a red band', 'red'],
  rue: ['a small purple witchy pointed hat with a floppy brim', 'purple'],
  bly: ['a small yellow-and-black striped beanie', 'black'],
  tuck: ['a small yellow construction hard hat', 'orange'],
  otto: ['a small blue knitted fisherman beanie', 'blue'],
};
function outfitKit(name, tier) {
  const [hat, col] = OUTFIT[name];
  const sash = `a ${col} sash running diagonally across the body from one shoulder to the opposite hip`;
  const shades = 'small black pixel sunglasses over the eyes (with a single white glint pixel)';
  const medal = 'a gold chain necklace with a round gold medallion resting on the chest';
  if (tier === 1) return sash;
  if (tier === 2) return `${sash}; ${hat} on top of the head`;
  if (tier === 3) return `${sash}; ${hat} on top of the head; ${shades}; ${medal}`;
  return `FULL WIZARD REGALIA: a deep purple wizard cape/robe with gold star trim draped over the shoulders and back (body colour still visible at the front); a small gold crown with red gems on top of the head; one paw holding a tall wooden wizard staff topped with a glowing blue gem, the staff standing upright beside the body; a small glowing lavender crystal ball on a tiny gold stand on the ground at its feet; ${shades}; ${medal}. Keep the eyes, pose and body colours exactly as attached`;
}

const BACKDROP_STYLE = [
  'CRITICAL: this MUST be literal retro PIXEL ART -- a 16-bit game background -- LOW RESOLUTION with large',
  'VISIBLE SQUARE PIXEL BLOCKS and hard aliased edges, flat blocks of colour, crisp one-pixel dark outlines',
  'on objects, no gradients, no anti-aliasing, no airbrush shading. NO characters, NO people, NO animals,',
  'NO text. Landscape composition. The base/sky colour is a deep navy (#0d1424) so the scene sits on a dark',
  'app background. Keep the lower-middle third as open, uncluttered floor so characters can be placed there.',
  'CRITICAL: save the image into the CURRENT WORKING DIRECTORY under the exact filename given.',
].join('\n');

function run(args, cwd, label) {
  return new Promise((res, rej) => {
    const c = spawn('codex', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    c.stdout.resume();
    c.stderr.on('data', (d) => (err += d));
    const t = setTimeout(() => { c.kill('SIGKILL'); rej(new Error(`${label}: timeout`)); }, 20 * 60_000);
    c.on('close', (code) => { clearTimeout(t); code === 0 ? res() : rej(new Error(`${label}: exit ${code} ${err.slice(-200)}`)); });
  });
}

// Shop and arcade items: game logos, hats, held props, crates, currency.
const ITEMS = {
  logos: {
    frame: 'A bold ICONIC EMBLEM like an arcade cabinet badge: one simple, high-contrast symbol with a few strong colours, big readable shapes that stay recognisable when shrunk to 64 pixels, centred, filling about 80 percent of the frame. No border text, no banner with words.',
    list: {
      snake: 'a winding pixel snake-trail made of a conga line of golden seeds and small feathers, curling in an S shape, with a seed at the head',
      minesweeper: 'a shovel stuck diagonally into a brown dirt mound with a small red triangular flag planted on top',
      battleship: 'a round twig nest floating on a small blue pond, with a red target crosshair over it',
      solitaire: 'three playing cards fanned out (card backs and simple red and black suit pips, no letters or numbers) with a white feather laid across them',
      memory: 'two face-down playing cards with a patterned back, the right one mid-flip, tilted, showing a sliver of its bright face',
      hatch: 'a cream egg cracking open with a zigzag crack, sitting on a rounded square sliding-puzzle tile in warm orange, with small tile corners peeking behind it',
      wordle: 'a 3 by 3 grid of rounded square tiles coloured green, yellow and grey, all blank with no letters',
      stack: 'a tall tower of wooden planks stacked slightly offset from one another, the top plank sliding in',
      flappy: 'a single feathered wing flapping upward between two vertical tree branches, one from the top and one from the bottom, like pipes',
      breakout: 'a white egg used as a ball flying upward toward a row of colourful bricks, a paddle below',
      fieldgoal: 'a brown american football spinning through yellow goal-post uprights',
      baseball: 'a wooden baseball bat hitting a white baseball with a bright yellow impact spark',
      soccer: 'a black and white soccer ball hitting a goal net, the net bulging',
      basketball: 'an orange basketball swishing through a red hoop with a white net',
      roostbirds: 'a wooden Y slingshot with a round bird-shaped stone in the pouch and a small green beetle beside it',
      bugsiege: 'a stone shield-shaped tower with a small flag, with three little beetles marching toward it in a line',
      crewkart: 'a small red go-kart seen from the front three-quarter view, with a black and white checkered racing flag behind it',
    },
  },
  hats: {
    frame: 'A HAT ALONE, no head, no character, FRONT VIEW, centred horizontally, and placed at the BOTTOM of the frame: the brim/base sits about 10 percent above the bottom edge, with empty transparent space above the hat. The hat fills about 70 percent of the width.',
    list: {
      beanie: 'a knitted teal beanie with a folded cuff and a pompom', cap: 'a red baseball cap with a curved brim facing front',
      tophat: 'a black top hat with a red band', crown: 'a golden royal crown with red and blue gems',
      beret: 'a red french beret tilted slightly', cowboy: 'a brown cowboy hat with a wide curled brim',
      wizard: 'a tall blue pointed wizard hat with yellow stars and a wide brim', party: 'a striped cone party hat with a pompom on top',
      chef: 'a tall white puffy chef toque', pirate: 'a black pirate tricorn hat with a white skull-and-crossbones patch',
      viking: 'a grey metal viking helmet with two white horns', halo: 'a glowing golden halo ring floating level, seen slightly from above',
      flowerwreath: 'a wreath of pink, white and yellow flowers with green leaves, seen from the front', hardhat: 'a yellow construction hard hat',
      headphones: 'a pair of chunky over-ear headphones with a headband arching over, the ear cups at the bottom', propeller: 'a propeller beanie cap in primary colour segments with a small propeller on top',
      santa: 'a red santa hat with white fur trim and a white pompom flopping to the side', pumpkin: 'a hollowed orange pumpkin worn as a hat with a green stem, no face',
      bunnyears: 'a headband with two tall white-and-pink bunny ears', sombrero: 'a wide straw sombrero with colourful embroidered band',
    },
  },
  props: {
    frame: 'A SINGLE OBJECT ALONE, upright, centred, filling about 65 percent of the frame.',
    list: {
      coffee: 'a coffee mug with steam', laptop: 'an open laptop seen from the front three-quarter view',
      guitar: 'an acoustic guitar standing upright', wand: 'a magic wand with a star tip and sparkles',
      sword: 'a short knight sword pointing up', balloon: 'a red balloon on a string',
      umbrella: 'an open blue umbrella with a curved handle', trophy: 'a golden trophy cup with two handles',
      rubberduck: 'a yellow rubber duck', lantern: 'a glowing oil lantern with a handle',
      fishingrod: 'a fishing rod standing upright with a line and a red-and-white bobber', flag: 'a small triangular pennant flag on a pole',
      pizza: 'a slice of pepperoni pizza, point down', bouquet: 'a bouquet of colourful flowers wrapped in paper',
      snowglobe: 'a snow globe with a tiny pine tree inside and a wooden base', keyboard: 'a small mechanical computer keyboard tilted toward the viewer, blank keys',
    },
  },
  crates: {
    frame: 'A chunky pixel TREASURE CRATE (a sturdy loot box with metal corner brackets and a lock), front three-quarter view, closed, centred, filling about 75 percent of the frame, with a large emblem on its front.',
    list: {
      season1: 'teal-painted crate with gold trim and a white feather emblem', season2: 'orange-painted crate with dark trim and a cream egg emblem',
      spooky: 'purple crate with orange trim and a glowing jack-o-lantern pumpkin emblem', frosty: 'icy pale-blue crate with frost on the edges and a white snowflake emblem',
      bloom: 'pink crate with green vine trim and a flower emblem', free: 'plain natural wooden crate tied with a red ribbon bow',
      'open-burst': 'NOT a crate: a radial burst of golden-white light rays spreading out from the centre with a few sparkle pixels, like a treasure-opening flash, rays fading to transparent at the ends',
    },
  },
  currency: {
    frame: 'A SINGLE small game currency ICON, centred, filling about 80 percent of the frame, very bold and simple so it reads at 32 pixels.',
    list: { coin: 'a round gold coin, front view, with a feather stamped in the middle', key: 'a golden old-fashioned key, diagonal' },
  },
};

async function draw(cwd, file, prompt, label, image) {
  mkdirSync(cwd, { recursive: true });
  if (existsSync(join(cwd, file))) { console.log(`${label}: already done`); return; }
  // `-i <FILE>...` is greedy: anything after it that is not a flag is read as
  // another image, so the reference goes FIRST and a flag closes the list,
  // and the prompt stays the last positional. (First run: "No prompt
  // provided via stdin" for every pose.)
  const args = ['exec', ...(image ? ['-i', image] : []), '-s', 'workspace-write', '--skip-git-repo-check', '-C', cwd, prompt];
  const t0 = Date.now();
  try { await run(args, cwd, label); } catch (e) { console.log(`${label}: FAILED ${e.message}`); return; }
  const ok = existsSync(join(cwd, file));
  console.log(`${label}: ${ok ? `ok (${statSync(join(cwd, file)).size} bytes, ${Math.round((Date.now() - t0) / 1000)}s)` : 'NONE WRITTEN'}`);
}

const [mode, ...names] = process.argv.slice(2);
if (mode === 'poses') {
  for (const name of names) {
    const r = ROSTER[name];
    if (!r) { console.log(`${name}: not in roster.json`); continue; }
    const ref = join(SPRITE_RAW, `${name}-idle.png`);
    const cwd = join(RAW, 'poses', name);
    for (const [pose, how] of SCENE_POSES) {
      const file = `${name}-${pose}.png`;
      const prompt = `Use your built-in image_gen tool to generate ONE 1024x1024 image.\n\n${STYLE}\n\nThe attached image is this exact character's idle frame. Draw the SAME character -- identical colours, outline weight, eye style, proportions and features -- in a new pose.\n\n${r.desc}, ${how}. Body: ${r.body}. -> save as ${file}\n\nThis is one frame of a sprite set; every frame must share EXACTLY the same colours and features as the attached frame and differ ONLY in the pose. Use the image_gen tool directly; do not write code.`;
      await draw(cwd, file, prompt, `${name}/${pose}`, existsSync(ref) ? ref : undefined);
    }
  }
} else if (mode === 'work') {
  for (const name of names) {
    const r = ROSTER[name];
    if (!r) { console.log(`${name}: not in roster.json`); continue; }
    const ref = join(SPRITE_RAW, `${name}-idle.png`);
    const cwd = join(RAW, 'poses', name);
    for (const [pose, how] of WORK_POSES) {
      const file = `${name}-${pose}.png`;
      const prompt = `Use your built-in image_gen tool to generate ONE 1024x1024 image.\n\n${STYLE}\n\nThe attached image is this exact character's idle frame. Draw the SAME character -- identical colours, outline weight, eye style, proportions and features -- in a new pose, standing in the same place and at the same size as in the attached frame so the frames line up when played in sequence.\n\n${r.desc}, ${how}. Body: ${r.body}. -> save as ${file}\n\nThis is one frame of a sprite set; every frame must share EXACTLY the same colours and features as the attached frame and differ ONLY in the pose. Use the image_gen tool directly; do not write code.`;
      await draw(cwd, file, prompt, `${name}/${pose}`, existsSync(ref) ? ref : undefined);
    }
  }
} else if (mode === 'phase') {
  for (const name of names) {
    const r = ROSTER[name];
    if (!r) { console.log(`${name}: not in roster.json`); continue; }
    const ref = join(SPRITE_RAW, `${name}-idle.png`);
    const cwd = join(RAW, 'poses', name);
    for (const [pose, how] of PHASE_POSES) {
      const file = `${name}-${pose}.png`;
      const prompt = `Use your built-in image_gen tool to generate ONE 1024x1024 image.\n\n${STYLE}\n\nThe attached image is this exact character's idle frame. Draw the SAME character -- identical colours, outline weight, eye style, proportions and features -- in a new pose, standing in the same place and at the same size as in the attached frame so the frames line up when played in sequence. Any prop is small and held close, inside the frame.\n\n${r.desc}, ${how}. Body: ${r.body}. -> save as ${file}\n\nThis is one frame of a sprite set; every frame must share EXACTLY the same colours and features as the attached frame and differ ONLY in the pose and the prop. Use the image_gen tool directly; do not write code.`;
      await draw(cwd, file, prompt, `${name}/${pose}`, existsSync(ref) ? ref : undefined);
    }
  }
} else if (mode === 'scene') {
  for (const id of names) {
    const desc = SCENES[id];
    if (!desc) { console.log(`${id}: unknown scene`); continue; }
    const file = `${id}.png`;
    const prompt = `Use your built-in image_gen tool to generate ONE 1536x1024 landscape image.\n\n${BACKDROP_STYLE}\n\nScene: ${desc}. -> save as ${file}\n\nUse the image_gen tool directly; do not write code.`;
    await draw(join(RAW, 'scenes'), file, prompt, `scene/${id}`);
  }
} else if (mode === 'relight') {
  // AM/PM twins (2026-09-28): the same backdrop at the other half of the day.
  // Every original was painted on the navy night base, so all 40 are "pm" and
  // the twin is a morning. The original is attached as the reference and the
  // composition is locked: crew seats sit at fixed x/y on it.
  //   node scripts/scenes/gen.mjs relight all | relight picnic campfire
  const ids = names[0] === 'all' ? Object.keys(SCENES) : names;
  for (const id of ids) {
    const desc = SCENES[id];
    const ref = join(RAW, 'scenes', `${id}.png`);
    if (!desc || !existsSync(ref)) { console.log(`${id}: unknown scene or no original`); continue; }
    const file = `${id}.png`;
    const prompt = `Use your built-in image_gen tool to EDIT the attached image into ONE 1536x1024 landscape image.\n\nThe attached image is a retro pixel-art game backdrop at NIGHT/EVENING: ${desc}.\n\nRedraw the EXACT SAME picture as a bright, sunny MORNING in daylight. CRITICAL -- THE COMPOSITION IS LOCKED: identical camera, framing and aspect; the horizon line, ground line, floor, walls, windows and every object stay at EXACTLY the same position, size and shape, pixel for pixel; add NO new objects and remove NONE (characters will be placed at fixed coordinates on this image). Change ONLY the lighting and time of day: outdoor skies become a soft light-blue morning sky with a few small white pixel clouds and (if the sky is visible) a sun instead of the moon and stars; windows show daylight instead of night; lamps, lanterns, string lights, torches and neon are switched off or faint; fires may become a thin wisp of smoke or low embers in the SAME spot; shadows are short daytime shadows; colours are brighter and warmer. Indoor scenes with no window stay the same room with brighter, cheerful daytime lighting.\n\nCRITICAL: literal retro PIXEL ART matching the attached image -- LOW RESOLUTION with large VISIBLE SQUARE PIXEL BLOCKS, hard aliased edges, flat blocks of colour, crisp one-pixel dark outlines, no gradients, no anti-aliasing, no airbrush shading. NO characters, NO people, NO animals, NO text.\nCRITICAL: save the image into the CURRENT WORKING DIRECTORY under the exact filename ${file}.\n\nUse the image_gen tool directly with the attached image as the reference; do not write code.`;
    await draw(join(RAW, 'scenes-alt'), file, prompt, `relight/${id}`, ref);
  }
} else if (mode === 'outfits') {
  // Level-up outfits: the IDLE pose, four cumulative tiers of accessories.
  //   node scripts/scenes/gen.mjs outfits ollie pip   (or: outfits ollie:4 pip:1,2)
  for (const arg of names) {
    const [name, only] = arg.split(':');
    const r = ROSTER[name];
    if (!r) { console.log(`${name}: not in roster.json`); continue; }
    const ref = join(SPRITE_RAW, `${name}-idle.png`);
    const cwd = join(SPRITE_RAW, 'outfits', name);
    const tiers = only ? only.split(',').map(Number) : [1, 2, 3, 4];
    for (const tier of tiers) {
      const file = `${name}-tier${tier}.png`;
      const kit = outfitKit(name, tier);
      const prompt = `Use your built-in image_gen tool to generate ONE 1024x1024 image.\n\n${STYLE}\n\nThe attached image is this exact character's idle frame. Draw the SAME character in the SAME idle pose -- identical body shape, colours, outline weight, eye style, proportions, features, position and size in the frame -- and ADD ONLY these accessories, drawn in the same chunky pixel-art style with the same dark one-pixel outline: ${kit}. The accessories are the ONLY difference from the attached frame; the body colour stays exactly as attached.\n\n${r.desc}. Body: ${r.body}. -> save as ${file}\n\nThis is one frame of a sprite set; it must share EXACTLY the same colours and features as the attached frame. Use the image_gen tool directly with the attached image as the reference; do not write code.`;
      await draw(cwd, file, prompt, `${name}/tier${tier}`, existsSync(ref) ? ref : undefined);
    }
  }
} else if (mode === 'props') {
  for (const id of names) {
    const desc = PROPS[id];
    if (!desc) { console.log(`${id}: unknown prop`); continue; }
    const file = `${id}.png`;
    const prompt = `Use your built-in image_gen tool to generate ONE 1024x1024 image.\n\nCRITICAL: genuinely TRANSPARENT background (alpha channel). CRITICAL: save the image into the CURRENT WORKING DIRECTORY under the exact filename given.\nCRITICAL: literal retro PIXEL ART -- a 16-bit game item sprite -- LOW RESOLUTION with large VISIBLE SQUARE PIXEL BLOCKS, hard aliased edges, flat blocks of colour, a crisp dark one-pixel outline, no gradients, no anti-aliasing, no drop shadow, no text. A SINGLE OBJECT, no character, no hands, centered, filling about 60 percent of the frame.\n\nObject: ${desc}. -> save as ${file}\n\nUse the image_gen tool directly; do not write code.`;
    await draw(join(RAW, 'props'), file, prompt, `prop/${id}`);
  }
} else if (mode === 'items') {
  // Shop/arcade items (2026-09-28): `items <cat> [id...]`, cat = logos|hats|props|crates|currency.
  const [cat, ...ids] = names;
  const set = ITEMS[cat];
  if (!set) { console.error(`unknown category ${cat}`); process.exit(2); }
  for (const id of (ids.length ? ids : Object.keys(set.list))) {
    const desc = set.list[id];
    if (!desc) { console.log(`${cat}/${id}: unknown`); continue; }
    const file = `${id}.png`;
    const prompt = `Use your built-in image_gen tool to generate ONE 1024x1024 image.\n\nCRITICAL: genuinely TRANSPARENT background (alpha channel, nothing behind the object). CRITICAL: save the image into the CURRENT WORKING DIRECTORY under the exact filename given.\nCRITICAL: literal retro PIXEL ART -- a 16-bit console game item sprite -- LOW RESOLUTION with large VISIBLE SQUARE PIXEL BLOCKS, hard aliased edges, flat blocks of colour, a crisp dark one-pixel outline, no gradients, no anti-aliasing, no drop shadow. ABSOLUTELY NO TEXT, NO LETTERS, NO NUMBERS, NO WORDS anywhere. No characters, no creatures, no hands unless described.\n\n${set.frame}\n\nSubject: ${desc}. -> save as ${file}\n\nUse the image_gen tool directly; do not write code.`;
    await draw(join(RAW, 'items', cat), file, prompt, `${cat}/${id}`);
  }
} else {
  console.error('usage: gen.mjs poses <name...> | scene <id...> | props <id...> | relight <id...|all>');
  process.exit(2);
}
console.log('DONE');
