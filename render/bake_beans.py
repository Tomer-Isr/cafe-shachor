# -*- coding: utf-8 -*-
"""Разовая симуляция: рассыпать зерно по стойке физикой и запечь результат.

  blender -b -P render/bake_beans.py -- --count 26 --out render/assets/beans.json

Физика отвечает здесь только за одно: как горсть ЛЕЖИТ. Позы покоя ложатся в
JSON, а полёт зерна сцена анимирует сама — так тайминг сыпания подчиняется
прокрутке, а не кадровой частоте симулятора.

Гонять солвер на каждом кадре нельзя в любом случае: сцена собирается заново,
и рассыпка гуляла бы от кадра к кадру.
"""
import bpy, json, math, os, random, sys

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


COUNT = int(arg("--count", "26"))
OUT = arg("--out", "render/assets/beans.json")
CX, CY = float(arg("--cx", "0.105")), float(arg("--cy", "-0.028"))
SEED = int(arg("--seed", "7"))
FRAMES = int(arg("--frames", "200"))

rnd = random.Random(SEED)

# Высота ожидания — заведомо выше того, что попадает в кадр общего плана,
# и шаг выпуска: 26 зёрен по одному каждые 8 кадров дают струйку на 200 кадров.
# Очередь целиком выше кадра. При 0.055 нижние зёрна висели прямо в объективе
# и было видно, как они ждут своей очереди — зерно будто заморожено в воздухе.
# Камера в самом широком блоке видит примерно до 0.20 м, поэтому берём 0.45.
HOLD_Z = 0.45
RELEASE_EVERY = int(arg("--release-every", "8"))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_start, scene.frame_end = 1, FRAMES

# ── стойка ───────────────────────────────────────────────────────────────────
# Пол — не плоскость, а брусок: тонкий коллайдер мелкое быстрое тело пробивает
# насквозь (одно зерно улетело на 140 метров вниз), толстый — нет.
bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, -1.0))
floor = bpy.context.object
bpy.ops.rigidbody.object_add(type="PASSIVE")
floor.rigid_body.friction = 0.85
floor.rigid_body.restitution = 0.03

# Невидимый бортик: без него зёрна разъезжаются по всей плоскости и кучки не
# получается — на стойке их ссыпают из совка, а не раскатывают.
# end_fill_type='NOTHING' обязателен: у цилиндра с крышками зерно ложится на
# верхнюю грань и зависает в воздухе вместо того, чтобы упасть внутрь.
bpy.ops.mesh.primitive_cylinder_add(
    vertices=48, radius=0.062, depth=0.42,
    location=(CX, CY, 0.21), end_fill_type="NOTHING",
)
ring = bpy.context.object
ring.name = "Corral"
mod = ring.modifiers.new("shell", "SOLIDIFY")
mod.thickness = 0.004
bpy.ops.rigidbody.object_add(type="PASSIVE")
ring.rigid_body.collision_shape = "MESH"
ring.rigid_body.friction = 0.5

# ── зерно ────────────────────────────────────────────────────────────────────
# Для физики важен только габарит и выпуклая оболочка: 10.4 × 7.2 × 6 мм.
beans = []
for i in range(COUNT):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=14, ring_count=8, radius=1.0)
    b = bpy.context.object
    b.name = f"BakeBean{i:02d}"
    b.scale = (0.0052, 0.0036, 0.0030)
    bpy.ops.object.transform_apply(scale=True)

    # Ждут высоко над кадром и падают по очереди. Если отпустить все разом,
    # физика укладывает горсть за полсекунды: на плёнке падения просто не
    # видно, зерно уже лежит на первом же экране.
    ang = rnd.uniform(0, math.tau)
    rad = 0.019 * math.sqrt(rnd.random())
    # Очередь стоит строго столбиком и срывается снизу вверх: каждое следующее
    # зерно летит по коридору, который только что освободило предыдущее, и ни
    # во что не врезается. Разброс по горизонтали минимальный — иначе зерно
    # цепляет соседа по очереди, и его отбрасывает в сторону.
    # Рука не стоит на месте: точка сброса ведётся по дуге, поэтому зерно
    # ложится вытянутой россыпью с отбившимися штуками по краям, а не ровной
    # кучкой в одной точке — аккуратная горка сразу выдаёт расстановку.
    sway = i / max(1, COUNT - 1)
    dx = math.sin(sway * 2.4 - 0.6) * 0.028 + math.cos(ang) * 0.006
    dy = math.cos(sway * 1.7) * 0.017 + math.sin(ang) * 0.005
    b.location = (CX + dx, CY + dy, HOLD_Z + i * 0.012)
    b.rotation_euler = (rnd.uniform(0, math.tau), rnd.uniform(0, math.tau), rnd.uniform(0, math.tau))
    # куда зерно должно приземлиться — лёгкий разлёт задаём начальной скоростью
    b.delta_location = (0.0, 0.0, 0.0)

    bpy.ops.rigidbody.object_add(type="ACTIVE")
    rb = b.rigid_body

    rb.collision_shape = "CONVEX_HULL"
    rb.mass = 0.00018          # зерно весит примерно 0.18 г
    rb.friction = 0.95         # сухое зерно почти не скользит
    rb.restitution = 0.02      # и почти не прыгает
    rb.linear_damping = 0.72
    rb.angular_damping = 0.85
    rb.collision_margin = 0.0002

    # до своей очереди зерно заморожено; коридор под ним к этому моменту пуст
    release = 1 + i * RELEASE_EVERY
    rb.kinematic = True
    b.keyframe_insert(data_path="rigid_body.kinematic", frame=1)
    b.keyframe_insert(data_path="rigid_body.kinematic", frame=release - 1)
    rb.kinematic = False
    b.keyframe_insert(data_path="rigid_body.kinematic", frame=release)
    beans.append(b)

# точность контактов: на объектах такого размера дефолт пропускает столкновения
# Замедленная гравитация вместо земной. С 9.81 зерно бьётся о камень на 2.8 м/с
# и раскатывается по всей площадке; поджимать его тесным бортиком нельзя —
# солвер начинает выдавливать зёрна сквозь пол. Мягкое падение решает и то,
# и другое, а на плёнке читается замедленной съёмкой, что здесь только к месту.
# Гравитация сильно ниже земной: зерно опускается медленно, поток растягивается
# на всю первую треть плёнки и читается замедленной съёмкой.
scene.gravity = (0.0, 0.0, -9.81)
# Кэш физики по умолчанию обрывается на 250-м кадре, и симуляция дальше просто
# не считается — зёрна застывают в воздухе там, где их застал предел. Ловилось
# это как «зерно не долетает» и уводило в сторону на несколько заходов.
scene.rigidbody_world.point_cache.frame_start = 1
scene.rigidbody_world.point_cache.frame_end = FRAMES
scene.rigidbody_world.substeps_per_frame = 24
scene.rigidbody_world.solver_iterations = 30

# ── прогон ───────────────────────────────────────────────────────────────────
# Пишем каждый кадр: плёнка проигрывает историю кадр в кадр, поэтому темп
# сыпания должен совпадать с темпом симуляции, иначе зерно летит ускоренно.
STEP = 1
history = []
for f in range(1, FRAMES + 1):
    scene.frame_set(f)
    if f % STEP and f != FRAMES:
        continue
    dg = bpy.context.evaluated_depsgraph_get()
    frame = []
    for b in beans:
        m = b.evaluated_get(dg).matrix_world
        loc = m.translation
        rot = m.to_euler("XYZ")
        frame.append({"loc": [loc.x, loc.y, loc.z], "rot": [rot.x, rot.y, rot.z]})
    history.append(frame)

# Отбраковка. Солвер изредка выбрасывает одно зерно из партии — оно уходит на
# километры вниз или зависает в воздухе. Ловить это подбором параметров дороже,
# чем просто выкинуть сбойные: в кадре разница между 26 и 24 зёрнами незаметна,
# а зерно, летящее сквозь стол, заметно сразу.
def sane(pose):
    x, y, z = pose["loc"]
    return 0.001 < z < 0.030 and abs(x - CX) < 0.13 and abs(y - CY) < 0.13


# Хвост, где уже ничего не двигается, плёнке не нужен: он съедал бы прокрутку
# на неподвижную картинку.
def moved(f1, f2):
    return max(abs(a["loc"][k] - b["loc"][k]) for a, b in zip(f1, f2) for k in range(3))


settle = len(history) - 1
# Порог не может быть микроскопическим: улёгшееся зерно продолжает дрожать
# на сотых долях миллиметра, и хвост «движения» тянулся вдвое дольше самой
# укладки, растягивая сыпание на плёнке.
while settle > 2 and moved(history[settle - 1], history[settle]) < 3e-4:
    settle -= 1
history = history[: settle + 1]
print(f"[bake] движение закончилось на шаге {settle} из {len(history) - 1}")

keep = [i for i, pose in enumerate(history[-1]) if sane(pose)]
dropped = COUNT - len(keep)
if dropped:
    print(f"[bake] отбраковано зёрен: {dropped}")
    history = [[frame[i] for i in keep] for frame in history]
COUNT = len(keep)

# Файл пишется последним — после обрезки хвоста и отбраковки, иначе на диск
# уходит сырая история, а все проверки остаются только в консоли.
data = {"count": COUNT, "rest": history[-1], "frames": history}
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=1)

last = history[-1]
zs = [d["loc"][2] for d in last]
print(f"[bake] {COUNT} зёрен, {len(history)} шагов; в покое высота "
      f"{min(zs)*1000:.1f}–{max(zs)*1000:.1f} мм → {OUT}")
