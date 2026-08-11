# -*- coding: utf-8 -*-
"""
Сцена кафе Shachor для Cycles. Запуск:

  blender -b -P render/scene.py -- --phase 0.5 --out D:/tmp/cafe-render/test.png --samples 96

Почему пререндер, а не реальное время: в браузере мы третий заход собираем
фотореализм из примитивов и шейдерных хаков — отражение в кофе, мягкая тень,
распад струи на капли там принципиально «имитируются». Cycles считает это
физически, поэтому картинка получается сразу, а не подгонкой чисел.

Фаза 0..1 — та же хореография, что была на прокрутке:
  0.00–0.20  общий план, пустая чашка
  0.20–0.44  сближение
  0.44–0.74  налив сверху
  0.74–1.00  взгляд внутрь
"""
import bpy, bmesh, sys, math, os
from mathutils import Vector

# ── аргументы ────────────────────────────────────────────────────────────────
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


PHASE = float(arg("--phase", "0.5"))
OUT = arg("--out", "D:/tmp/cafe-render/frame.png")
SAMPLES = int(arg("--samples", "96"))
RES_X = int(arg("--rx", "1600"))
RES_Y = int(arg("--ry", "900"))
HDRI = arg("--hdri", "D:/Claude/projects/cafe-shachor/public/hdri/vault_1k.hdr")
DEVICE = arg("--device", "auto")  # auto | cpu | optix | cuda

clamp = lambda v, a, b: max(a, min(b, v))
lerp = lambda a, b, t: a + (b - a) * t


def smoothstep(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# фазы хореографии
APPROACH = smoothstep(0.16, 0.44, PHASE)
POUR = clamp((PHASE - 0.26) / 0.42, 0.0, 1.0)
TOP = smoothstep(0.74, 1.0, PHASE)
FILL = smoothstep(0.0, 1.0, POUR)
FLOW = min(clamp(POUR / 0.12, 0, 1), clamp((1 - POUR) / 0.16, 0, 1))

# ── чистая сцена ─────────────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ── геометрия чашки ──────────────────────────────────────────────────────────
# Профиль в метрах: чашка эспрессо-капучино, высота 7.4 см, диаметр 8.6 см.
# Реальные размеры важны: свет, глубина резкости и шум Cycles считаются
# физически, и посуда «неправильного» размера читается игрушкой.
CUP_PROFILE = [
    (0.000, 0.000),
    (0.021, 0.000),   # ножка
    (0.024, 0.002),
    (0.026, 0.006),
    (0.029, 0.014),   # здесь обрывается глазурь
    (0.033, 0.028),
    (0.037, 0.046),
    (0.040, 0.062),
    (0.0425, 0.072),
    (0.043, 0.0740),  # кромка
    (0.0415, 0.0742),
    (0.0405, 0.070),
    (0.038, 0.056),
    (0.034, 0.036),
    (0.029, 0.018),
    (0.024, 0.008),
    (0.000, 0.007),   # дно изнутри
]

SAUCER_PROFILE = [
    (0.000, 0.000),
    (0.030, 0.000),
    (0.032, 0.0015),
    (0.038, 0.004),
    (0.055, 0.0075),
    (0.066, 0.011),
    (0.068, 0.0125),
    (0.0672, 0.0135),
    (0.064, 0.0125),
    (0.052, 0.009),
    (0.036, 0.0055),
    (0.030, 0.004),
    (0.000, 0.0035),
]


def lathe(profile, name, segments=192, wobble=0.0):
    """Тело вращения из профиля. wobble — лёгкая некруглость ручной керамики."""
    me = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    verts = []
    for i in range(segments):
        a = (i / segments) * math.tau
        ring = []
        for (r, z) in profile:
            rr = r
            if wobble and r > 1e-5:
                rr = r * (1 + wobble * (math.sin(a * 3 + 0.7) * 0.6 + math.sin(a * 5 - 1.9) * 0.4))
            ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z)))
        verts.append(ring)
    n = len(profile)
    for i in range(segments):
        j = (i + 1) % segments
        for k in range(n - 1):
            try:
                bm.faces.new((verts[i][k], verts[j][k], verts[j][k + 1], verts[i][k + 1]))
            except ValueError:
                pass
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()

    for p in me.polygons:
        p.use_smooth = True
    return obj


cup = lathe(CUP_PROFILE, "Cup", wobble=0.012)
saucer = lathe(SAUCER_PROFILE, "Saucer", wobble=0.006)

# ручка: тор, вдавленный в стенку, затем объединённый с корпусом —
# так стык получается настоящим переходом, а не «заклёпкой» поверх
bpy.ops.mesh.primitive_torus_add(
    major_radius=0.019, minor_radius=0.0052, major_segments=64, minor_segments=20,
    location=(-0.0455, 0, 0.045), rotation=(math.pi / 2, 0, 0),
)
handle = bpy.context.object
handle.name = "Handle"
handle.scale = (1.0, 1.25, 1.0)
for p in handle.data.polygons:
    p.use_smooth = True

handle.hide_render = True
handle.hide_viewport = True

boolean = cup.modifiers.new("join_handle", "BOOLEAN")
boolean.operation = "UNION"
boolean.object = handle
boolean.solver = "EXACT"

# кофе: диск на текущем уровне налива
LEVEL_EMPTY, LEVEL_FULL = 0.010, 0.0655
level = lerp(LEVEL_EMPTY, LEVEL_FULL, FILL)
# радиус внутренней стенки на этой высоте
inner = [(0.007, 0.0), (0.008, 0.024), (0.018, 0.029), (0.036, 0.034), (0.056, 0.038), (0.070, 0.0405), (0.0742, 0.0415)]
def inner_radius(z):
    for i in range(1, len(inner)):
        if z <= inner[i][0]:
            z0, r0 = inner[i - 1]
            z1, r1 = inner[i]
            return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
    return inner[-1][1]

bpy.ops.mesh.primitive_circle_add(vertices=192, radius=inner_radius(level) - 0.0004, fill_type="NGON", location=(0, 0, level))
coffee = bpy.context.object
coffee.name = "Coffee"
coffee.hide_render = FILL <= 0.02

# стойка
bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, 0))
counter = bpy.context.object
counter.name = "Counter"

# ── струя и носик ────────────────────────────────────────────────────────────
SPOUT_Z = 0.175
if FLOW > 0.02:
    height = SPOUT_Z - level
    # струя: конус, сужающийся книзу — поток ускоряется, сечение падает
    bpy.ops.mesh.primitive_cone_add(
        vertices=48, radius1=0.0028, radius2=0.0013, depth=height,
        location=(0, 0, level + height / 2),
    )
    stream = bpy.context.object
    stream.name = "Stream"
    for p in stream.data.polygons:
        p.use_smooth = True

    # капли: ниже по потоку сплошная нить распадается
    for i in range(7):
        t = 0.45 + i * 0.075
        z = SPOUT_Z - height * t
        off = 0.0016 * math.sin(i * 2.3)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=0.0016 + i * 0.00012, location=(off, off * 0.6, z))
        d = bpy.context.object
        d.name = f"Drop{i}"
        d.scale = (1, 1, 1.5)
        for p in d.data.polygons:
            p.use_smooth = True

# носик виден, только пока льют
if FLOW > 0.01:
    bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=0.011, radius2=0.0045, depth=0.03, location=(0, 0, SPOUT_Z + 0.015))
    tip = bpy.context.object
    tip.name = "SpoutTip"
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.016, depth=0.12, location=(0, 0, SPOUT_Z + 0.088))
    body = bpy.context.object
    body.name = "SpoutBody"
    for o in (tip, body):
        for p in o.data.polygons:
            p.use_smooth = True


# ── материалы ────────────────────────────────────────────────────────────────
def new_material(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat, nt, bsdf


def set_input(bsdf, name, value):
    if name in bsdf.inputs:
        bsdf.inputs[name].default_value = value


# керамика: глазурь сверху, голая глина на ножке, крап шамота
mat, nt, bsdf = new_material("Ceramic")
geo = nt.nodes.new("ShaderNodeNewGeometry")
sep = nt.nodes.new("ShaderNodeSeparateXYZ")
nt.links.new(geo.outputs["Position"], sep.inputs["Vector"])
# граница глазури на 1.4 см с неровным краем
edge = nt.nodes.new("ShaderNodeMapRange")
edge.inputs["From Min"].default_value = 0.012
edge.inputs["From Max"].default_value = 0.017
nt.links.new(sep.outputs["Z"], edge.inputs["Value"])

drip = nt.nodes.new("ShaderNodeTexNoise")
drip.inputs["Scale"].default_value = 9.0
drip.inputs["Detail"].default_value = 2.0
mix_edge = nt.nodes.new("ShaderNodeMix")
mix_edge.data_type = "FLOAT"
mix_edge.inputs["Factor"].default_value = 0.22
nt.links.new(edge.outputs["Result"], mix_edge.inputs[2])
nt.links.new(drip.outputs["Fac"], mix_edge.inputs[3])

glaze_col = nt.nodes.new("ShaderNodeRGB")
glaze_col.outputs[0].default_value = (0.021, 0.018, 0.015, 1)
clay_col = nt.nodes.new("ShaderNodeRGB")
clay_col.outputs[0].default_value = (0.16, 0.075, 0.045, 1)

speck = nt.nodes.new("ShaderNodeTexNoise")
speck.inputs["Scale"].default_value = 420.0
speck.inputs["Detail"].default_value = 1.0
speck_ramp = nt.nodes.new("ShaderNodeValToRGB")
speck_ramp.color_ramp.elements[0].position = 0.62
speck_ramp.color_ramp.elements[1].position = 0.72
nt.links.new(speck.outputs["Fac"], speck_ramp.inputs["Fac"])

glaze_speck = nt.nodes.new("ShaderNodeMix")
glaze_speck.data_type = "RGBA"
glaze_speck.inputs["Factor"].default_value = 0.5
nt.links.new(speck_ramp.outputs["Color"], glaze_speck.inputs["Factor"])
nt.links.new(glaze_col.outputs[0], glaze_speck.inputs[6])
crumb = nt.nodes.new("ShaderNodeRGB")
crumb.outputs[0].default_value = (0.20, 0.17, 0.14, 1)
nt.links.new(crumb.outputs[0], glaze_speck.inputs[7])

body_mix = nt.nodes.new("ShaderNodeMix")
body_mix.data_type = "RGBA"
nt.links.new(mix_edge.outputs[0], body_mix.inputs["Factor"])
nt.links.new(clay_col.outputs[0], body_mix.inputs[6])
nt.links.new(glaze_speck.outputs[2], body_mix.inputs[7])
nt.links.new(body_mix.outputs[2], bsdf.inputs["Base Color"])

rough = nt.nodes.new("ShaderNodeMix")
rough.data_type = "FLOAT"
rough.inputs[2].default_value = 0.92   # глина
rough.inputs[3].default_value = 0.19   # глазурь
nt.links.new(mix_edge.outputs[0], rough.inputs["Factor"])
nt.links.new(rough.outputs[0], bsdf.inputs["Roughness"])

bump = nt.nodes.new("ShaderNodeBump")
bump.inputs["Strength"].default_value = 0.12
micro = nt.nodes.new("ShaderNodeTexNoise")
micro.inputs["Scale"].default_value = 160.0
nt.links.new(micro.outputs["Fac"], bump.inputs["Height"])
nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
set_input(bsdf, "IOR", 1.48)

# ── печать по боку: бренд в глазури ──────────────────────────────────────────
# У тела вращения нет развёртки, поэтому UV считаем прямо в нодах: угол вокруг
# оси даёт U, высота — V. Так печать ложится по окружности без ручного разворота.
DECAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "decal.png")
if os.path.exists(DECAL):
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep_p = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep_p.inputs["Vector"])

    ang = nt.nodes.new("ShaderNodeMath")
    ang.operation = "ARCTAN2"
    nt.links.new(sep_p.outputs["Y"], ang.inputs[0])
    nt.links.new(sep_p.outputs["X"], ang.inputs[1])
    to_u = nt.nodes.new("ShaderNodeMath")
    to_u.operation = "MULTIPLY_ADD"
    to_u.inputs[1].default_value = -2.0 / 6.2831853  # печать занимает ~127° окружности
    to_u.inputs[2].default_value = 0.5  # центр печати на +X, подальше от шва arctan2
    nt.links.new(ang.outputs[0], to_u.inputs[0])

    # пояс печати: середина стенки, между глиняной каймой и кромкой
    to_v = nt.nodes.new("ShaderNodeMapRange")
    to_v.inputs["From Min"].default_value = 0.028
    to_v.inputs["From Max"].default_value = 0.069
    nt.links.new(sep_p.outputs["Z"], to_v.inputs["Value"])

    uv = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(to_u.outputs[0], uv.inputs["X"])
    nt.links.new(to_v.outputs["Result"], uv.inputs["Y"])

    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(DECAL)
    tex.extension = "CLIP"
    tex.interpolation = "Cubic"
    nt.links.new(uv.outputs["Vector"], tex.inputs["Vector"])

    printed = nt.nodes.new("ShaderNodeMix")
    printed.data_type = "RGBA"
    nt.links.new(tex.outputs["Alpha"], printed.inputs["Factor"])
    nt.links.new(body_mix.outputs[2], printed.inputs[6])
    nt.links.new(tex.outputs["Color"], printed.inputs[7])
    nt.links.new(printed.outputs[2], bsdf.inputs["Base Color"])

    # краска матовее глазури — иначе печать бликует как наклейка
    rough_print = nt.nodes.new("ShaderNodeMix")
    rough_print.data_type = "FLOAT"
    rough_print.inputs[3].default_value = 0.55
    nt.links.new(tex.outputs["Alpha"], rough_print.inputs["Factor"])
    nt.links.new(rough.outputs[0], rough_print.inputs[2])
    nt.links.new(rough_print.outputs[0], bsdf.inputs["Roughness"])

cup.rotation_euler[2] = math.radians(-97)
cup.data.materials.append(mat)

# У блюдца та же глазурь, но без глиняного пояса: маска по высоте сделала бы
# его целиком терракотовым — оно всё лежит ниже границы полива.
mat_sa, nt_sa, bsdf_sa = new_material("Glaze")
set_input(bsdf_sa, "Base Color", (0.019, 0.016, 0.014, 1))
set_input(bsdf_sa, "Roughness", 0.2)
set_input(bsdf_sa, "IOR", 1.48)
sa_bump = nt_sa.nodes.new("ShaderNodeBump")
sa_bump.inputs["Strength"].default_value = 0.1
sa_noise = nt_sa.nodes.new("ShaderNodeTexNoise")
sa_noise.inputs["Scale"].default_value = 150.0
nt_sa.links.new(sa_noise.outputs["Fac"], sa_bump.inputs["Height"])
nt_sa.links.new(sa_bump.outputs["Normal"], bsdf_sa.inputs["Normal"])
saucer.data.materials.append(mat_sa)

# кофе: почти чёрное зеркало, чуть шероховатое — рябь остывающей поверхности
mat_c, nt_c, bsdf_c = new_material("Coffee")
set_input(bsdf_c, "Base Color", (0.012, 0.006, 0.003, 1))
set_input(bsdf_c, "Roughness", 0.055)
set_input(bsdf_c, "IOR", 1.34)
set_input(bsdf_c, "Specular IOR Level", 0.6)
coffee.data.materials.append(mat_c)

# камень стойки
mat_s, nt_s, bsdf_s = new_material("Stone")
set_input(bsdf_s, "Base Color", (0.020, 0.018, 0.016, 1))
set_input(bsdf_s, "Roughness", 0.42)
stone_bump = nt_s.nodes.new("ShaderNodeBump")
stone_bump.inputs["Strength"].default_value = 0.06
stone_noise = nt_s.nodes.new("ShaderNodeTexNoise")
stone_noise.inputs["Scale"].default_value = 45.0
nt_s.links.new(stone_noise.outputs["Fac"], stone_bump.inputs["Height"])
nt_s.links.new(stone_bump.outputs["Normal"], bsdf_s.inputs["Normal"])
counter.data.materials.append(mat_s)

if FLOW > 0.02:
    mat_l, nt_l, bsdf_l = new_material("Liquid")
    set_input(bsdf_l, "Base Color", (0.09, 0.035, 0.012, 1))
    set_input(bsdf_l, "Roughness", 0.03)
    set_input(bsdf_l, "Transmission Weight", 1.0)
    set_input(bsdf_l, "IOR", 1.35)
    for o in bpy.data.objects:
        if o.name.startswith("Stream") or o.name.startswith("Drop"):
            o.data.materials.append(mat_l)

if FLOW > 0.01:
    mat_m, nt_m, bsdf_m = new_material("Steel")
    set_input(bsdf_m, "Base Color", (0.55, 0.56, 0.57, 1))
    set_input(bsdf_m, "Metallic", 1.0)
    set_input(bsdf_m, "Roughness", 0.14)
    for o in bpy.data.objects:
        if o.name.startswith("Spout"):
            o.data.materials.append(mat_m)

# ── мир: панорама реального погреба ──────────────────────────────────────────
world = bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
wnt = world.node_tree
for n in list(wnt.nodes):
    wnt.nodes.remove(n)
wout = wnt.nodes.new("ShaderNodeOutputWorld")
bg = wnt.nodes.new("ShaderNodeBackground")
bg.inputs["Strength"].default_value = 0.3
env = wnt.nodes.new("ShaderNodeTexEnvironment")
if os.path.exists(HDRI):
    env.image = bpy.data.images.load(HDRI)
mapping = wnt.nodes.new("ShaderNodeMapping")
mapping.inputs["Rotation"].default_value = (0, 0, -2.75)
coord = wnt.nodes.new("ShaderNodeTexCoord")
wnt.links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
wnt.links.new(mapping.outputs["Vector"], env.inputs["Vector"])
wnt.links.new(env.outputs["Color"], bg.inputs["Color"])
wnt.links.new(bg.outputs["Background"], wout.inputs["Surface"])

# «одно высокое окно на восток»: узкий прямоугольный источник сзади-слева.
# Он же даёт контровой блик по кромке и длинную тень на зрителя.
bpy.ops.object.light_add(type="AREA", location=(-0.55, -0.75, 0.62))
win = bpy.context.object
win.data.shape = "RECTANGLE"
win.data.size = 0.2
win.data.size_y = 0.95
win.data.energy = 30
win.data.color = (1.0, 0.83, 0.62)
win.rotation_euler = (math.radians(62), 0, math.radians(-36))
win.visible_camera = False

# слабый холодный отражатель спереди — иначе перед предмета уходит в силуэт
bpy.ops.object.light_add(type="AREA", location=(0.5, 0.62, 0.3))
fill_light = bpy.context.object
fill_light.data.shape = "RECTANGLE"
fill_light.data.size = 0.7
fill_light.data.size_y = 0.5
fill_light.data.energy = 1.1
fill_light.data.color = (0.72, 0.79, 0.88)
fill_light.rotation_euler = (math.radians(74), 0, math.radians(148))
fill_light.visible_camera = False


# ── атмосфера ────────────────────────────────────────────────────────────────
# Воздух не пустой: тонкая дымка ловит луч из окна и даёт кадру глубину.
# Плотность намеренно мизерная — нужен намёк на объём, а не туман.
vol = wnt.nodes.new("ShaderNodeVolumeScatter")
vol.inputs["Density"].default_value = 0.055
vol.inputs["Anisotropy"].default_value = 0.35
vol.inputs["Color"].default_value = (0.85, 0.78, 0.68, 1)
wnt.links.new(vol.outputs["Volume"], wout.inputs["Volume"])

# Задняя стена далеко: без неё фон — ровный градиент панорамы. Стена почти
# чёрная и держит одно мягкое световое пятно — фон остаётся пустым под текст.
bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 1.9, 0))
back = bpy.context.object
back.name = "BackWall"
back.rotation_euler = (math.radians(90), 0, 0)
mat_b, nt_b, bsdf_b = new_material("Wall")
set_input(bsdf_b, "Base Color", (0.030, 0.026, 0.022, 1))
set_input(bsdf_b, "Roughness", 0.92)
wall_bump = nt_b.nodes.new("ShaderNodeBump")
wall_bump.inputs["Strength"].default_value = 0.35
wall_noise = nt_b.nodes.new("ShaderNodeTexNoise")
wall_noise.inputs["Scale"].default_value = 12.0
wall_noise.inputs["Detail"].default_value = 6.0
nt_b.links.new(wall_noise.outputs["Fac"], wall_bump.inputs["Height"])
nt_b.links.new(wall_bump.outputs["Normal"], bsdf_b.inputs["Normal"])
back.data.materials.append(mat_b)

# Пар: объём над чашкой, живёт только когда в ней есть горячий кофе.
if FILL > 0.25:
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, level + 0.075))
    steam = bpy.context.object
    steam.name = "Steam"
    steam.scale = (0.055, 0.055, 0.14)
    mat_st = bpy.data.materials.new("Steam")
    mat_st.use_nodes = True
    nts = mat_st.node_tree
    for n in list(nts.nodes):
        nts.nodes.remove(n)
    out_st = nts.nodes.new("ShaderNodeOutputMaterial")
    princ = nts.nodes.new("ShaderNodeVolumePrincipled")
    princ.inputs["Color"].default_value = (0.9, 0.88, 0.85, 1)
    princ.inputs["Density"].default_value = 0.0
    # плотность рвётся шумом и тает кверху: ровный столб читается дымовой шашкой
    nz = nts.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 9.0
    nz.inputs["Detail"].default_value = 6.0
    ramp = nts.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.52
    ramp.color_ramp.elements[1].position = 0.78
    nts.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
    grad = nts.nodes.new("ShaderNodeTexGradient")
    grad.gradient_type = "LINEAR"
    gmap = nts.nodes.new("ShaderNodeMapping")
    gmap.inputs["Rotation"].default_value = (0, math.radians(-90), 0)
    gcoord = nts.nodes.new("ShaderNodeTexCoord")
    nts.links.new(gcoord.outputs["Object"], gmap.inputs["Vector"])
    nts.links.new(gmap.outputs["Vector"], grad.inputs["Vector"])
    fade = nts.nodes.new("ShaderNodeMath")
    fade.operation = "MULTIPLY"
    nts.links.new(ramp.outputs["Color"], fade.inputs[0])
    nts.links.new(grad.outputs["Fac"], fade.inputs[1])
    dens = nts.nodes.new("ShaderNodeMath")
    dens.operation = "MULTIPLY"
    dens.inputs[1].default_value = 2.6 * min(1.0, (FILL - 0.25) / 0.4)
    nts.links.new(fade.outputs[0], dens.inputs[0])
    nts.links.new(dens.outputs[0], princ.inputs["Density"])
    nts.links.new(princ.outputs["Volume"], out_st.inputs["Volume"])
    steam.data.materials.append(mat_st)

# ── камера ───────────────────────────────────────────────────────────────────
# Кинематографичный проход: камера обходит предмет по дуге, одновременно
# опускаясь к столу и приближаясь. Это «долли вокруг» — приём, который читается
# дорого именно потому, что меняются сразу три вещи: угол, дистанция и высота.
#
# Диафрагма открывается по ходу: на общем плане резко всё, к финалу фон
# распадается в боке. Так объектив ведёт себя в реальной съёмке.
AZ_START, AZ_END = math.radians(-46), math.radians(28)
azimuth = AZ_START + (AZ_END - AZ_START) * smoothstep(0.0, 1.0, PHASE)

# дистанция падает не линейно: сближение ускоряется к наливу и замирает в финале
dist = lerp(0.86, 0.355, smoothstep(0.05, 0.82, PHASE))
# высота: от уровня стойки вниз к «глазам гостя», в самом конце — над кромкой
cam_z = lerp(0.115, 0.055, smoothstep(0.0, 0.5, PHASE)) + TOP * 0.29
look_z = lerp(0.040, 0.052, APPROACH) - TOP * 0.012

cam_x = math.sin(azimuth) * dist
cam_y = -math.cos(azimuth) * dist

bpy.ops.object.camera_add(location=(cam_x, cam_y, cam_z))
cam = bpy.context.object
scene.camera = cam
cam.data.lens = lerp(52, 85, smoothstep(0.2, 0.9, PHASE))
cam.data.sensor_width = 36
# сдвиг кадра вместо доворота: перспектива предмета не искажается,
# а сбоку освобождается место под текст
cam.data.shift_x = 0.16
cam.data.dof.use_dof = True
cam.data.dof.aperture_fstop = lerp(6.0, 2.6, smoothstep(0.25, 0.95, PHASE))

target = bpy.data.objects.new("Target", None)
bpy.context.collection.objects.link(target)
target.location = (0, 0, look_z)
track = cam.constraints.new("TRACK_TO")
track.target = target
track.track_axis = "TRACK_NEGATIVE_Z"
track.up_axis = "UP_Y"
cam.data.dof.focus_object = target

# ── рендер ───────────────────────────────────────────────────────────────────
scene.render.engine = "CYCLES"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 8
scene.cycles.transmission_bounces = 8
scene.render.resolution_x = RES_X
scene.render.resolution_y = RES_Y
scene.render.film_transparent = False
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Base Contrast"
scene.view_settings.exposure = -0.55

prefs = bpy.context.preferences.addons["cycles"].preferences
# GTX 1650 + Blender 5.2: CUDA-ядро на этой машине не грузится («Invalid kernel
# image» — собранный kernel_sm_75 не подходит установленному драйверу), поэтому
# сначала пробуем OptiX, а при неудаче честно считаем на CPU.
def pick_device():
    if DEVICE == "cpu":
        scene.cycles.device = "CPU"
        print("[scene] device: CPU (forced)")
        return
    # CUDA на этой машине заведомо падает («Invalid kernel image»), поэтому
    # в авто-режиме её не пробуем: только OptiX, дальше CPU.
    order = [DEVICE.upper()] if DEVICE in ("optix", "cuda") else ["OPTIX"]
    for dev_type in order:
        try:
            prefs.compute_device_type = dev_type
            prefs.get_devices()
            found = [d for d in prefs.devices if d.type == dev_type]
            if not found:
                continue
            for d in prefs.devices:
                d.use = d.type in (dev_type, "CPU")
            scene.cycles.device = "GPU"
            print(f"[scene] device: {dev_type} — {[d.name for d in found]}")
            return
        except Exception as e:  # noqa: BLE001
            print(f"[scene] {dev_type} недоступен: {e}")
    scene.cycles.device = "CPU"
    print("[scene] device: CPU (fallback)")

pick_device()

os.makedirs(os.path.dirname(OUT), exist_ok=True)
scene.render.filepath = OUT
scene.render.image_settings.file_format = "PNG"
print(f"[scene] phase={PHASE} fill={FILL:.2f} flow={FLOW:.2f} approach={APPROACH:.2f} top={TOP:.2f}")
bpy.ops.render.render(write_still=True)
print(f"[scene] saved {OUT}")
