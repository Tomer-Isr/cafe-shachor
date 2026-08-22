"""
Где в кадре есть место под текст — прямоугольником на каждый кадр плёнки.

`check_contrast.py` проверяет назначенные карманы, `suggest_pockets.py` рисует
грубую карту сеткой 8×6. Здесь задача третья и главная: **найти** место само,
не спрашивая раскадровку, и провести его через всю ленту так, чтобы текст
переезжал вслед за камерой, а не дёргался от кадра к кадру.

── Как считается ────────────────────────────────────────────────────────────

1. **Скользящее окно, а не сетка.** Шесть форм (узкая колонка, короткая колонка,
   широкий блок, баннер, квадрат, метка) прогоняются по кадру с шагом 2% ширины.
   Текстовый блок бывает разной формы, и колонка влезает туда, куда не влезает
   баннер, — фиксированная сетка это теряет.

2. **Два числа, а не одно.** p95 яркости (текст тонет на светлом) и σ —
   среднеквадратичный разброс (текст тонет на пёстром: контрастная граница под
   строкой режет её пополам не хуже блика). Окно годится, только если низки оба.

3. **Зёрна — запрет.** Канал G служебной карты (`public/film-aux`) хранит номер
   предмета: 1 чашка, 2 кофе, 3 зерно, 4 питчер, 5 темпер. Маска зёрен сперва
   размыкается (см. BEAN_ERODE — на силуэтах предметов есть волосяной обвод с
   номером «зерно», и это артефакт рендера, а не зерно), потом расширяется на
   3% кадра и запрещает окно целиком. Запрет растянут и во времени (±4 кадра):
   текст уходит с места ДО того, как туда приедет зерно, а не в тот же кадр —
   иначе это читается как рывок.
   Чашка и кофе не запрещены. Кофе не штрафуется вовсе — коричневое поле внутри
   чашки как раз хорошее место; корпус чашки штрафуется мягко: по нему идёт
   вордмарк. Оба попадают в флаг `on`.

4. **Гладкость — не постобработка, а часть поиска.** Оценка места берётся как
   его ХУДШЕЕ значение в окне ±3 кадра — место, которое вот-вот испортится,
   теряет очки заранее. После этого траектория ищется динамическим
   программированием (Витерби) по всей плёнке разом: за шаг разрешено сдвинуться
   максимум на четыре клетки сетки, каждая клетка стоит очков, а падение оценки
   ниже Q_FLOOR штрафуется отдельно — иначе сумма по ленте охотно покупает
   десяток отличных кадров ценой пяти нечитаемых. Поэтому зона переезжает,
   только когда переезд окупается, и уезжает заблаговременно. Взять «лучшее окно
   на кадре» и сгладить постфактум нельзя — усреднение двух разных мест даёт
   третье, негодное.

5. **Три дорожки, а не одна.** После первой траектории её область гасится
   (перекрытие меньшего из прямоугольников > 12%) и поиск повторяется — так
   получаются 2-я и 3-я. Одиночный «лучший» кандидат прыгал бы: у фронта должен
   быть выбор. Он же и страховка: там, где первая зона на пару кадров переезжает
   через ободок чашки, вторая стоит на чистом фоне.

6. **Цвет считается по худшему пикселю, а не по среднему.** Для светлого
   `#ece6dc` худший случай — самый светлый фон (p95), для тёмного `#0a0908` —
   самый тёмный (p05). Считаются оба контраста, в `c` кладётся тот, что проходит
   4.5:1; при прочих равных выигрывает светлый (бренд), тёмный побеждает только
   на кофейном поле, где ему есть на чём стоять.

── Формат src/film/zones.json ───────────────────────────────────────────────

    {
      "meta": {
        "frames": 144,                  длина плёнки
        "film": "public/film-xl",
        "acts": [{"name","from","to"}], акты маршрута камеры
        "shapes": {"column": [w,h], …}  формы окон в долях кадра
        "colors": {"light","dark"},     кандидаты цвета текста
        "thresholds": {…}               пороги DESIGN-SYSTEM §6.4
      },
      "tracks": [
        { "id": "primary" | "second" | "third",
          "frames": [                   ровно meta.frames элементов, индекс = кадр
            { "r":  [x, y, w, h],       прямоугольник в долях кадра, начало — левый верхний угол
              "c":  "#ece6dc",          рекомендованный цвет текста
              "s":  0 | 1,              нужен ли скрим-градиент под блоком
              "q":  0.78,               оценка пригодности 0..1
              "p95": 44.1, "p05": 8.2,  яркость фона, sRGB-серый 0..255
              "sd": 9.4,                разброс яркости
              "bg": "#1a1512",          средний цвет фона под зоной
              "cl": 12.4, "cd": 1.4,    контраст светлого и тёмного текста
              "on": ["cup"],            предметы под зоной (зёрен здесь не бывает)
              "shape": "column"         какая из форм выиграла — для отладки
            }, … ] } ] }

Фронту достаточно `r`, `c`, `s`. Прогресс 0..1 → `i = p * (frames - 1)`,
прямоугольник линейно интерполируется между `floor(i)` и `ceil(i)`, цвет и скрим
берутся у ближайшего кадра.

`q` — насколько место годное: 0.8 и выше хорошо, ниже 0.45 использовать не стоит,
там надо брать следующую дорожку. Дорожки отсортированы по качеству: `primary`
годится почти везде, `third` — заметно хуже и местами пустая по смыслу.

── Запуск ───────────────────────────────────────────────────────────────────

    python render/text_zones.py                          # плёнка public/film-xl
    python render/text_zones.py --film D:/tmp/cafe-c144  # другая плёнка
    python render/text_zones.py --sheet-frames 116,120,124,126,128,132
    python render/text_zones.py --width 640              # точнее и медленнее
    python render/text_zones.py --tracks 2               # только два варианта
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import (  # noqa: E402
    binary_dilation,
    binary_erosion,
    gaussian_filter1d,
    maximum_filter1d,
    minimum_filter1d,
)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_contrast import luminance_to_gray, relative_luminance  # noqa: E402

# Консоль Windows по умолчанию cp1251 и падает на любой букве не из неё.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent

# ── Что где на плёнке ────────────────────────────────────────────────────────

# Акты маршрута камеры — те же, что в suggest_pockets.py и export_motion.py.
ACTS = [
    ("общий план", 0, 28),
    ("зерно", 29, 62),
    ("налив", 63, 106),
    ("взгляд в чашку", 107, 143),
]

# Канал G служебной карты = номер предмета / 8, то есть шаг 32 единицы.
OBJ_STEP = 32
OBJ = {1: "cup", 2: "coffee", 3: "bean", 4: "pitcher", 5: "tamper", 6: "spout", 7: "lamp"}
BEAN_ID = 3

# ── Формы окон, в долях кадра ────────────────────────────────────────────────
# Ширина и высота независимы: кадр 16:9, и «квадратная» доля даёт не квадрат.
# Набор подобран под реальные блоки макета, а не «чтобы было»: колонка под
# заголовок со строкой корпуса, блок под абзац, баннер под манифест в одну
# строку, метка под подпись.
SHAPES: dict[str, tuple[float, float]] = {
    "column": (0.24, 0.46),    # узкая высокая колонка
    "column-s": (0.28, 0.30),  # короткая колонка
    "block": (0.42, 0.26),     # широкий блок
    "banner": (0.58, 0.15),    # строка во всю ширину
    "square": (0.32, 0.34),    # почти квадрат
    "label": (0.22, 0.10),     # мелкая метка
}
MAX_AREA = max(w * h for w, h in SHAPES.values())

# ── Пороги и веса ────────────────────────────────────────────────────────────

# Пороги DESIGN-SYSTEM §6.4, единицы — sRGB-серый 0..255.
T_LABEL, T_DISPLAY, T_BODY = 36, 75, 80

# Оценка яркости. Ниже LUM_GOOD выигрыша уже нет: строка на p95=30 читается не
# лучше, чем на p95=48, а сцену видно и там и там. Выше LUM_BAD не спасёт и скрим.
LUM_GOOD, LUM_BAD = 50.0, 110.0
# Оценка разброса. σ ≤ 10 — ровное поле; σ ≥ 34 — под строкой проходит граница.
STD_GOOD, STD_BAD = 10.0, 34.0
# Выше этого разброса зоне нужен скрим, даже если яркость в порядке.
STD_SCRIM = 26.0

# Читаемость и привлекательность перемножаются, а не складываются. Складывать
# нельзя: большое пятно поперёк освещённого ободка набирало бы очков за площадь
# столько же, сколько тёмное поле — за темноту, и побеждало. Место, где текст не
# читается, не становится лучше от того, что оно просторное.
W_LUM, W_STD = 0.55, 0.45          # внутри читаемости
AREA_FLOOR, MID_FLOOR = 0.55, 0.80  # насколько площадь и центр могут понизить оценку

# Штраф за корпус чашки (предмет 1). Не запрет — просьба владельца про запрет
# была только о зёрнах, — но и не «всё равно»: на боку чашки напечатан вордмарк,
# и заголовок поперёк него читается как ошибка. Кофе (предмет 2) не штрафуется
# вовсе: положить текст на коричневое поле внутри чашки — это как раз то, чего
# от плёнки и хотели.
CUP_PENALTY = 0.35

# Цвета текста-кандидаты (DESIGN-SYSTEM §1.1).
FG_LIGHT = "#ece6dc"
FG_DARK = "#0a0908"
AA_CONTRAST = 4.5

# Отступ от края кадра: строка, прижатая к обрезу, читается как ошибка вёрстки.
SAFE = 0.035
# Шаг сетки положений в долях ширины кадра.
STRIDE = 0.02

# Зерно запрещает окно, если занимает больше этой доли его площади. Не ноль:
# один пиксель на границе маски — не повод выкидывать место.
BEAN_TOLERANCE = 0.004
# Маска зёрен расширяется — текст не должен и касаться зерна.
BEAN_DILATE = 0.03
# …но сперва чистится. Пиксельный фильтр Cycles шириной в полпикселя
# (`scene.py`, filter_size = 0.5) размывает контур предмета, и на силуэте
# темпера — номер 5 — соседний с фоном пиксель приходит со средним значением,
# которое округляется ровно в 3, то есть в «зерно». Волосяной обвод вокруг
# темпера после расширения на 3% кадра превращался в запретное пятно шириной
# в треть кадра: на четвёртом акте вето покрывало 100% широких окон, и текст
# оставался мелкой меткой при пустом тёмном фоне. Размыкание убирает всё тоньше
# пяти пикселей; настоящее зерно в рабочем разрешении — пятно 12–30 px.
BEAN_ERODE = 0.004  # в долях ширины кадра
# …и растягивается во времени: уходим с места заранее.
BEAN_LEAD = 4

# Оценка места = его ХУДШЕЕ значение в окне ±LOOKAHEAD кадров, и только потом
# лёгкое сглаживание. Это главная поправка после первого прогона: с обычным
# усреднением зона досиживала на месте до последнего и на кадрах 127–131 ехала
# верхом на освещённом ободке чашки (p95 108 при пороге 80). Минимум по окну
# отнимает у места очки заранее — текст уходит за полшага до того, как станет
# плохо, и приходит на полшага позже, чем стало хорошо. Ровно так же, как
# работает опережающий запрет зёрен ниже.
LOOKAHEAD = 3
FIELD_SIGMA = 1.2

# Провал стоит дороже, чем недобор. Витерби максимизирует сумму по ленте, и без
# этого он охотно платил пятью нечитаемыми кадрами за десяток отличных: сумма
# выигрывала, зритель — нет. Ниже Q_FLOOR оценка дополнительно штрафуется, и
# «пять кадров с текстом на бликующем ободке» перестаёт быть выгодной сделкой.
Q_FLOOR, FAIL_WEIGHT = 0.45, 0.9
# Максимальный сдвиг зоны за кадр, в клетках сетки (клетка = 2% кадра).
# Четыре, а не две: на отъезде камеры кофейное поле съёживается под зоной, и
# уходить оттуда надо через освещённый ободок чашки. При двух клетках переход
# занимал четыре кадра, и все четыре текст ехал верхом на блике. При четырёх —
# два кадра. Быстрее не нужно: цена сдвига всё равно держит зону на месте, пока
# переезд не окупится.
MAX_STEP = 4
# Цена сдвига на клетку и цена смены формы — в единицах той же оценки 0..1.
MOVE_COST, SHAPE_COST = 0.03, 0.08
# Финальное сглаживание прямоугольника. Задача у него ровно одна: сгладить
# ступеньку сетки в 2% кадра. Радиус держим маленьким — при трёх кадрах окно
# усреднения в семь кадров растягивало быстрый уход зоны из чашки в пологий
# съезд, и текст всё равно ехал по бликующему ободку, сколько бы ни разрешал
# ему Витерби. Плавность обеспечивает цена сдвига в поиске, а не это окно.
RECT_SMOOTH = 1
# Насколько кандидат может перекрываться с уже занятой дорожкой. Меряем долю
# МЕНЬШЕГО из двух прямоугольников, а не IoU: метка целиком внутри колонки даёт
# IoU всего 0.24 и на первом прогоне пролезала — три «разных» варианта выходили
# вложенными друг в друга, то есть одним.
OVERLAP_BUSY = 0.12
# «Сюда нельзя». Не −∞ и не −1e9: значения складываются по всей ленте, и в
# float32 гигантское число съело бы точность полезной части оценки. Тысячи
# хватает — за 144 кадра честным путём столько не набрать.
NEG = -1000.0

# Кадры для контактного листа: по два на акт, начало и середина каждого.
SHEET_FRAMES = [6, 22, 40, 56, 72, 88, 108, 130]


# ── Мелкие утилиты ───────────────────────────────────────────────────────────


def hex_luminance(hex_color: str) -> float:
    rgb = np.array([[int(hex_color[i : i + 2], 16) for i in (1, 3, 5)]], dtype=np.uint8)
    return float(relative_luminance(rgb)[0])


def contrast(l1: float, l2: float) -> float:
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def gray_to_luminance(gray: float) -> float:
    """sRGB-серый 0..255 обратно в относительную яркость."""
    s = np.clip(gray, 0, 255) / 255.0
    return float(s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4)


def integral(a: np.ndarray, dtype=np.float64) -> np.ndarray:
    """Интегральное изображение с нулевой рамкой: сумма окна за четыре обращения."""
    out = np.zeros((a.shape[0] + 1, a.shape[1] + 1), dtype=dtype)
    out[1:, 1:] = a.cumsum(0).cumsum(1)
    return out


def box(ii: np.ndarray, y0: np.ndarray, y1: np.ndarray, x0: np.ndarray, x1: np.ndarray) -> np.ndarray:
    """Суммы по решётке окон сразу: y — по строкам результата, x — по столбцам."""
    return (
        ii[np.ix_(y1, x1)] - ii[np.ix_(y0, x1)] - ii[np.ix_(y1, x0)] + ii[np.ix_(y0, x0)]
    )


# ── Кадр → числа ─────────────────────────────────────────────────────────────

NB, BIN = 48, 4  # 48 корзин по 4 единицы серого: хватает на 0..192, дальше «очень светло»


class FrameStats:
    """Всё, что нужно знать о кадре, в виде интегральных изображений.

    Гистограмма тоже интегральная — это и есть трюк, ради которого скользящее
    окно вообще считается за разумное время: p95 в окне = первая корзина, где
    накопленный счёт перевалил 95% площади, а счёт по корзине берётся теми же
    четырьмя обращениями, что и сумма.
    """

    def __init__(self, rgb: np.ndarray, ids: np.ndarray) -> None:
        self.shape = rgb.shape[:2]
        gray = luminance_to_gray(relative_luminance(rgb))
        self.gray = gray

        idx = np.minimum((gray / BIN).astype(np.int32), NB - 1)
        self.hist = np.stack([integral((idx == b).astype(np.float32), np.float32) for b in range(NB)])

        self.s1 = integral(gray)
        self.s2 = integral(gray.astype(np.float64) ** 2)
        self.rgb_ii = np.stack([integral(rgb[..., c].astype(np.float32)) for c in range(3)])

        h, w = self.shape
        thin = max(2, round(BEAN_ERODE * w))
        solid = binary_erosion(ids == BEAN_ID, iterations=thin)
        bean = binary_dilation(solid, iterations=thin + max(1, int(BEAN_DILATE * w)))
        self.bean = integral(bean.astype(np.float32))
        self.obj = {k: integral((ids == k).astype(np.float32)) for k in OBJ if k != BEAN_ID}

    # -- измерения по решётке окон --------------------------------------------

    def percentiles(self, y0, y1, x0, x1, area, qs=(0.05, 0.95)):
        counts = self.hist[:, y1, :][:, :, x1] - self.hist[:, y0, :][:, :, x1]
        counts -= self.hist[:, y1, :][:, :, x0] - self.hist[:, y0, :][:, :, x0]
        cum = counts.cumsum(0)
        out = []
        for q in qs:
            target = q * area
            hit = cum >= target[None, :, :]
            b = np.argmax(hit, axis=0)
            prev = np.take_along_axis(cum, np.maximum(b - 1, 0)[None], 0)[0]
            prev = np.where(b == 0, 0.0, prev)
            here = np.take_along_axis(counts, b[None], 0)[0]
            frac = np.clip((target - prev) / np.maximum(here, 1e-6), 0.0, 1.0)
            out.append((b + frac) * BIN)
        return out

    def measure(self, y0, y1, x0, x1):
        area = (y1 - y0)[:, None] * (x1 - x0)[None, :]
        area = np.broadcast_to(area.astype(np.float64), (len(y0), len(x0))).copy()
        s1 = box(self.s1, y0, y1, x0, x1)
        s2 = box(self.s2, y0, y1, x0, x1)
        mean = s1 / area
        std = np.sqrt(np.maximum(s2 / area - mean**2, 0.0))
        p05, p95 = self.percentiles(y0, y1, x0, x1, area)
        bean = box(self.bean, y0, y1, x0, x1) / area
        rgb = np.stack([box(self.rgb_ii[c], y0, y1, x0, x1) / area for c in range(3)], axis=-1)
        objs = {k: box(v, y0, y1, x0, x1) / area for k, v in self.obj.items()}
        return dict(mean=mean, std=std, p05=p05, p95=p95, bean=bean, rgb=rgb, objs=objs)


def load_frame(film: Path, aux: Path, idx: int, width: int):
    """Кадр и служебная карта в рабочем разрешении.

    Уменьшение до 512 px сдвигает p95 меньше чем на две единицы (проверено на
    кадрах 10/50/85/120 против полного 2400 px) — а считается в двадцать раз
    быстрее. Номера предметов уменьшаются ближайшим соседом: усреднение дало бы
    на границе чашки предмет с номером «полтора».
    """
    fpath = next((film / f"frame-{idx:03d}{e}" for e in (".webp", ".png", ".jpg") if (film / f"frame-{idx:03d}{e}").exists()), None)
    if fpath is None:
        sys.exit(f"нет кадра {idx} в {film}")
    with Image.open(fpath) as im:
        h = round(im.height * width / im.width)
        rgb = np.asarray(im.convert("RGB").resize((width, h), Image.BILINEAR))

    apath = next((aux / f"aux-{idx:03d}{e}" for e in (".webp", ".png") if (aux / f"aux-{idx:03d}{e}").exists()), None)
    if apath is None:
        ids = np.zeros(rgb.shape[:2], dtype=np.uint8)
    else:
        with Image.open(apath) as im:
            g = im.convert("RGB").resize((width, h), Image.NEAREST)
        ids = np.rint(np.asarray(g)[..., 1].astype(np.float32) / OBJ_STEP).astype(np.uint8)
    return rgb, ids


# ── Оценка и выбор ───────────────────────────────────────────────────────────


def quality(p95, std, area_frac, cx, cy, cup=0.0):
    """Оценка окна 0..1. Работает и на числах, и на решётке.

    `area_frac` нормируется на площадь самой крупной формы: блок в 0.11 кадра —
    это «полный размер», и метка в 0.02 честно проигрывает ему пятую часть оценки.
    """
    lum_q = np.clip((LUM_BAD - p95) / (LUM_BAD - LUM_GOOD), 0.0, 1.0)
    std_q = np.clip((STD_BAD - std) / (STD_BAD - STD_GOOD), 0.0, 1.0)
    read = W_LUM * lum_q + W_STD * std_q
    area = AREA_FLOOR + (1.0 - AREA_FLOOR) * np.clip(area_frac / MAX_AREA, 0.0, 1.0)
    # Лёгкое предпочтение середине кадра: строка у самого обреза читается хуже
    # даже на идеальном фоне, а «в начале кадр просторный» значит именно это.
    off = 0.5 * np.abs(cx - 0.5) * 2.0 + 0.5 * np.abs(cy - 0.5) * 2.0
    mid = MID_FLOOR + (1.0 - MID_FLOOR) * np.clip(1.0 - off, 0.0, 1.0)
    return read * area * mid * (1.0 - CUP_PENALTY * np.clip(cup, 0.0, 1.0))


def viterbi(field: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Лучшая непрерывная траектория по всей ленте.

    field  (F, S, GY, GX) — оценка окна формы S с левым верхним углом в клетке.
    valid  (S, GY, GX)    — где окно вообще помещается в безопасное поле кадра.
    Возвращает (F, 3): индексы формы, строки и столбца на каждом кадре.

    Считаем назад по ленте, чтобы вперёд идти уже по готовым «сколько ещё можно
    набрать отсюда». Переход ограничен MAX_STEP клетками и стоит MOVE_COST за
    клетку — из-за этого зона стоит на месте, пока разница не окупит переезд.
    """
    F, S, GY, GX = field.shape
    sc = np.where(valid[None], field, NEG)

    shifts = [
        (dy, dx, MOVE_COST * (abs(dy) + abs(dx)))
        for dy in range(-MAX_STEP, MAX_STEP + 1)
        for dx in range(-MAX_STEP, MAX_STEP + 1)
    ]

    best = np.zeros((F, S, GY, GX), dtype=np.float32)
    best[F - 1] = sc[F - 1]
    for i in range(F - 2, -1, -1):
        nxt = best[i + 1]
        # Лучшее, что достижимо со сдвигом: максимум по окрестности со штрафом.
        reach = np.full((S, GY, GX), NEG, dtype=np.float32)
        for dy, dx, cost in shifts:
            shifted = np.full((S, GY, GX), NEG, dtype=np.float32)
            ys, yd = (slice(max(0, dy), GY + min(0, dy)), slice(max(0, -dy), GY + min(0, -dy)))
            xs, xd = (slice(max(0, dx), GX + min(0, dx)), slice(max(0, -dx), GX + min(0, -dx)))
            shifted[:, yd, xd] = nxt[:, ys, xs]
            np.maximum(reach, shifted - cost, out=reach)
        # Смена формы разрешена, но стоит: иначе блок мигал бы колонкой и баннером.
        across = reach.max(axis=0)[None] - SHAPE_COST
        best[i] = sc[i] + np.maximum(reach, across)

    path = np.zeros((F, 3), dtype=np.int32)
    s, y, x = np.unravel_index(int(np.argmax(best[0])), (S, GY, GX))
    path[0] = (s, y, x)
    for i in range(1, F):
        cand, cand_val = None, -np.inf
        for ds in range(S):
            extra = 0.0 if ds == s else SHAPE_COST
            for dy in range(-MAX_STEP, MAX_STEP + 1):
                for dx in range(-MAX_STEP, MAX_STEP + 1):
                    ny, nx = y + dy, x + dx
                    if not (0 <= ny < GY and 0 <= nx < GX) or not valid[ds, ny, nx]:
                        continue
                    v = best[i][ds, ny, nx] - MOVE_COST * (abs(dy) + abs(dx)) - extra
                    if v > cand_val:
                        cand_val, cand = v, (ds, ny, nx)
        if cand is None:
            cand = (s, y, x)
        s, y, x = cand
        path[i] = cand
    return path


def smooth_rects(rects: np.ndarray, radius: int) -> np.ndarray:
    """Скользящее среднее по ленте: снимает ступеньку сетки, не двигая маршрут."""
    if radius < 1:
        return rects
    k = np.ones(radius * 2 + 1, dtype=np.float64)
    k /= k.sum()
    out = np.empty_like(rects)
    for c in range(rects.shape[1]):
        padded = np.pad(rects[:, c], radius, mode="edge")
        out[:, c] = np.convolve(padded, k, mode="valid")
    return out


# ── Итоговое измерение и цвет ────────────────────────────────────────────────


def describe(st: FrameStats, rect: np.ndarray) -> dict:
    """Честные числа по финальному прямоугольнику — уже после сглаживания."""
    h, w = st.shape
    x, y, rw, rh = rect
    x0, y0 = int(round(x * w)), int(round(y * h))
    x1, y1 = int(round((x + rw) * w)), int(round((y + rh) * h))
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(w, max(x1, x0 + 2)), min(h, max(y1, y0 + 2))

    m = st.measure(np.array([y0]), np.array([y1]), np.array([x0]), np.array([x1]))
    p95, p05, std = float(m["p95"][0, 0]), float(m["p05"][0, 0]), float(m["std"][0, 0])
    rgb = m["rgb"][0, 0]
    on = sorted(OBJ[k] for k, v in m["objs"].items() if float(v[0, 0]) > 0.12)
    coffee = float(m["objs"][2][0, 0]) if 2 in m["objs"] else 0.0

    # Худший случай у каждого цвета свой: светлому мешает самый светлый пиксель,
    # тёмному — самый тёмный. Среднее здесь соврало бы в обе стороны сразу.
    c_light = contrast(hex_luminance(FG_LIGHT), gray_to_luminance(p95))
    c_dark = contrast(gray_to_luminance(p05), hex_luminance(FG_DARK))

    if c_light >= AA_CONTRAST and not (coffee > 0.55 and c_dark > c_light):
        color = FG_LIGHT
    elif c_dark >= AA_CONTRAST:
        color = FG_DARK
    else:
        color = FG_LIGHT if c_light >= c_dark else FG_DARK

    # Скрим нужен не только когда текст проваливается (< 4.5:1), но и когда
    # заголовку не хватает его 7:1 из §6.4 — то есть уже с p95 выше 75. И
    # отдельно — когда фон пёстрый: там строку режет граница, а не яркость.
    picked = c_light if color == FG_LIGHT else c_dark
    scrim = bool(picked < AA_CONTRAST or std > STD_SCRIM or (color == FG_LIGHT and p95 > T_DISPLAY))
    # Оценка считается по финальному прямоугольнику, а не по клетке сетки:
    # после сглаживания зона стоит не там, где её нашли, и число должно
    # описывать то, что реально отдаётся фронту.
    q = float(quality(p95, std, rw * rh, x + rw / 2, y + rh / 2, float(m["objs"][1][0, 0])))
    return dict(
        q=q, p95=p95, p05=p05, std=std,
        bg="#%02x%02x%02x" % tuple(int(round(v)) for v in np.clip(rgb, 0, 255)),
        color=color, c_light=c_light, c_dark=c_dark, scrim=scrim, on=on,
        bean=float(m["bean"][0, 0]),
    )


# ── Контактный лист ──────────────────────────────────────────────────────────


def contact_sheet(film: Path, frames: list[int], tracks: list[list[dict]], out: Path, cols: int = 2) -> None:
    """Проверка глазами: зоны рамками поверх настоящих кадров.

    Числа могут быть безупречны, а место — бессмысленным, и увидеть это можно
    только так. Первая дорожка рисуется цветом рекомендованного текста, вторая
    и третья — медным и приглушённым.
    """
    tile_w = 720
    pal = [None, (200, 112, 58), (147, 137, 124)]
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 17)
        small = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 15)
    except OSError:
        font = small = ImageFont.load_default()

    tiles = []
    for idx in frames:
        path = next(film / f"frame-{idx:03d}{e}" for e in (".webp", ".png", ".jpg") if (film / f"frame-{idx:03d}{e}").exists())
        with Image.open(path) as im:
            tile = im.convert("RGB").resize((tile_w, round(im.height * tile_w / im.width)), Image.LANCZOS)
        d = ImageDraw.Draw(tile)
        w, h = tile.size
        for t, track in enumerate(reversed(tracks)):
            t = len(tracks) - 1 - t  # рисуем от третьей к первой: главная сверху
            z = track[idx]
            col = tuple(int(z["c"][i : i + 2], 16) for i in (1, 3, 5)) if t == 0 else pal[t]
            x, y, rw, rh = z["r"]
            box_px = [x * w, y * h, (x + rw) * w, (y + rh) * h]
            d.rectangle(box_px, outline=col, width=3 if t == 0 else 2)
            tag = f"{t + 1} q{z['q']:.2f} p95 {z['p95']:.0f} σ{z['sd']:.0f}"
            if z["c"] == FG_DARK:
                tag += " тёмный"
            if z["s"]:
                tag += " +скрим"
            if z["on"]:
                tag += " на " + ",".join(z["on"])
            # Подпись внутри рамки, у её верхней кромки: снаружи подписи трёх
            # дорожек наезжали друг на друга и первый лист было не прочесть.
            tw_ = d.textlength(tag, font=small)
            tx = min(box_px[0] + 3, w - tw_ - 6)
            ty = min(box_px[1] + 3, h - 22)
            d.rectangle([tx - 2, ty - 1, tx + tw_ + 3, ty + 18], fill=(10, 9, 8))
            d.text((tx, ty), tag, fill=col, font=small)
        act = next(n for n, lo, hi in ACTS if lo <= idx <= hi)
        d.rectangle([0, h - 30, 300, h], fill=(10, 9, 8))
        d.text((8, h - 25), f"кадр {idx:3d}   {act}", fill=(236, 230, 220), font=font)
        tiles.append(tile)

    tw, th = tiles[0].size
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw + (cols + 1) * 8, rows * th + (rows + 1) * 8), (24, 20, 17))
    for i, tile in enumerate(tiles):
        r, c = divmod(i, cols)
        sheet.paste(tile, (8 + c * (tw + 8), 8 + r * (th + 8)))
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print(f"\nКонтактный лист: {out}  ({sheet.size[0]}×{sheet.size[1]})")


# ── Главное ──────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--film", default="public/film-xl")
    ap.add_argument("--aux", default="public/film-aux")
    ap.add_argument("--out", default="src/film/zones.json")
    ap.add_argument("--width", type=int, default=512, help="рабочее разрешение кадра")
    ap.add_argument("--tracks", type=int, default=3, help="сколько дорожек искать")
    ap.add_argument("--sheet", default="D:/tmp/cafe-refs/zones-check.png")
    ap.add_argument("--sheet-frames", help="через запятую: какие кадры класть на лист")
    args = ap.parse_args()

    film = Path(args.film) if Path(args.film).is_absolute() else ROOT / args.film
    aux = Path(args.aux) if Path(args.aux).is_absolute() else ROOT / args.aux
    total = len(sorted(film.glob("frame-*.*")))
    if not total:
        sys.exit(f"нет кадров в {film}")

    print(f"Плёнка: {film} · кадров {total} · рабочее разрешение {args.width} px")
    print(f"Служебные карты: {aux}{'' if aux.exists() else '  ⚠ нет — зёрна не будут исключены'}\n")

    # ── сетка положений ──────────────────────────────────────────────────────
    rgb0, ids0 = load_frame(film, aux, 0, args.width)
    H, W = rgb0.shape[:2]
    stride = max(4, int(round(STRIDE * W)))
    mx, my = int(round(SAFE * W)), int(round(SAFE * H))
    min_w = int(min(s[0] for s in SHAPES.values()) * W)
    min_h = int(min(s[1] for s in SHAPES.values()) * H)
    gx = np.arange(mx, W - mx - min_w + 1, stride)
    gy = np.arange(my, H - my - min_h + 1, stride)
    GX, GY, S = len(gx), len(gy), len(SHAPES)
    names = list(SHAPES)
    print(f"Сетка положений {GY}×{GX} (шаг {stride} px = {stride / W:.1%} кадра), форм {S}")

    win = [(int(SHAPES[n][0] * W), int(SHAPES[n][1] * H)) for n in names]
    valid = np.zeros((S, GY, GX), dtype=bool)
    for s, (ww, wh) in enumerate(win):
        valid[s] = ((gy[:, None] + wh) <= H - my) & ((gx[None, :] + ww) <= W - mx)

    # ── поле оценок по всей ленте ────────────────────────────────────────────
    field = np.zeros((total, S, GY, GX), dtype=np.float32)
    veto = np.zeros((total, S, GY, GX), dtype=bool)
    cache: list[tuple[np.ndarray, np.ndarray]] = []

    for i in range(total):
        rgb, ids = load_frame(film, aux, i, args.width)
        cache.append((rgb, ids))
        st = FrameStats(rgb, ids)
        for s, (ww, wh) in enumerate(win):
            y1 = np.minimum(gy + wh, H)
            x1 = np.minimum(gx + ww, W)
            m = st.measure(gy, y1, gx, x1)
            cy = ((gy + wh / 2) / H)[:, None]
            cx = ((gx + ww / 2) / W)[None, :]
            field[i, s] = quality(m["p95"], m["std"], (ww / W) * (wh / H), cx, cy, m["objs"][1])
            veto[i, s] = m["bean"] > BEAN_TOLERANCE
        if i % 24 == 0:
            print(f"  кадр {i:3d}/{total - 1}")

    print("\nСглаживание поля по ленте и расширение запрета зёрен во времени…")
    field = minimum_filter1d(field, LOOKAHEAD * 2 + 1, axis=0, mode="nearest")
    field = gaussian_filter1d(field, FIELD_SIGMA, axis=0, mode="nearest")
    # Штраф идёт только в поиск. В отчёт попадает честная оценка: её `describe()`
    # считает заново по финальному прямоугольнику.
    field -= FAIL_WEIGHT * np.clip(Q_FLOOR - field, 0.0, None) / Q_FLOOR
    veto = maximum_filter1d(veto, BEAN_LEAD * 2 + 1, axis=0, mode="nearest")
    field = np.where(veto, NEG, field)

    # ── геометрия дорожек ────────────────────────────────────────────────────
    # Сперва только маршруты: они считаются по полю оценок и кадров уже не
    # требуют. Измерения — отдельным проходом ниже, иначе пришлось бы держать
    # в памяти интегральные гистограммы всех 144 кадров разом.
    geom: list[np.ndarray] = []
    paths: list[np.ndarray] = []
    work = field.copy()

    for t in range(args.tracks):
        path = viterbi(work, valid)
        raw = np.array(
            [[gx[p[2]] / W, gy[p[1]] / H, win[p[0]][0] / W, win[p[0]][1] / H] for p in path]
        )
        rects = smooth_rects(raw, RECT_SMOOTH)
        # После сглаживания прямоугольник мог выехать за безопасное поле.
        rects[:, 0] = np.clip(rects[:, 0], SAFE, 1 - SAFE - rects[:, 2])
        rects[:, 1] = np.clip(rects[:, 1], SAFE, 1 - SAFE - rects[:, 3])
        geom.append(rects)
        paths.append(path)

        # Занятое место гасим — следующая дорожка ищет вторую точку, а не ту же.
        for i in range(total):
            x, y, rw, rh = rects[i]
            for s, (ww, wh) in enumerate(win):
                bw, bh = ww / W, wh / H
                ix = np.maximum(0.0, np.minimum(x + rw, gx[None, :] / W + bw) - np.maximum(x, gx[None, :] / W))
                iy = np.maximum(0.0, np.minimum(y + rh, gy[:, None] / H + bh) - np.maximum(y, gy[:, None] / H))
                inter = ix * iy
                over = inter / min(rw * rh, bw * bh)
                work[i, s] = np.where(over > OVERLAP_BUSY, NEG, work[i, s])

    # ── измерение финальных прямоугольников ──────────────────────────────────
    print("Измерение финальных прямоугольников (числа — по ним, а не по сетке)…")
    tracks: list[list[dict]] = [[] for _ in geom]
    for i in range(total):
        st = FrameStats(*cache[i])
        for t, rects in enumerate(geom):
            d = describe(st, rects[i])
            tracks[t].append(
                dict(
                    r=[round(float(v), 4) for v in rects[i]],
                    c=d["color"], s=int(d["scrim"]), q=round(d["q"], 3),
                    p95=round(d["p95"], 1), p05=round(d["p05"], 1), sd=round(d["std"], 1),
                    bg=d["bg"], cl=round(d["c_light"], 2), cd=round(d["c_dark"], 2),
                    on=d["on"], shape=names[int(paths[t][i][0])],
                )
            )
        del st

    for t, track in enumerate(tracks):
        print(f"  дорожка {t + 1}: средняя оценка {np.mean([z['q'] for z in track]):.2f}")

    # ── запись ───────────────────────────────────────────────────────────────
    out = Path(args.out) if Path(args.out).is_absolute() else ROOT / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    ids_ = ["primary", "second", "third", "fourth"]
    doc = {
        "meta": {
            "frames": total,
            "film": args.film,
            "generated": date.today().isoformat(),
            "acts": [{"name": n, "from": lo, "to": hi} for n, lo, hi in ACTS],
            "shapes": {k: [round(v[0], 3), round(v[1], 3)] for k, v in SHAPES.items()},
            "colors": {"light": FG_LIGHT, "dark": FG_DARK},
            "thresholds": {"display": T_DISPLAY, "body": T_BODY, "label": T_LABEL, "aa": AA_CONTRAST, "std_scrim": STD_SCRIM},
            "note": "r=[x,y,w,h] в долях кадра, c=цвет текста, s=нужен скрим, q=оценка 0..1. "
                    "Прогресс 0..1 → i=p*(frames-1), r интерполируется линейно между соседями.",
        },
        "tracks": [{"id": ids_[t], "rank": t, "frames": tracks[t]} for t in range(len(tracks))],
    }
    out.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"\n{out.relative_to(ROOT)} — {out.stat().st_size // 1024} КБ")

    # ── сводка по актам ──────────────────────────────────────────────────────
    print("\nПервая дорожка по актам (x,y — центр зоны в долях кадра):")
    print(f"  {'акт':16} {'x':>5} {'y':>5} {'w':>5} {'h':>5} {'q':>5} {'p95':>5} {'σ':>5}  скрим  цвет")
    for name, lo, hi in ACTS:
        seg = tracks[0][lo : hi + 1]
        if not seg:
            continue
        arr = np.array([z["r"] for z in seg])
        cx, cy = (arr[:, 0] + arr[:, 2] / 2).mean(), (arr[:, 1] + arr[:, 3] / 2).mean()
        scr = sum(z["s"] for z in seg)
        dark = sum(1 for z in seg if z["c"] == FG_DARK)
        print(
            f"  {name:16} {cx:5.2f} {cy:5.2f} {arr[:, 2].mean():5.2f} {arr[:, 3].mean():5.2f} "
            f"{np.mean([z['q'] for z in seg]):5.2f} {np.mean([z['p95'] for z in seg]):5.0f} "
            f"{np.mean([z['sd'] for z in seg]):5.0f}  {scr:3d}/{len(seg):<3d} "
            f"{'тёмный ' + str(dark) if dark else 'светлый'}"
        )

    weak = [(i, z) for i, z in enumerate(tracks[0]) if z["q"] < 0.45]
    if weak:
        span = ", ".join(f"{i}({z['q']:.2f}/p95 {z['p95']:.0f})" for i, z in weak[:12])
        print(f"\n⚠ Слабых кадров у первой дорожки: {len(weak)} — {span}")
    bad = [i for i, z in enumerate(tracks[0]) if z["p95"] > T_BODY and not z["s"]]
    if bad:
        print(f"⚠ p95 > {T_BODY} без скрима, кадры: {bad}")

    if args.sheet:
        want = [int(v) for v in args.sheet_frames.split(",")] if args.sheet_frames else SHEET_FRAMES
        picks = [i for i in want if i < total] or [0]
        contact_sheet(film, picks, tracks, Path(args.sheet))

    return 0


if __name__ == "__main__":
    sys.exit(main())
