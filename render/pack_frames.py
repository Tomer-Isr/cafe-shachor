# -*- coding: utf-8 -*-
"""PNG-секвенция из Cycles → webp в public/film.

Бюджет из плейбука: кадр ≤ 50 КБ, вся плёнка ≤ 5 МБ. Тёмная сцена жмётся
отлично, поэтому качество можно держать высоким.

  python render/pack_frames.py D:/tmp/cafe-seq 1100
"""
import os, sys, glob
from PIL import Image, ImageChops, ImageFilter
import random

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

    # Плёночное свечение: размытая копия ярких мест, наложенная поверх.
    # Блик на кромке и струя начинают «дышать», как на настоящей оптике.
    glow = im.point(lambda v: max(0, v - 168) * 3)
    glow = glow.filter(ImageFilter.GaussianBlur(14))
    im = ImageChops.screen(im, glow.point(lambda v: int(v * 0.42)))

    # Зерно: ровная цифровая гладь читается как рендер. Шум привязан к номеру
    # кадра, поэтому не «кипит» между соседними кадрами сильнее, чем нужно.
    rnd = random.Random(1000 + i)
    noise = Image.new("L", (im.width // 3, im.height // 3))
    noise.putdata([rnd.randint(116, 140) for _ in range(noise.width * noise.height)])
    noise = noise.resize(im.size, Image.BILINEAR)
    im = ImageChops.overlay(im, Image.merge("RGB", (noise, noise, noise)))
    if im.width != WIDTH:
        im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
    out = os.path.join(DST, f"frame-{i:03d}.webp")
    im.save(out, "WEBP", quality=82, method=6)
    total += os.path.getsize(out)

print(f"{len(files)} кадров, {total // 1024} КБ всего, {total // 1024 // len(files)} КБ на кадр")
print("saved to", os.path.normpath(DST))
