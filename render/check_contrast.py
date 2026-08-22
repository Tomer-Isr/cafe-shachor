"""
Замер яркости кадра под текстом — по числам, а не глазами.

Текст лежит на движущейся плёнке, и на светлом участке проваливается. Здесь
для каждого текстового кармана (DESIGN-SYSTEM §6.3) считается яркость фона и
сверяется с порогом, выведенным из требуемого контраста (§6.4).

Меряем p95, а не среднее: один блик от кромки блюдца среднее не сдвинет,
а строку, которая на него попала, убьёт.

    python render/check_contrast.py                     # плёнка из public/film-xl
    python render/check_contrast.py --film public/film  # другая ширина
    python render/check_contrast.py --every 1           # все кадры, а не каждый 6-й
    python render/check_contrast.py --dump D:/tmp/pockets  # выгрузить худшие кадры с рамками

Код возврата 1, если хоть один карман не прошёл — чтобы падало в сборке.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

# Консоль Windows по умолчанию cp1251 и падает на галочках — это уже стоило нам
# одного «P0» в отчёте QA, который оказался крашем кодировки, а не багом.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ── Карманы ───────────────────────────────────────────────────────────────────
# Прямоугольники в долях кадра (x, y, w, h), начало — левый верхний угол.
# Одна плёнка на три локали, карманы НЕ зеркалятся.
# frames — участок ленты, на котором блок реально виден (маршрут камеры из scene.py).


@dataclass(frozen=True)
class Pocket:
    block: str
    name: str
    rect: tuple[float, float, float, float]
    p95_max: int
    mean_max: int | None = None
    frames: tuple[float, float] = (0.0, 1.0)  # доли ленты


POCKETS: list[Pocket] = [
    # 1 · hero — вордмарк разрывает кадр, текст идёт полосами сверху и снизу
    Pocket("1 hero", "верхняя полоса", (0.0, 0.0, 1.0, 0.26), 75, frames=(0.0, 0.22)),
    Pocket("1 hero", "нижняя полоса", (0.0, 0.72, 1.0, 0.28), 75, frames=(0.0, 0.22)),
    # 2 · зерно — метки по углам + плашка «зерно недели»
    Pocket("2 зерно", "угол ВЛ", (0.02, 0.03, 0.30, 0.10), 80, 56, frames=(0.20, 0.44)),
    Pocket("2 зерно", "угол ВП", (0.68, 0.03, 0.30, 0.10), 80, 56, frames=(0.20, 0.44)),
    Pocket("2 зерно", "угол НЛ", (0.02, 0.87, 0.30, 0.10), 80, 56, frames=(0.20, 0.44)),
    Pocket("2 зерно", "угол НП", (0.68, 0.87, 0.30, 0.10), 80, 56, frames=(0.20, 0.44)),
    Pocket("2 зерно", "плашка зерна", (0.55, 0.62, 0.42, 0.30), 56, 40, frames=(0.20, 0.44)),
    # 3 · меню — открытый список во всю правую половину
    Pocket("3 меню", "правая половина", (0.50, 0.06, 0.48, 0.88), 56, 40, frames=(0.42, 0.74)),
    # 4 · цитата и место
    Pocket("4 цитата", "центральная полоса", (0.14, 0.38, 0.72, 0.22), 75, frames=(0.60, 0.80)),
    Pocket("4 место", "рамка по периметру", (0.04, 0.04, 0.92, 0.92), 80, 56, frames=(0.72, 0.92)),
    # 5 · финал и хвост (плёнка стоит на последнем кадре)
    Pocket("5 финал", "нижняя треть", (0.0, 0.62, 1.0, 0.38), 75, frames=(0.86, 1.0)),
    Pocket("хвост", "весь кадр", (0.0, 0.0, 1.0, 1.0), 48, frames=(0.99, 1.0)),
]

# «Рамка по периметру» — это не сплошной прямоугольник, а полоса вдоль краёв.
# Считать по всей площади нечестно: середину кадра занимает чашка, она тёмная
# и занизит число. Помечаем такие карманы, чтобы вырезать середину.
FRAME_POCKETS = {("4 место", "рамка по периметру")}
FRAME_INSET = 0.04  # толщина полосы в долях кадра


def relative_luminance(rgb: np.ndarray) -> np.ndarray:
    """WCAG-яркость, вход uint8 RGB, выход 0..1 на пиксель."""
    srgb = rgb.astype(np.float32) / 255.0
    lin = np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)
    return lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722


def luminance_to_gray(lum: np.ndarray) -> np.ndarray:
    """Обратно в sRGB-серый 0..255 — в этих единицах заданы пороги §6.4."""
    srgb = np.where(lum <= 0.0031308, lum * 12.92, 1.055 * np.power(lum, 1 / 2.4) - 0.055)
    return srgb * 255.0


def crop(gray: np.ndarray, pocket: Pocket) -> np.ndarray:
    h, w = gray.shape
    x, y, pw, ph = pocket.rect
    x0, y0 = int(x * w), int(y * h)
    x1, y1 = int((x + pw) * w), int((y + ph) * h)
    x1, y1 = min(x1, w), min(y1, h)
    region = gray[y0:y1, x0:x1]

    if (pocket.block, pocket.name) in FRAME_POCKETS:
        # Вырезаем середину — остаётся только полоса вдоль краёв.
        rh, rw = region.shape
        ins_y, ins_x = int(FRAME_INSET * h), int(FRAME_INSET * w)
        if rh > 2 * ins_y and rw > 2 * ins_x:
            mask = np.ones(region.shape, dtype=bool)
            mask[ins_y : rh - ins_y, ins_x : rw - ins_x] = False
            return region[mask]
    return region.ravel()


def frame_files(film: Path) -> list[Path]:
    files = sorted(p for p in film.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".webp", ".png"})
    if not files:
        sys.exit(f"В {film} нет кадров")
    return files


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--film", default="public/film-xl", help="папка с кадрами плёнки")
    ap.add_argument("--every", type=int, default=6, help="брать каждый N-й кадр (по умолчанию 6)")
    ap.add_argument("--dump", help="папка для выгрузки худших кадров с нарисованными карманами")
    args = ap.parse_args()

    root = Path(__file__).resolve().parent.parent
    film = (root / args.film) if not Path(args.film).is_absolute() else Path(args.film)
    files = frame_files(film)
    total = len(files)

    # Кадры читаем по одному разу, а не по разу на карман.
    # Последний кадр берём всегда: на нём плёнка стоит, пока читают финал, и
    # при шаге 6 он в выборку не попадал вовсе.
    sampled = [(i, f) for i, f in enumerate(files) if i % args.every == 0 or i == total - 1]
    print(f"Плёнка: {film}  ·  кадров {total}, меряем {len(sampled)} (каждый {args.every}-й)\n")

    # worst[pocket_index] = (p95, mean, frame_index)
    worst: dict[int, tuple[float, float, int]] = {}

    for idx, path in sampled:
        pos = idx / max(total - 1, 1)
        with Image.open(path) as im:
            arr = np.asarray(im.convert("RGB"))
        gray = luminance_to_gray(relative_luminance(arr))

        for pi, pocket in enumerate(POCKETS):
            lo, hi = pocket.frames
            if not (lo <= pos <= hi):
                continue
            values = crop(gray, pocket)
            p95 = float(np.percentile(values, 95))
            mean = float(values.mean())
            prev = worst.get(pi)
            if prev is None or p95 > prev[0]:
                worst[pi] = (p95, mean, idx)

    failed = 0
    current_block = None
    for pi, pocket in enumerate(POCKETS):
        if pi not in worst:
            print(f"  ⚠ {pocket.block} · {pocket.name}: ни один кадр не попал в диапазон {pocket.frames}")
            continue
        p95, mean, frame_idx = worst[pi]
        ok_p95 = p95 <= pocket.p95_max
        ok_mean = pocket.mean_max is None or mean <= pocket.mean_max
        ok = ok_p95 and ok_mean
        failed += 0 if ok else 1

        if pocket.block != current_block:
            print(f"\n{pocket.block}")
            current_block = pocket.block

        mark = "✓" if ok else "✗"
        limit = f"p95 ≤ {pocket.p95_max}"
        if pocket.mean_max is not None:
            limit += f", mean ≤ {pocket.mean_max}"
        over = "" if ok else f"   ← перебор p95 на {p95 - pocket.p95_max:+.0f}"
        print(
            f"  {mark} {pocket.name:22} p95 {p95:6.1f}  mean {mean:6.1f}   "
            f"[{limit}]  худший кадр {frame_idx:3d}{over}"
        )

        if args.dump and not ok:
            dump_dir = Path(args.dump)
            dump_dir.mkdir(parents=True, exist_ok=True)
            with Image.open(files[frame_idx]) as im:
                shot = im.convert("RGB")
            draw = ImageDraw.Draw(shot)
            w, h = shot.size
            x, y, pw, ph = pocket.rect
            draw.rectangle(
                [x * w, y * h, (x + pw) * w, (y + ph) * h],
                outline=(232, 93, 78),
                width=max(2, w // 400),
            )
            safe = f"{pocket.block}-{pocket.name}".replace(" ", "_").replace("·", "")
            shot.save(dump_dir / f"{safe}-f{frame_idx:03d}.png")

    print()
    if failed:
        print(f"✗ Карманов не прошло: {failed} из {len(worst)}.")
        print("  Правится пререндер (render/scene.py), а не CSS: грейд не добавляет слой, страховка добавляет.")
        return 1
    print(f"✓ Все {len(worst)} карманов проходят пороги.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
