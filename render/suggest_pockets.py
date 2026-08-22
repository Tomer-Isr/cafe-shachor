"""
Куда на самом деле можно класть текст: карта пригодности кадра.

`check_contrast.py` отвечает на вопрос «проходит ли назначенный карман».
Этот скрипт отвечает на обратный: «а где кадр вообще годится под текст».
Карманы дизайн-системы назначены по раскадровке — здесь они сверяются
с тем, что реально отрендерилось.

Кадр делится сеткой, для каждой клетки считается p95 яркости, и по участкам
ленты печатается карта: где текст ляжет на глухое поле, где нужен скрим,
а где не ляжет вовсе.

    python render/suggest_pockets.py                          # плёнка D:/tmp/cafe-graded
    python render/suggest_pockets.py --film public/film-xl
    python render/suggest_pockets.py --cols 6 --rows 4
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_contrast import luminance_to_gray, relative_luminance  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Участки ленты = акты маршрута камеры (render/scene.py, разметка из App.tsx).
ACTS = [
    ("общий план", 0, 28),
    ("зерно", 29, 62),
    ("налив", 63, 106),
    ("взгляд в чашку", 107, 143),
]

# Пороги из DESIGN-SYSTEM §6.4, в единицах sRGB-серого.
T_DISPLAY = 75   # крупный заголовок
T_BODY = 80      # корпус (плюс требование к среднему)
T_LABEL = 36     # мелкие метки


def verdict(p95: float) -> str:
    """Один знак на клетку — чтобы карта читалась взглядом."""
    if p95 <= T_LABEL:
        return "#"   # глухо: годится под что угодно, включая мелкие метки
    if p95 <= T_DISPLAY:
        return "+"   # годится под заголовок и корпус
    if p95 <= 110:
        return "."   # только со скримом
    return " "       # не класть текст


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--film", default="D:/tmp/cafe-graded")
    ap.add_argument("--every", type=int, default=4)
    ap.add_argument("--cols", type=int, default=8)
    ap.add_argument("--rows", type=int, default=6)
    args = ap.parse_args()

    film = Path(args.film)
    files = sorted(p for p in film.iterdir() if p.suffix.lower() in {".png", ".webp", ".jpg"})
    if not files:
        sys.exit(f"нет кадров в {film}")

    print(f"Плёнка: {film} · кадров {len(files)}\n")
    print("Легенда:  # глухо (можно метки)   + заголовок и корпус   . только со скримом   ␣ не класть\n")

    for act, lo, hi in ACTS:
        # Худшая клетка по акту: текст живёт весь акт, а не один кадр.
        worst = np.zeros((args.rows, args.cols), dtype=np.float32)
        picked = 0
        for idx in range(lo, min(hi + 1, len(files))):
            if idx % args.every:
                continue
            with Image.open(files[idx]) as im:
                arr = np.asarray(im.convert("RGB"))
            gray = luminance_to_gray(relative_luminance(arr))
            h, w = gray.shape
            for r in range(args.rows):
                for c in range(args.cols):
                    cell = gray[
                        r * h // args.rows : (r + 1) * h // args.rows,
                        c * w // args.cols : (c + 1) * w // args.cols,
                    ]
                    worst[r, c] = max(worst[r, c], float(np.percentile(cell, 95)))
            picked += 1

        print(f"── {act}  (кадры {lo}–{hi}, взято {picked})")
        for r in range(args.rows):
            row = "".join(verdict(worst[r, c]) * 3 for c in range(args.cols))
            nums = " ".join(f"{worst[r, c]:3.0f}" for c in range(args.cols))
            print(f"   |{row}|   {nums}")
        print()

    print("Читать так: столбцы — слева направо по кадру, строки — сверху вниз.")
    print("Плёнка одна на три локали, поэтому карманы не зеркалятся: колонка,")
    print("годная под текст, должна быть годной и для RTL, и для LTR.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
