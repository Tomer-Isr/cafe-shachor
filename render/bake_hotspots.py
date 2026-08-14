# -*- coding: utf-8 -*-
"""Экранные координаты объектов для каждого кадра плёнки.

  python render/bake_hotspots.py --frames 144 --out public/hotspots.json

Зачем. Плёнка — пререндер, живых 3D-объектов в браузере нет, и «навести мышь
на чашку» вроде бы не на что. Но камера движется по известному маршруту, а
предметы стоят в известных местах, поэтому проекцию можно посчитать заранее:
для каждого кадра — где на экране оказалась чашка, где россыпь, где питчер.

Дальше страница знает, что под курсором, и может отвечать: над чашкой поднять
пар, зерно подсветить. Blender для этого не нужен — только та же математика
камеры, что и в scene.py, откуда маршрут и берётся.
"""
import io, json, math, os, re, sys

argv = sys.argv[1:]


def arg(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


FRAMES = int(arg("--frames", "144"))
OUT = arg("--out", "public/hotspots.json")
RX, RY = float(arg("--rx", "1100")), float(arg("--ry", "620"))
SENSOR = 36.0

HERE = os.path.dirname(os.path.abspath(__file__))

# Голова scene.py: маршрут камеры и пересчёт прокрутки. Дублировать эти формулы
# нельзя — разъедутся при первой же правке ракурса.
src = io.open(os.path.join(HERE, "scene.py"), encoding="utf-8").read()
head = src[: src.index("# ── чистая сцена")]
head = head.replace("import bpy, bmesh, sys, math, os", "import sys, math, os")
head = head.replace("from mathutils import Vector", "")
head = re.sub(r"^argv = .*$", "argv = []", head, flags=re.M)
ns = {}
exec(compile(head, "scene-head", "exec"), ns)
route_at_scroll, at = ns["route_at_scroll"], ns["_at"]

# Что умеет отзываться на курсор. Радиус — в метрах, примерный размер объекта:
# по нему считается величина зоны на экране.
POINTS = [
    {"id": "cup", "pos": (0.0, 0.0, 0.040), "radius": 0.050},
    {"id": "beans", "pos": (0.105, -0.028, 0.006), "radius": 0.055},
    {"id": "pitcher", "pos": (0.255, 0.240, 0.041), "radius": 0.040},
    {"id": "tamper", "pos": (0.158, 0.148, 0.030), "radius": 0.032},
]


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def norm(a):
    L = math.sqrt(dot(a, a)) or 1.0
    return (a[0] / L, a[1] / L, a[2] / L)


def project(point, cam, look, lens, shift_x):
    """Точка мира → экранные координаты 0..1. z<=0 значит «за спиной камеры»."""
    fwd = norm(sub(look, cam))
    right = norm(cross(fwd, (0.0, 0.0, 1.0)))
    up = cross(right, fwd)

    d = sub(point, cam)
    z = dot(d, fwd)
    if z <= 1e-5:
        return None
    x = dot(d, right) / z
    y = dot(d, up) / z

    aspect = RX / RY
    # Blender подгоняет сенсор по большей стороне кадра
    sw = SENSOR if aspect >= 1 else SENSOR * aspect
    sh = SENSOR / aspect if aspect >= 1 else SENSOR

    # Сдвиг объектива двигает КАДР, а значит объекты уезжают в противоположную
    # сторону — знак здесь минус. С плюсом зоны уходили ровно на два сдвига.
    ndc_x = x * lens / (sw / 2) - 2.0 * shift_x
    ndc_y = y * lens / (sh / 2)
    return (ndc_x * 0.5 + 0.5, ndc_y * 0.5 + 0.5, z)


data = []
for i in range(FRAMES):
    scroll = i / (FRAMES - 1)
    cam, look, lens, _fstop, shift = at(route_at_scroll(scroll))
    frame = {}
    for spec in POINTS:
        p = project(spec["pos"], cam, look, lens, shift)
        if not p:
            continue
        u, v, dist = p
        # видимый радиус: проекция бокового смещения на радиус объекта
        edge = project((spec["pos"][0] + spec["radius"], spec["pos"][1], spec["pos"][2]),
                       cam, look, lens, shift)
        r = abs(edge[0] - u) if edge else 0.05
        r = max(0.035, min(0.42, r))
        frame[spec["id"]] = [round(u, 4), round(v, 4), round(r, 4)]
    data.append(frame)

out_path = os.path.join(os.path.dirname(HERE), OUT) if not os.path.isabs(OUT) else OUT
os.makedirs(os.path.dirname(out_path), exist_ok=True)
with open(out_path, "w", encoding="utf-8") as fh:
    json.dump({"frames": FRAMES, "points": [p["id"] for p in POINTS], "data": data}, fh)

mid = data[len(data) // 2]
print(f"[hotspots] {FRAMES} kadrov -> {out_path}")
print("[hotspots] seredina: " + ", ".join(f"{k}=({v[0]:.2f},{v[1]:.2f} r{v[2]:.2f})" for k, v in mid.items()))
