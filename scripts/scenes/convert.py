"""Check and convert scene assets drawn by gen.mjs.

  python3 scripts/scenes/convert.py poses pip ollie moss
  python3 scripts/scenes/convert.py scene campfire
  python3 scripts/scenes/convert.py props guitar flute laptop

Poses: the circular mean hue of each new frame is compared with the
character's shipped idle frame (the check that caught Juno's and Rue's drift
last time); a spread past 12 degrees is reported as DRIFT and the frame is
still converted, so the comparison sheet can show it. 1024 -> 256 by BOX
(an exact 4x reduction) to lossless webp in web/public/crew/, so the app's
SpriteAvatar serves the new poses from the same path as the old ones.
Backdrops: 1536x1024 -> centre-cropped to 2:1 -> 512x256. Props: 256px.
"""
import colorsys
import math
import sys
from pathlib import Path
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
RAW = REPO / '.roost-data' / 'scene-raw'
SPRITE_RAW = REPO / '.roost-data' / 'sprite-raw'
CREW = REPO / 'web' / 'public' / 'crew'
SCENES = REPO / 'web' / 'public' / 'scenes'
POSES = ['sit', 'side', 'hold', 'dance']


def mean_hue(im):
    im = im.convert('RGBA')
    w, h = im.size
    sx = sy = n = 0.0
    for y in range(0, h, 3):
        for x in range(0, w, 3):
            r, g, b, a = im.getpixel((x, y))
            if a < 128:
                continue
            mx, mn = max(r, g, b), min(r, g, b)
            sat = 0 if mx == 0 else (mx - mn) / mx
            if sat < 0.25 or mx < 40:
                continue
            hh, _, _ = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            sx += math.cos(hh * 2 * math.pi)
            sy += math.sin(hh * 2 * math.pi)
            n += 1
    if n == 0:
        return None
    return math.degrees(math.atan2(sy, sx)) % 360


def hue_gap(a, b):
    d = abs(a - b)
    return min(d, 360 - d)


def transparent(im):
    w, h = im.size
    return all(im.getpixel(p)[3] < 10 for p in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)])


def poses(names):
    CREW.mkdir(parents=True, exist_ok=True)
    for name in names:
        ref = SPRITE_RAW / f'{name}-idle.png'
        ref_hue = mean_hue(Image.open(ref)) if ref.exists() else None
        for pose in POSES:
            src = RAW / 'poses' / name / f'{name}-{pose}.png'
            if not src.exists():
                print(f'{name}/{pose}: missing')
                continue
            im = Image.open(src).convert('RGBA')
            hue = mean_hue(im)
            gap = hue_gap(hue, ref_hue) if hue is not None and ref_hue is not None else None
            flag = ' DRIFT' if gap is not None and gap > 12 else ''
            tr = transparent(im)
            out = CREW / f'{name}-{pose}.webp'
            im.resize((256, 256), Image.Resampling.BOX).save(out, 'WEBP', lossless=True)
            print(f'{name}/{pose}: size={im.size} transparent={tr} hue_gap_vs_idle={None if gap is None else round(gap, 1)}{flag} -> {out.name} ({out.stat().st_size}b)')


def scene(ids):
    SCENES.mkdir(parents=True, exist_ok=True)
    for sid in ids:
        src = RAW / 'scenes' / f'{sid}.png'
        if not src.exists():
            print(f'scene/{sid}: missing')
            continue
        im = Image.open(src).convert('RGB')
        w, h = im.size
        # centre crop to 2:1
        th = w // 2
        top = max(0, (h - th) // 2)
        im = im.crop((0, top, w, top + th))
        out = SCENES / f'{sid}.webp'
        im.resize((512, 256), Image.Resampling.BOX).save(out, 'WEBP', lossless=True)
        print(f'scene/{sid}: {w}x{h} -> 512x256 {out.name} ({out.stat().st_size}b)')


def props(ids):
    d = SCENES / 'props'
    d.mkdir(parents=True, exist_ok=True)
    for pid in ids:
        src = RAW / 'props' / f'{pid}.png'
        if not src.exists():
            print(f'prop/{pid}: missing')
            continue
        im = Image.open(src).convert('RGBA')
        out = d / f'{pid}.webp'
        im.resize((256, 256), Image.Resampling.BOX).save(out, 'WEBP', lossless=True)
        print(f'prop/{pid}: transparent={transparent(im)} -> {out.name} ({out.stat().st_size}b)')


def sheet(names):
    """idle + the four scene poses per character, one row each, on the app's
    background -- the crew-comparison sheet that caught Bram's and Rue's
    style drift last time. Written to /tmp/roost-shots/scene-sheet.png."""
    cols = ['idle'] + POSES
    rows = []
    for name in names:
        row = []
        for pose in cols:
            f = CREW / f'{name}-{pose}.webp'
            row.append(Image.open(f).convert('RGBA') if f.exists() else Image.new('RGBA', (256, 256), (0, 0, 0, 0)))
        rows.append(row)
    out = Image.new('RGBA', (256 * len(cols), 256 * len(rows)), (13, 20, 36, 255))
    for r, row in enumerate(rows):
        for c, im in enumerate(row):
            out.paste(im, (256 * c, 256 * r), im)
    dest = Path('/tmp/roost-shots/scene-sheet.png')
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest)
    print(f'sheet: {dest} ({len(rows)} rows x {len(cols)})')


WORK = {'type': ['type2', 'type3', 'type4'], 'think': ['think2', 'think3', 'think4']}


def _bbox(im):
    return im.getchannel('A').point(lambda a: 255 if a > 40 else 0).getbbox()


def work(names):
    """Item 38: the three new drawings for typing and for thinking. The frames
    are cut in place, one after another, so each is ALIGNED to the pose's
    existing frame: same foot line, same centre, and rescaled (nearest, to keep
    hard pixels) only when its height is off by more than 6% -- otherwise a
    frame drawn a little bigger makes the character jitter as it plays."""
    for name in names:
        ref_hue = None
        idle = SPRITE_RAW / f'{name}-idle.png'
        if idle.exists():
            ref_hue = mean_hue(Image.open(idle))
        for base, frames in WORK.items():
            ref_path = CREW / f'{name}-{base}.webp'
            if not ref_path.exists():
                print(f'{name}/{base}: no reference frame')
                continue
            ref = Image.open(ref_path).convert('RGBA')
            rb = _bbox(ref)
            for pose in frames:
                src = RAW / 'poses' / name / f'{name}-{pose}.png'
                if not src.exists():
                    print(f'{name}/{pose}: missing')
                    continue
                big = Image.open(src).convert('RGBA')
                hue = mean_hue(big)
                gap = hue_gap(hue, ref_hue) if hue is not None and ref_hue is not None else None
                im = big.resize((256, 256), Image.Resampling.BOX)
                nb = _bbox(im)
                if not nb or not rb:
                    print(f'{name}/{pose}: empty frame, skipped')
                    continue
                part = im.crop(nb)
                rh, nh = rb[3] - rb[1], nb[3] - nb[1]
                scaled = abs(nh - rh) / rh > 0.06
                if scaled:
                    k = rh / nh
                    part = part.resize((max(1, round(part.width * k)), max(1, round(part.height * k))), Image.Resampling.NEAREST)
                out_im = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
                cx = (rb[0] + rb[2]) // 2
                x = cx - part.width // 2
                y = rb[3] - part.height
                out_im.paste(part, (x, y), part)
                out = CREW / f'{name}-{pose}.webp'
                out_im.save(out, 'WEBP', lossless=True)
                flag = ' DRIFT' if gap is not None and gap > 12 else ''
                print(f'{name}/{pose}: aligned to {base} (h {nh}->{part.height}{" scaled" if scaled else ""}) hue_gap={None if gap is None else round(gap, 1)}{flag} transparent={transparent(big)}')


def _rows(im):
    a = im.getchannel('A').load()
    w, h = im.size
    for y in range(h):
        xs = [x for x in range(w) if a[x, y] > 40]
        if xs:
            yield y, xs[0], xs[-1]


def _girth(im):
    """Median row width across the lower third of the figure (the body),
    robust to a block or spark at the feet."""
    rows = list(_rows(im))
    if not rows:
        return None
    top, bot = rows[0][0], rows[-1][0]
    lo = [r - l for y, l, r in rows if y >= top + (bot - top) * 0.62 and y <= bot - (bot - top) * 0.08]
    lo.sort()
    return lo[len(lo) // 2] if lo else None


def _body_cx(im):
    """Horizontal centre of the lower body, same band as _girth."""
    rows = list(_rows(im))
    top, bot = rows[0][0], rows[-1][0]
    band = [(l + r) / 2 for y, l, r in rows if y >= top + (bot - top) * 0.62 and y <= bot - (bot - top) * 0.08]
    band.sort()
    return round(band[len(band) // 2]) if band else (rows[0][1] + rows[0][2]) // 2


PHASES = ['look1', 'look2', 'plan1', 'plan2', 'review1', 'review2', 'build1', 'build2', 'test1', 'test2']


def phase(names):
    """The phase bar's poses (2026-09-25): two drawings per phase. 1024 ->
    256 by BOX, then set on the idle frame's foot line so the pair (and the
    walk between stops) never hops. Not rescaled: a raised hammer or a
    held-out lens makes the drawing taller or wider on purpose."""
    for name in names:
        idle = CREW / f'{name}-idle.webp'
        ref = Image.open(idle).convert('RGBA') if idle.exists() else None
        rb = _bbox(ref) if ref else None
        ref_hue = mean_hue(Image.open(SPRITE_RAW / f'{name}-idle.png')) if (SPRITE_RAW / f'{name}-idle.png').exists() else None
        for pose in PHASES:
            src = RAW / 'poses' / name / f'{name}-{pose}.png'
            if not src.exists():
                print(f'{name}/{pose}: missing')
                continue
            big = Image.open(src).convert('RGBA')
            hue = mean_hue(big)
            gap = hue_gap(hue, ref_hue) if hue is not None and ref_hue is not None else None
            im = big.resize((256, 256), Image.Resampling.BOX)
            nb = _bbox(im)
            if not nb:
                print(f'{name}/{pose}: empty frame, skipped')
                continue
            if rb:
                part = im.crop(nb)
                # The raised hammer is the one drawing made smaller to fit the
                # hammer overhead, so the pair pulsed in size. It is grown back
                # to the idle frame's width (the hammer is above the head, not
                # beside it), never shrunk, and the hammer may run off the top.
                if pose == 'build1' and part.width < (rb[2] - rb[0]) * 0.94:
                    k = min(1.12, (rb[2] - rb[0]) / part.width)
                    part = part.resize((round(part.width * k), round(part.height * k)), Image.Resampling.NEAREST)
                    if part.height > rb[3]:
                        part = part.crop((0, part.height - rb[3], part.width, part.height))
                out_im = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
                x = (rb[0] + rb[2]) // 2 - part.width // 2 if pose == 'build1' else nb[0]
                out_im.paste(part, (x, rb[3] - part.height), part)
                im = out_im
            im.save(CREW / f'{name}-{pose}.webp', 'WEBP', lossless=True)
            flag = ' DRIFT' if gap is not None and gap > 12 else ''
            print(f'{name}/{pose}: ok hue_gap={None if gap is None else round(gap, 1)}{flag} transparent={transparent(big)}')


def phasesheet(names):
    """Each character's phase pairs, for the eye."""
    cols = ['idle'] + PHASES
    out = Image.new('RGBA', (96 * len(cols), 96 * len(names)), (13, 20, 36, 255))
    for r, name in enumerate(names):
        for c, pose in enumerate(cols):
            f = CREW / f'{name}-{pose}.webp'
            if f.exists():
                im = Image.open(f).convert('RGBA').resize((96, 96), Image.Resampling.NEAREST)
                out.paste(im, (96 * c, 96 * r), im)
    dest = Path('/tmp/roost-shots/phase-sheet.png')
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest)
    print(f'phasesheet: {dest}')


def worksheet(names):
    """Each character's eight working frames in play order, for the eye."""
    cols = ['type', 'type2', 'type3', 'type4', 'think', 'think2', 'think3', 'think4']
    out = Image.new('RGBA', (128 * len(cols), 128 * len(names)), (13, 20, 36, 255))
    for r, name in enumerate(names):
        for c, pose in enumerate(cols):
            f = CREW / f'{name}-{pose}.webp'
            if f.exists():
                im = Image.open(f).convert('RGBA').resize((128, 128), Image.Resampling.NEAREST)
                out.paste(im, (128 * c, 128 * r), im)
    dest = Path('/tmp/roost-shots/work-sheet.png')
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest)
    print(f'worksheet: {dest}')


if __name__ == '__main__':
    mode, *rest = sys.argv[1:]
    {'poses': poses, 'scene': scene, 'props': props, 'sheet': sheet, 'work': work, 'worksheet': worksheet, 'phase': phase, 'phasesheet': phasesheet}[mode](rest)
