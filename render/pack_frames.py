# -*- coding: utf-8 -*-
"""PNG-секвенция из Cycles → webp в public/film.

Бюджет из плейбука: кадр ≤ 50 КБ, вся плёнка ≤ 5 МБ. Тёмная сцена жмётся
отлично, поэтому качество можно держать высоким.

  python render/pack_frames.py D:/tmp/cafe-seq 1100

Пост-обработки здесь нет намеренно. Раньше поверх кадра ложились зерно
(случайный шум в трети разрешения, растянутый обратно — пятна 3×3 пикселя)
и glow-пас, а webp жался в q82. На почти чёрном градиенте это давало ровно
ту грязь, которую Томер увидел как «шероховатое изображение». Чем сцена
темнее, тем меньше она прощает: картинку теперь везём из Cycles как есть.
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
    # q92: тёмный плавный градиент — худший случай для webp, на q82 он
    # рассыпается ступеньками и блоками. Кадр всё равно остаётся лёгким.
    im.save(out, "WEBP", quality=92, method=6)
    total += os.path.getsize(out)

print(f"{len(files)} кадров, {total // 1024} КБ всего, {total // 1024 // len(files)} КБ на кадр")
print("saved to", os.path.normpath(DST))
