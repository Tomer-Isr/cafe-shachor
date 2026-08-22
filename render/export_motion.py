"""
Насколько быстро меняется кадр — числом на каждый кадр плёнки.

Хореография требует, чтобы скорость выхода текста задавалась движением камеры:
камера стоит — строки выходят медленно, камера летит — быстро. Взять скорость
из маршрута нельзя: он перепараметризован по длине пути (`_arc_table` в
scene.py), и по прокрутке камера движется равномерно по построению.

Поэтому меряем не метры, а картинку: среднюю разницу соседних кадров. Кадр почти
не меняется — камера «стоит», как её видит зритель. Это и есть та величина,
которая нужна тексту.

    python render/export_motion.py                 # по public/film
    python render/export_motion.py --film D:/tmp/cafe-c144

Результат — src/film/motion.json: массив 0..1 длиной в плёнку.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent

# Считаем по уменьшенной копии: разница крупных форм — это и есть движение
# камеры, а шум текстуры на полном разрешении только мешает.
WORK_WIDTH = 320

# Сглаживание по соседям: одиночный выброс (блик, вспышка отражения) не должен
# читаться как рывок камеры.
SMOOTH = 2


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--film", default="public/film")
    ap.add_argument("--out", default="src/film/motion.json")
    args = ap.parse_args()

    film = Path(args.film) if Path(args.film).is_absolute() else ROOT / args.film
    files = sorted(p for p in film.iterdir() if p.suffix.lower() in {".webp", ".png", ".jpg"})
    if not files:
        sys.exit(f"нет кадров в {film}")

    def load(path: Path) -> np.ndarray:
        with Image.open(path) as im:
            im = im.convert("L")
            h = round(im.height * WORK_WIDTH / im.width)
            return np.asarray(im.resize((WORK_WIDTH, h), Image.BILINEAR)).astype(np.float32)

    prev = load(files[0])
    raw = [0.0]
    for path in files[1:]:
        cur = load(path)
        raw.append(float(np.abs(cur - prev).mean()))
        prev = cur
    raw[0] = raw[1] if len(raw) > 1 else 0.0

    arr = np.array(raw, dtype=np.float32)
    if SMOOTH:
        kernel = np.ones(SMOOTH * 2 + 1, dtype=np.float32) / (SMOOTH * 2 + 1)
        arr = np.convolve(arr, kernel, mode="same")

    # Нормируем по 90-му перцентилю, а не по максимуму: один самый резкий переход
    # иначе прижмёт всю остальную ленту к нулю, и текст везде станет медленным.
    scale = float(np.percentile(arr, 90)) or 1.0
    norm = np.clip(arr / scale, 0.0, 1.0)

    out = ROOT / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps([round(float(v), 3) for v in norm]), encoding="utf-8")

    acts = [("общий план", 0, 28), ("зерно", 29, 62), ("налив", 63, 106), ("взгляд", 107, len(norm) - 1)]
    print(f"{out.relative_to(ROOT)} — {len(norm)} значений\n")
    print("Средняя визуальная скорость по актам (0 — кадр стоит, 1 — быстрее всего):")
    for name, lo, hi in acts:
        seg = norm[lo : hi + 1]
        if len(seg):
            dur = 900 - float(seg.mean()) * 450
            print(f"  {name:12} v={seg.mean():.2f}  →  выход строк {dur:.0f} мс, шаг {dur / 9:.0f} мс")
    return 0


if __name__ == "__main__":
    sys.exit(main())
