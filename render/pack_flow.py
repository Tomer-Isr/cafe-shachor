"""Карты движения между соседними кадрами плёнки.

Зачем. Между соседними кадрами камера уезжает на 19–23 пикселя (замер в
docs/DIAG-SMOOTHNESS.md). Простое перетекание одного кадра в другой читается
как движение только пока разрыв не больше 2–3 px; на нашем разрыве глаз видит
не движение, а два наложенных изображения — «чашку шатает при прокрутке».

Что делаем. Для каждой пары кадров считаем оптический поток: куда уехал каждый
кусок картинки. Дальше шейдер не смешивает кадры на месте, а сдвигает каждый
навстречу другому по этой карте — и промежуточное положение получается
настоящим, а не двойным.

Поток считается по уже готовым кадрам, Blender не нужен. Прогон — секунды.

Запуск:
    python render/pack_flow.py                      # из public/film-xl
    python render/pack_flow.py --src public/film    # из другой плёнки
    python render/pack_flow.py --width 320          # разрешение карты

Результат: public/film-flow/flow-NNN.webp — RG-карта, где
    R = смещение по X, G = смещение по Y, обе 0..255 вокруг 128,
    масштаб ±RANGE пикселей в координатах ИСХОДНОГО кадра.
Последняя карта пустая: за последним кадром двигаться некуда.
"""

import glob
import json
import os
import sys

import cv2
import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def opt(name: str, default: str) -> str:
    argv = sys.argv[1:]
    return argv[argv.index(name) + 1] if name in argv else default


SRC = opt("--src", os.path.join(ROOT, "public", "film-xl"))
DST = opt("--dst", os.path.join(ROOT, "public", "film-flow"))
# Карта потока не обязана быть подробной: поток между соседними кадрами гладкий,
# резких границ в нём нет. 320 px хватает, а весит вся плёнка карт считанные сотни КБ.
WIDTH = int(opt("--width", "320"))
# Диапазон кодирования. Замеренный максимум смещения — 41 px на кадре 2400,
# то есть около 32 на 1900. Берём с запасом, чтобы не срезать выбросы.
RANGE = float(opt("--range", "64"))


def write_pacing(speeds: list[float], count: int, samples: int = 256) -> None:
    """Раскладка прокрутки по видимой скорости камеры.

    Маршрут камеры в scene.py перепараметризован по ДЛИНЕ ПУТИ, то есть в метрах
    сцены камера едет равномерно. На экране это не так: у близкого предмета то же
    перемещение даёт куда больший сдвиг картинки, а поворот камеры — тем более.
    Замер по готовой плёнке: в начале 11 пикселей на кадр, в середине 44 —
    вчетверо быстрее. При ровной прокрутке сцена то ползёт, то дёргается, и это
    не лечится сглаживанием: источник в самой плёнке.

    Здесь строится обратная таблица: равномерный прогресс 0..1 -> дробный номер
    кадра. Участки, где картинка меняется быстро, растягиваются по прокрутке,
    медленные — сжимаются. Тогда видимая скорость становится постоянной.
    Перерендер не нужен.
    """
    if not speeds:
        return

    # Пол по скорости: полностью статичные куски иначе схлопнулись бы в точку,
    # и по ним пришлось бы «проскакивать» мгновенно.
    floor = max(1e-3, float(np.median(speeds)) * 0.25)
    w = np.maximum(np.array(speeds, dtype=np.float64), floor)

    cum = np.concatenate([[0.0], np.cumsum(w)])
    cum /= cum[-1]  # 0..1, по одному значению на кадр

    frames = np.arange(len(cum), dtype=np.float64)
    grid = np.linspace(0.0, 1.0, samples)
    table = np.interp(grid, cum, frames)          # прогресс -> номер кадра
    table = table / (count - 1)                   # нормируем обратно в 0..1

    out = os.path.join(ROOT, "src", "film", "pacing.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump([round(float(v), 6) for v in table], f)

    # Насколько выровнялось: скорость по новой раскладке
    idx = np.clip((table * (count - 1)).astype(int), 0, len(w) - 1)
    after = w[idx]
    print(
        f"[pacing] {samples} отсчётов -> src/film/pacing.json | "
        f"разброс скорости было {w.max() / np.median(w):.1f}x, "
        f"стало {after.max() / np.median(after):.1f}x"
    )


def main() -> None:
    files = sorted(glob.glob(os.path.join(SRC, "frame-*.webp")))
    if not files:
        print("нет кадров в", SRC)
        return

    first = cv2.imread(files[0], cv2.IMREAD_COLOR)
    if first is None:
        print("не читается", files[0])
        return
    src_h, src_w = first.shape[:2]
    h = round(WIDTH * src_h / src_w)
    os.makedirs(DST, exist_ok=True)

    # DIS в среднем режиме: заметно быстрее Farneback и заметно точнее на
    # плавном движении камеры, что у нас и есть.
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)

    def gray(path: str) -> np.ndarray:
        im = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
        return cv2.resize(im, (WIDTH, h), interpolation=cv2.INTER_AREA)

    prev = gray(files[0])
    total = 0
    peak = 0.0
    speeds: list[float] = []

    for i in range(len(files)):
        if i < len(files) - 1:
            cur = gray(files[i + 1])
            flow = dis.calc(prev, cur, None)  # в пикселях карты
            prev = cur
            # Переводим в пиксели ИСХОДНОГО кадра: карта уменьшена, смещения тоже.
            flow = flow * (src_w / WIDTH)
            peak = max(peak, float(np.abs(flow).max()))
            # Медиана, а не среднее: один блик или край кадра не должны
            # решать за всю картинку.
            speeds.append(float(np.median(np.linalg.norm(flow, axis=2))))
        else:
            flow = np.zeros((h, WIDTH, 2), np.float32)

        enc = np.clip(flow / RANGE, -1.0, 1.0) * 127.0 + 128.0
        img = np.zeros((h, WIDTH, 3), np.uint8)
        img[:, :, 2] = enc[:, :, 0].astype(np.uint8)  # R = X (OpenCV пишет BGR)
        img[:, :, 1] = enc[:, :, 1].astype(np.uint8)  # G = Y

        out = os.path.join(DST, f"flow-{i:03d}.webp")
        # Без потерь: поток — данные. Сжатие с потерями размажет границы
        # и вернёт то самое двоение, от которого мы уходим.
        cv2.imwrite(out, img, [cv2.IMWRITE_WEBP_QUALITY, 101])
        total += os.path.getsize(out)

    print(
        f"[film-flow] {len(files)} карт, {WIDTH}x{h}, "
        f"{total // 1024} КБ всего, {total // 1024 // len(files)} КБ на карту"
    )

    write_pacing(speeds, len(files))
    print(f"пиковое смещение: {peak:.1f} px в координатах кадра {src_w}px (диапазон ±{RANGE:.0f})")
    if peak > RANGE:
        print("ВНИМАНИЕ: смещения срезаны, поднять --range")


if __name__ == "__main__":
    main()
