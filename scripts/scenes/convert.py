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


if __name__ == '__main__':
    mode, *rest = sys.argv[1:]
    {'poses': poses, 'scene': scene, 'props': props, 'sheet': sheet}[mode](rest)
