# -*- coding: utf-8 -*-
"""PNG-секвенция из Cycles → webp в public/film.

Бюджет из плейбука: кадр ≤ 50 КБ, вся плёнка ≤ 5 МБ. Тёмная сцена жмётся
отлично, поэтому качество можно держать высоким.

  python render/pack_frames.py D:/tmp/cafe-seq 1100
"""
import os, sys, glob
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "D:/tmp/cafe-seq"
WIDTH = int(sys.argv[2]) if len(sys.argv) > 2 else 1100
DST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "film")

os.makedirs(DST, exist_ok=True)
files = sorted(glob.glob(os.path.join(SRC, "frame-*.png")))
if not files:
    print("нет кадров в", SRC)
    raise SystemExit(1)

total = 0
for i, f in enumerate(files):
    im = Image.open(f).convert("RGB")
    if im.width != WIDTH:
        im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
    out = os.path.join(DST, f"frame-{i:03d}.webp")
    im.save(out, "WEBP", quality=82, method=6)
    total += os.path.getsize(out)

print(f"{len(files)} кадров, {total // 1024} КБ всего, {total // 1024 // len(files)} КБ на кадр")
print("→", os.path.normpath(DST))
