#!/usr/bin/env python3
"""Вырезает три руки из общей картинки-образца (assets/hands/source/reference.webp): убирает белый фон,
сглаживает края и сохраняет wave.png / like.png / peace.png + размеры и положение запястья (hands.json)."""
import json, os
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..', 'assets', 'hands')
im = Image.open(os.path.join(ROOT, 'source', 'reference.webp')).convert('RGBA')
a = np.asarray(im).astype(np.int16); rgb = a[..., :3]

# у образца уже прозрачный фон (альфа-канал) — просто берём его; если вдруг фон белый — убираем заливкой от краёв
if a[..., 3].min() < 255:
    fg = a[..., 3] > 16
    full = im
else:
    from PIL import ImageDraw
    wmask = Image.fromarray(((rgb.min(axis=2) > 238) * 255).astype(np.uint8), 'L')
    for pt in [(0, 0), (im.width - 1, 0), (0, im.height - 1), (im.width - 1, im.height - 1)]:
        if wmask.getpixel(pt) == 255: ImageDraw.floodfill(wmask, pt, 128, thresh=0)
    fg = np.asarray(wmask) != 128
    m = Image.fromarray((fg * 255).astype(np.uint8), 'L').filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.0))
    full = Image.fromarray(np.dstack([rgb.astype(np.uint8), np.asarray(m)]), 'RGBA')

# три руки = три группы столбцов с просветами между ними
cols = fg.any(axis=0); segs = []; start = None; gap = 0
for x, v in enumerate(cols):
    if v:
        if start is None: start = x
        gap = 0; end = x
    elif start is not None:
        gap += 1
        if gap > 25: segs.append((start, end + 1)); start = None
if start is not None: segs.append((start, end + 1))
boxes = []
for x0, x1 in segs:
    if x1 - x0 < 150: continue
    rows = np.where(fg[:, x0:x1].any(axis=1))[0]; boxes.append((x0, x1, int(rows[0]), int(rows[-1]) + 1))
assert len(boxes) == 3, boxes
names = ['wave', 'like', 'peace']
meta = {}
for name, (x0, x1, y0, y1) in zip(names, boxes):
    pad = 8
    box = (max(x0 - pad, 0), max(y0 - pad, 0), min(x1 + pad, im.width), min(y1 + pad, im.height))
    crop = full.crop(box)
    crop.save(os.path.join(ROOT, f'{name}.png'), optimize=True)
    meta[name] = {'w': crop.width, 'h': crop.height, 'box': box}
json.dump(meta, open(os.path.join(HERE, 'hands.json'), 'w'), indent=1)
print(json.dumps(meta))
