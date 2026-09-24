/** Roost's own icons: 12×12 pixel glyphs, drawn here, in the crew's house
 *  style. No emoji anywhere in the app (2026-09-24): an emoji is drawn by the
 *  phone's vendor, in the phone's style, at the phone's whim -- the gear and
 *  the scales come out as glossy colour pictures on iOS -- and it sits beside sprites that
 *  were drawn by hand. These are ours, they take the text colour, and they
 *  render crisp at any size that is a multiple of 12.
 *
 *  A glyph is twelve rows of twelve characters; `#` is a lit pixel. Add one by
 *  drawing it, not by importing it. */
const GLYPHS = {
  bolt: [
    '.....###....',
    '....###.....',
    '...###......',
    '..######....',
    '...#####....',
    '....###.....',
    '....##......',
    '...##.......',
    '..##........',
    '.##.........',
    '.#..........',
    '............',
  ],
  gear: [
    '.....##.....',
    '..#..##..#..',
    '.##########.',
    '..########..',
    '..##....##..',
    '####....####',
    '####....####',
    '..##....##..',
    '..########..',
    '.##########.',
    '..#..##..#..',
    '.....##.....',
  ],
  scales: [
    '.....##.....',
    '.##########.',
    '.#...##...#.',
    '#....##....#',
    '#....##....#',
    '###..##..###',
    '.#...##...#.',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '...######...',
    '...######...',
  ],
  lock: [
    '....####....',
    '...##..##...',
    '...#....#...',
    '...#....#...',
    '.##########.',
    '.##########.',
    '.####..####.',
    '.####..####.',
    '.#####.####.',
    '.##########.',
    '.##########.',
    '............',
  ],
  camera: [
    '............',
    '....####....',
    '############',
    '#..........#',
    '#...####...#',
    '#..##..##..#',
    '#..#....#..#',
    '#..##..##..#',
    '#...####...#',
    '#..........#',
    '############',
    '............',
  ],
  sparkle: [
    '.....#......',
    '.....#......',
    '....###.....',
    '.#..###..#..',
    '.#######.#..',
    '###########.',
    '.#######.#..',
    '.#..###..#..',
    '....###.....',
    '.....#......',
    '.....#......',
    '............',
  ],
  eye: [
    '............',
    '............',
    '...######...',
    '.##......##.',
    '#....##....#',
    '#...####...#',
    '#...####...#',
    '#....##....#',
    '.##......##.',
    '...######...',
    '............',
    '............',
  ],
  coffee: [
    '...#..#.....',
    '..#..#......',
    '...#..#.....',
    '............',
    '.########...',
    '.########.#.',
    '.########.#.',
    '.########.#.',
    '..######.#..',
    '...####.....',
    '.########...',
    '............',
  ],
  note: [
    '.......###..',
    '......####..',
    '......#.....',
    '......#.....',
    '......#.....',
    '......#.....',
    '......#.....',
    '....###.....',
    '...####.....',
    '...####.....',
    '....##......',
    '............',
  ],
  wrench: [
    '.......####.',
    '......##..##',
    '......##...#',
    '......###...',
    '.....#####..',
    '....###.....',
    '...###......',
    '..###.......',
    '.###........',
    '###.........',
    '##..........',
    '............',
  ],
  puzzle: [
    '............',
    '....##......',
    '...####.....',
    '.########...',
    '.########...',
    '##########..',
    '##########..',
    '.########...',
    '.########...',
    '...####.....',
    '....##......',
    '............',
  ],
} as const;

export type IconName = keyof typeof GLYPHS;
export const ICON_NAMES = Object.keys(GLYPHS) as IconName[];

const paths = new Map<IconName, string>();
function pathFor(name: IconName): string {
  let d = paths.get(name);
  if (d) return d;
  d = '';
  GLYPHS[name].forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') d += `M${x} ${y}h1v1h-1z`;
  });
  paths.set(name, d);
  return d;
}

export function Icon({ name, size = 12, className, title }: { name: IconName; size?: number; className?: string; title?: string }) {
  return (
    <svg
      className={`icon icon-${name}${className ? ` ${className}` : ''}`}
      viewBox="0 0 12 12"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={pathFor(name)} />
    </svg>
  );
}
