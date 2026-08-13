# -*- coding: utf-8 -*-
"""Разовая симуляция: рассыпать зерно по стойке физикой и запечь результат.

  blender -b -P render/bake_beans.py -- --count 26 --out render/assets/beans.json

Зачем отдельный скрипт. Раньше зёрна расставлялись случайными числами: высота
у всех одна, повороты произвольные — часть висела в воздухе, часть тонула в
камне, «стопки» стояли так, как настоящее зерно стоять не может. Физика решает
это сама, но гонять её на каждом кадре нельзя: сцена собирается заново, и
рассыпка гуляла бы от кадра к кадру, а плёнке нужна неподвижная россыпь.

Поэтому симуляция прогоняется один раз, а её итог — положение и поворот каждого
зерна — ложится в JSON, который scene.py просто читает.
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

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_start, scene.frame_end = 1, FRAMES

# ── стойка ───────────────────────────────────────────────────────────────────
bpy.ops.mesh.primitive_plane_add(size=2, location=(0, 0, 0))
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

    # сыплем узкой струйкой с небольшой высоты — так ложится настоящая горсть
    ang = rnd.uniform(0, math.tau)
    rad = 0.019 * math.sqrt(rnd.random())
    b.location = (CX + math.cos(ang) * rad, CY + math.sin(ang) * rad * 0.8, 0.016 + i * 0.010)
    b.rotation_euler = (rnd.uniform(0, math.tau), rnd.uniform(0, math.tau), rnd.uniform(0, math.tau))

    bpy.ops.rigidbody.object_add(type="ACTIVE")
    rb = b.rigid_body
    rb.collision_shape = "CONVEX_HULL"
    rb.mass = 0.00018          # зерно весит примерно 0.18 г
    rb.friction = 0.95         # сухое зерно почти не скользит
    rb.restitution = 0.02      # и почти не прыгает
    rb.linear_damping = 0.45
    rb.angular_damping = 0.75
    rb.collision_margin = 0.0002
    beans.append(b)

# точность контактов: на объектах такого размера дефолт пропускает столкновения
scene.rigidbody_world.substeps_per_frame = 12
scene.rigidbody_world.solver_iterations = 20

# ── прогон ───────────────────────────────────────────────────────────────────
for f in range(1, FRAMES + 1):
    scene.frame_set(f)

dg = bpy.context.evaluated_depsgraph_get()
data = []
for b in beans:
    m = b.evaluated_get(dg).matrix_world
    loc = m.translation
    rot = m.to_euler("XYZ")
    data.append({"loc": [loc.x, loc.y, loc.z], "rot": [rot.x, rot.y, rot.z]})

os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=1)

zs = [d["loc"][2] for d in data]
print(f"[bake] {len(data)} зёрен, высота от {min(zs)*1000:.1f} до {max(zs)*1000:.1f} мм → {OUT}")
