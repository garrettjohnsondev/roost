// Draw scene assets with the same pipeline that drew the crew: `codex exec`
// with image_gen, 1024px transparent frames, the crew's STYLE block verbatim.
//
//   node scripts/scenes/gen.mjs poses pip ollie moss      # 4 scene poses each
//   node scripts/scenes/gen.mjs scene campfire            # one backdrop
//   node scripts/scenes/gen.mjs props guitar flute laptop # hand props
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
} else if (mode === 'scene') {
  for (const id of names) {
    const desc = SCENES[id];
    if (!desc) { console.log(`${id}: unknown scene`); continue; }
    const file = `${id}.png`;
    const prompt = `Use your built-in image_gen tool to generate ONE 1536x1024 landscape image.\n\n${BACKDROP_STYLE}\n\nScene: ${desc}. -> save as ${file}\n\nUse the image_gen tool directly; do not write code.`;
    await draw(join(RAW, 'scenes'), file, prompt, `scene/${id}`);
  }
} else if (mode === 'props') {
  for (const id of names) {
    const desc = PROPS[id];
    if (!desc) { console.log(`${id}: unknown prop`); continue; }
    const file = `${id}.png`;
    const prompt = `Use your built-in image_gen tool to generate ONE 1024x1024 image.\n\nCRITICAL: genuinely TRANSPARENT background (alpha channel). CRITICAL: save the image into the CURRENT WORKING DIRECTORY under the exact filename given.\nCRITICAL: literal retro PIXEL ART -- a 16-bit game item sprite -- LOW RESOLUTION with large VISIBLE SQUARE PIXEL BLOCKS, hard aliased edges, flat blocks of colour, a crisp dark one-pixel outline, no gradients, no anti-aliasing, no drop shadow, no text. A SINGLE OBJECT, no character, no hands, centered, filling about 60 percent of the frame.\n\nObject: ${desc}. -> save as ${file}\n\nUse the image_gen tool directly; do not write code.`;
    await draw(join(RAW, 'props'), file, prompt, `prop/${id}`);
  }
} else {
  console.error('usage: gen.mjs poses <name...> | scene <id...> | props <id...>');
  process.exit(2);
}
console.log('DONE');
