# -*- coding: utf-8 -*-
"""PNG-секвенция из Cycles → плёнки в public/.

  python render/pack_frames.py D:/tmp/cafe-hi144 --aux D:/tmp/cafe-hi144-aux

Кладёт три вещи:

  public/film/     кадр 1100 px — телефон и планшет
  public/film-hd/  кадр 1600 px — десктоп
  public/film-aux/ карта глубины и номеров предметов, 640 px

Зачем две плёнки. Кадр 1100 px на мониторе 1920 растягивается почти вдвое, и
сцена, чистая на телефоне, на компьютере выглядит замыленной — именно это
Томер и увидел. Отдавать всем крупный кадр нельзя: он втрое тяжелее, а на
телефоне разницы не видно.

Пост-обработки здесь нет намеренно. Раньше поверх кадра ложились зерно
(случайный шум в трети разрешения, растянутый обратно — пятна 3×3 пикселя)
и glow-пас, а webp жался в q82. На почти чёрном градиенте это давало ровно
ту грязь, которую Томер увидел как «шероховатое изображение». Чем сцена
темнее, тем меньше она прощает: картинку теперь везём из Cycles как есть.
"""
import os, sys, glob, re
from PIL import Image, ImageFilter

argv = sys.argv[1:]


def opt(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


SRC = argv[0] if argv and not argv[0].startswith("--") else "D:/tmp/cafe-hi144"
AUX_SRC = opt("--aux", "")
# По умолчанию пишем прямо в public. `--dst` нужен, чтобы прогнать упаковку на
# пробе, не затерев плёнку, которая сейчас на сайте.
ROOT = opt("--dst", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public"))

# Ширины плёнок и качество. Тёмный плавный градиент — худший случай для webp:
# на q82 он рассыпается ступеньками и блоками. Десктопной плёнке мало и q90:
# кадр весил 41 КБ, а зерно камня превращалось в разводы, которые на мониторе
# ещё и растягиваются.
#
# Три ширины под три класса экранов: телефон, ноутбук, широкий монитор. Крупной
# плёнке хватает q92 — на 2400 px артефакты сжатия и так меньше пикселя экрана,
# а лишнее качество здесь стоит мегабайтов дороже всего.
TARGETS = [("film", 1100, 92), ("film-hd", 1600, 95), ("film-xl", 2400, 92)]
AUX_WIDTH = 512
# Глубина округляется до 64 ступеней: без потерь такая карта весит 4 МБ на
# плёнку, с округлением — 2 МБ, а ступень в два сантиметра сцены сдвигает
# картинку меньше чем на четверть процента, то есть невидима.
AUX_LEVELS = 64


def pack_film():
    files = sorted(glob.glob(os.path.join(SRC, "frame-*.png")))
    if not files:
        print("нет кадров в", SRC)
        return
    for name, width, quality in TARGETS:
        dst = os.path.join(ROOT, name)
        os.makedirs(dst, exist_ok=True)
        total = 0
        for i, f in enumerate(files):
            im = Image.open(f).convert("RGB")
            if im.width != width:
                im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
            out = os.path.join(dst, f"frame-{i:03d}.webp")
            im.save(out, "WEBP", quality=quality, method=6)
            total += os.path.getsize(out)
        print(f"[{name}] {len(files)} кадров, {total // 1024} КБ всего, "
              f"{total // 1024 // len(files)} КБ на кадр, ширина {width}")


def pack_aux():
    """Глубина и номера предметов — данные, а не картинка.

    Отсюда два правила. Красный канал (глубина) сглаживается: туман в Cycles
    считается стохастически и остаётся чуть шершавым, а шершавая глубина —
    это дрожащий параллакс. Зелёный (номер предмета) уменьшается ближайшим
    соседом и жмётся без потерь: любое усреднение породило бы на границе
    чашки предмет с номером «два с половиной», которого в сцене нет.
    """
    files = sorted(glob.glob(os.path.join(AUX_SRC, "aux-*.png")),
                   key=lambda p: int(re.search(r"(\d+)", os.path.basename(p)).group(1)))
    if not files:
        print("нет карт глубины в", AUX_SRC)
        return
    dst = os.path.join(ROOT, "film-aux")
    os.makedirs(dst, exist_ok=True)
    total = 0
    for i, f in enumerate(files):
        im = Image.open(f).convert("RGB")
        r, g, _ = im.split()
        r = r.filter(ImageFilter.GaussianBlur(1.1))
        if im.width != AUX_WIDTH:
            size = (AUX_WIDTH, round(im.height * AUX_WIDTH / im.width))
            r = r.resize(size, Image.LANCZOS)
            g = g.resize(size, Image.NEAREST)
        step = 256 // AUX_LEVELS
        r = r.point(lambda v: min(255, round(v / step) * step))
        out = os.path.join(dst, f"aux-{i:03d}.webp")
        Image.merge("RGB", (r, g, Image.new("L", r.size, 0))).save(out, "WEBP", lossless=True, method=6)
        total += os.path.getsize(out)
    print(f"[film-aux] {len(files)} карт, {total // 1024} КБ всего, "
          f"{total // 1024 // len(files)} КБ на карту, ширина {AUX_WIDTH}")


pack_film()
if AUX_SRC:
    pack_aux()
print("saved to", os.path.normpath(ROOT))
