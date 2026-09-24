/** The wordmark, locked 2026-09-24: ROOST drawn as one pixel sprite, the OO
 *  an owl's eyes under two ear tufts. Hand-drawn rather than typed, because
 *  the display font's O has a 2x3 hole at header size -- no room for an eye.
 *
 *  One drawing, two themes (colours in styles.css, .wordmark-*):
 *    dark  -- moonlight letters, WHITE eyes, dark pupils, indigo shadow;
 *    light -- indigo letters, MOONLIGHT-CREAM eyes, dark pupils, cream shadow.
 *  '#' letter/tuft, 's' eye-white, 'd' pupil, 'w' glint. */
const ROWS = [
  '.......#..................#...............',
  '.......##................##...............',
  '........##..............##................',
  '........###............###................',
  '.........####........####.................',
  '#####....######....######....####...######',
  '##..##..##ssss##..##ssss##..##..##....##..',
  '##..##..##sdds##..##sdds##..##........##..',
  '##..##..##dddd##..##dddd##..##........##..',
  '#####...##dwdd##..##ddwd##...####.....##..',
  '####....##dddd##..##dddd##......##....##..',
  '##.##...##sdds##..##sdds##......##....##..',
  '##..##..##ssss##..##ssss##..##..##....##..',
  '##..##...######....######....####.....##..',
];
const CLASS: Record<string, string> = { '#': 'wm-ink', s: 'wm-white', d: 'wm-pupil', w: 'wm-glint' };
const W = ROWS[0].length;
const H = ROWS.length;
const cells = ROWS.flatMap((r, y) => [...r].map((c, x) => ({ x, y, c })).filter((p) => p.c !== '.'));
// The hard shadow falls from the letters and tufts only, not from inside the eyes.
const shadow = cells.filter((p) => p.c === '#');

export function Wordmark({ height = 44 }: { height?: number }) {
  return (
    <svg
      className="wordmark-svg"
      viewBox={`0 0 ${W + 1} ${H + 1}`}
      height={height}
      width={(height * (W + 1)) / (H + 1)}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Roost"
    >
      {shadow.map((p) => (
        <rect key={`s${p.x}.${p.y}`} className="wm-shadow" x={p.x + 0.6} y={p.y + 0.6} width={1} height={1} />
      ))}
      {cells.map((p) => (
        <rect key={`${p.x}.${p.y}`} className={CLASS[p.c]} x={p.x} y={p.y} width={1} height={1} />
      ))}
    </svg>
  );
}
