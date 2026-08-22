"""
Грейд карманов: гасим блики там, где ляжет текст.

Замер (`check_contrast.py`) показал вещь, которая определяет решение: средняя
яркость в карманах низкая (35–60 из 255), а p95 доходит до 200. То есть кадр
под текстом в целом тёмный, и убивают строку отдельные блики — кромка блюдца,
пятно света на стойке, край питчера.

Отсюда инструмент: не затемнение кармана (оно убило бы сцену, ради которой всё
и делалось), а **компрессия светов внутри кармана**. Всё, что темнее колена,
не трогается вовсе; всё, что светлее, поджимается к колену. Средняя яркость
почти не меняется — глазом это читается как «блик приглушили», а не «картинку
притемнили».

Работает по исходным PNG из Cycles, не по упакованной плёнке: перерендер сцены
не нужен, грейд всё равно запекается в файл и рантайму ничего не стоит.

    python render/grade_pockets.py D:/tmp/cafe-hi144 --out D:/tmp/cafe-hi144-graded
    python render/grade_pockets.py D:/tmp/cafe-hi144 --out D:/tmp/g --only 30,54,90

Дальше — обычная упаковка:

    python render/pack_frames.py D:/tmp/cafe-hi144-graded --aux D:/tmp/cafe-hi144-aux
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_contrast import (  # noqa: E402
    FRAME_INSET,
    FRAME_POCKETS,
    POCKETS,
    Pocket,
    luminance_to_gray,
    relative_luminance,
)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Растушёвка края кармана в долях ширины кадра. Резкая граница читалась бы как
# прямоугольная заплата на сцене — на первой пробе (feather 5.5%) по центру кадра
# прошла видимая вертикальная граница, и свет на ободке чашки обрывался.
FEATHER = 0.11

# Насколько слабее грейдится передний план. Гасим фон, а не героя: карта глубины
# из Cycles уже лежит рядом с кадром, и «уход фона в тень» — это то самое, что
# делают в пререндере вместо CSS-подложки. Чашка теряет максимум эту долю
# компрессии, дальний план получает её целиком.
FG_STRENGTH = 0.3

# Потолок затемнения: ни один пиксель не гасится сильнее, чем до этой доли
# исходной яркости. Без потолка скрипт «дотягивается» до цели там, где в кармане
# стоит освещённая чашка, и съедает свет на герое ради строки текста.
# Упёрлись в потолок — значит грейд для этого кармана бессилен, и это не повод
# давить сильнее, а сигнал: блоку нужен скрим-градиент (DESIGN-SYSTEM §6.1 п.2).
MAX_DARKEN = 0.45

# Доля диапазона кадров, за которую грейд нарастает и спадает. Без неё кадр 29
# идёт без грейда, кадр 30 — с грейдом, и на скрабе это щёлкает.
RAMP = 0.12

# Целимся ниже порога: webp ещё будет жать, и запас в пару единиц дешевле,
# чем второй прогон всей плёнки.
SAFETY = 6.0


def smoothstep(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - edge0) / max(edge1 - edge0, 1e-6), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def pocket_mask(shape: tuple[int, int], pocket: Pocket) -> np.ndarray:
    """Мягкая маска кармана, 0..1."""
    h, w = shape
    x, y, pw, ph = pocket.rect
    fx, fy = FEATHER * w, FEATHER * w  # растушёвка одинаковая по осям — в пикселях, не в долях

    xs = np.arange(w, dtype=np.float32)
    ys = np.arange(h, dtype=np.float32)

    x0, x1 = x * w, (x + pw) * w
    y0, y1 = y * h, (y + ph) * h

    # Полоса вдоль каждой оси с мягкими краями. За краем кадра растушёвки нет:
    # карман, прижатый к границе, не должен гаснуть на ровном месте.
    def band(coords: np.ndarray, lo: float, hi: float, feather: float, limit: float) -> np.ndarray:
        left = np.ones_like(coords) if lo <= 0.5 else smoothstep(lo - feather, lo + feather, coords)
        right = np.ones_like(coords) if hi >= limit - 0.5 else 1.0 - smoothstep(hi - feather, hi + feather, coords)
        return left * right

    mx = band(xs, x0, x1, fx, w)
    my = band(ys, y0, y1, fy, h)
    mask = my[:, None] * mx[None, :]

    if (pocket.block, pocket.name) in FRAME_POCKETS:
        # Рамка по периметру: середину кадра занимает чашка, её грейдить незачем.
        ins_x, ins_y = FRAME_INSET * w, FRAME_INSET * h
        inner_x = band(xs, x0 + ins_x, x1 - ins_x, fx, w)
        inner_y = band(ys, y0 + ins_y, y1 - ins_y, fy, h)
        mask = mask * (1.0 - inner_y[:, None] * inner_x[None, :])

    return mask.astype(np.float32)


def time_weight(pos: float, pocket: Pocket) -> float:
    lo, hi = pocket.frames
    span = max(hi - lo, 1e-6)
    ramp = span * RAMP
    if pos < lo - ramp or pos > hi + ramp:
        return 0.0
    up = float(smoothstep(lo - ramp, lo + ramp, np.array(pos)))
    down = 1.0 - float(smoothstep(hi - ramp, hi + ramp, np.array(pos)))
    return up * down


def compress_highlights(gray: np.ndarray, mask: np.ndarray, p95: float, target: float) -> np.ndarray:
    """Множитель яркости: 1.0 там, где ничего не трогаем.

    Колено ставится заметно ниже цели, чтобы поджатие начиналось плавно и не
    давало ступеньки на границе. Коэффициент подбирается так, чтобы текущий
    p95 сел ровно в цель.
    """
    knee = target * 0.55
    if p95 <= knee + 1.0:
        return np.ones_like(gray)

    k = (target - knee) / (p95 - knee)
    k = float(np.clip(k, 0.05, 1.0))

    compressed = knee + (gray - knee) * k
    # Плавное включение вокруг колена — иначе на нём излом.
    w = smoothstep(knee * 0.75, knee * 1.25, gray)
    graded = gray * (1.0 - w) + compressed * w
    graded = np.minimum(graded, gray)  # грейд только гасит, никогда не поднимает

    ratio = np.ones_like(gray)
    lit = gray > 1.0
    ratio[lit] = graded[lit] / gray[lit]
    return 1.0 - (1.0 - ratio) * mask


def depth_weight(shape: tuple[int, int], aux_path: Path | None) -> np.ndarray:
    """1 на дальнем плане, FG_STRENGTH на переднем.

    Красный канал служебной карты — глубина (0 у объектива). Границы берём
    по перцентилям самого кадра: абсолютные значения гуляют вместе с камерой,
    а «что здесь передний план» — не гуляет.
    """
    if aux_path is None or not aux_path.exists():
        return np.ones(shape, dtype=np.float32)

    with Image.open(aux_path) as im:
        depth = np.asarray(im.convert("RGB"))[..., 0].astype(np.float32)

    near, far = np.percentile(depth, 12), np.percentile(depth, 78)
    if far - near < 4:
        return np.ones(shape, dtype=np.float32)

    w = smoothstep(float(near), float(far), depth)
    w = FG_STRENGTH + (1.0 - FG_STRENGTH) * w

    img = Image.fromarray((w * 255).astype(np.uint8)).resize((shape[1], shape[0]), Image.BILINEAR)
    return np.asarray(img).astype(np.float32) / 255.0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("src", nargs="?", default="D:/tmp/cafe-hi144", help="папка с PNG из Cycles")
    ap.add_argument("--out", default="D:/tmp/cafe-hi144-graded", help="куда положить кадры с грейдом")
    ap.add_argument("--aux", default="D:/tmp/cafe-hi144-aux", help="карты глубины из того же прогона")
    ap.add_argument("--only", help="через запятую: номера кадров для пробы")
    args = ap.parse_args()

    src, out = Path(args.src), Path(args.out)
    files = sorted(src.glob("frame-*.png"))
    if not files:
        sys.exit(f"нет кадров в {src}")
    out.mkdir(parents=True, exist_ok=True)

    only = {int(v) for v in args.only.split(",")} if args.only else None
    total = len(files)
    touched = 0
    # Карманы, где грейд упёрся в потолок и цель не взята — им нужна страховка в CSS.
    short: dict[tuple[str, str], list[tuple[int, float, int]]] = {}

    for idx, path in enumerate(files):
        if only is not None and idx not in only:
            continue
        pos = idx / max(total - 1, 1)
        active = [(p, w) for p in POCKETS if (w := time_weight(pos, p)) > 0.01]

        with Image.open(path) as im:
            rgb = np.asarray(im.convert("RGB")).astype(np.float32)

        if not active:
            Image.fromarray(rgb.astype(np.uint8)).save(out / path.name)
            continue

        gray = luminance_to_gray(relative_luminance(rgb.astype(np.uint8)))
        aux = Path(args.aux) / f"aux-{idx:03d}.png" if args.aux else None
        depth_w = depth_weight(gray.shape, aux)

        factor = np.ones(gray.shape, dtype=np.float32)
        notes = []

        for pocket, weight in active:
            mask = pocket_mask(gray.shape, pocket) * weight * depth_w
            sel = mask > 0.02
            if not sel.any():
                continue
            target = pocket.p95_max - SAFETY
            start = float(np.percentile(gray[sel], 95))
            if start <= target:
                continue

            # Передний план держим слабее фона, поэтому одного прохода может не
            # хватить: догоняем, пока карман не сядет в цель.
            local = factor.copy()
            reached = start
            for _ in range(3):
                current = luminance_to_gray(relative_luminance(np.clip(rgb * local[..., None], 0, 255).astype(np.uint8)))
                reached = float(np.percentile(current[sel], 95))
                if reached <= target:
                    break
                local = np.minimum(local, compress_highlights(current, mask, reached, target))
                np.maximum(local, MAX_DARKEN, out=local)

            factor = np.minimum(factor, local)  # несколько карманов внахлёст — берём сильнейший
            notes.append(f"{pocket.name} p95 {start:.0f}→{reached:.0f}")
            if reached > pocket.p95_max:
                short.setdefault((pocket.block, pocket.name), []).append((idx, reached, pocket.p95_max))

        if notes:
            touched += 1
            graded = np.clip(rgb * factor[..., None], 0, 255)
        else:
            graded = rgb

        Image.fromarray(graded.astype(np.uint8)).save(out / path.name)

        if idx % 12 == 0 or notes:
            tail = ("  " + " · ".join(notes)) if notes else "  без правок"
            print(f"кадр {idx:3d}/{total - 1}{tail}")

    print(f"\nГотово: {out}  ·  грейд применён к {touched} кадрам")

    if short:
        print("\nГрейда не хватило — этим блокам нужен скрим-градиент (§6.1 п.2):")
        for (block, name), rows in sorted(short.items()):
            worst = max(rows, key=lambda r: r[1])
            print(
                f"  · {block} · {name}: худший кадр {worst[0]}, "
                f"p95 {worst[1]:.0f} при пороге {worst[2]} — не добрано на {worst[1] - worst[2]:.0f}"
                f"  ({len(rows)} кадров из выборки)"
            )
        print("  Давить сильнее нельзя: в этих карманах свет лежит на самой чашке, а не на фоне.")

    print("\nДальше: python render/pack_frames.py", out, "--aux D:/tmp/cafe-hi144-aux")
    return 0


if __name__ == "__main__":
    sys.exit(main())
