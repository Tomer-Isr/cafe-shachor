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

# Свет вынесен в аргументы: у чёрной глазури форма читается отражениями, а не
# заливкой, и нужный баланс подбирается прогонами, а не рассуждением.
KEY = float(arg("--key", "5"))            # окно на восток, основной
RIM = float(arg("--rim", "400"))          # узкий контровой стрип: рисует силуэт
FILL_LIGHT = float(arg("--fill", "0.6"))  # холодный подсвет спереди
CEIL = float(arg("--ceil", "1.4"))        # свод: живёт в отражении кофе, не в свете
EXPOSURE = float(arg("--exposure", "-0.40"))

clamp = lambda v, a, b: max(a, min(b, v))
lerp = lambda a, b, t: a + (b - a) * t


def smoothstep(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ── камера: пять блоков, четыре перехода ─────────────────────────────────────
# Раньше здесь был один равномерный проезд от общего плана к макро — прокрутка
# читалась перемоткой, а не рассказом («анимация бессмысленная», вердикт Томера).
#
# Теперь плёнка собрана как раскадровка (docs/STORYBOARD.md): внутри блока
# камера почти стоит и лишь чуть дрейфует, а между блоками быстро перебрасывает
# взгляд. Стоячий кадр не значит застывший: в блоке живут свет, пар и жидкость,
# поэтому кадры всё равно все разные.
#
# Каждое состояние: (позиция камеры, точка взгляда, фокусное, диафрагма, сдвиг).
SHOTS = [
    # 01 «Окно на восток» — общий план стойки, чашка ещё пустая
    (dict(cam=(-0.42, -0.62, 0.150), look=(0, 0, 0.045), lens=50, fstop=8.0, shift=0.17),
     dict(cam=(-0.37, -0.57, 0.142), look=(0, 0, 0.045), lens=50, fstop=8.0, shift=0.17)),
    # 02 «Зерно» — макро россыпи, чашка размытым пятном позади
    (dict(cam=(0.015, -0.305, 0.078), look=(0.105, -0.028, 0.004), lens=85, fstop=5.6, shift=0.06),
     dict(cam=(0.055, -0.280, 0.062), look=(0.105, -0.028, 0.004), lens=85, fstop=5.6, shift=0.06)),
    # 03 «Налив» — камера чуть выше кромки, чтобы в кадр попала поверхность.
    # С уровня стойки (первая версия, cam z = 0.108) виден только бок чашки и
    # палка струи: корона, всплеск и волны остаются за краем — блок про налив
    # налива не показывал.
    (dict(cam=(-0.092, -0.268, 0.196), look=(0, 0, 0.058), lens=62, fstop=4.5, shift=0.13),
     dict(cam=(-0.074, -0.244, 0.186), look=(0, 0, 0.060), lens=62, fstop=4.5, shift=0.13)),
    # 04 «Чёрное зеркало» — взгляд внутрь, поверхность на весь кадр
    (dict(cam=(0.042, -0.118, 0.188), look=(0, 0, 0.066), lens=70, fstop=6.0, shift=0.03),
     dict(cam=(0.028, -0.102, 0.179), look=(0, 0, 0.066), lens=70, fstop=6.0, shift=0.03)),
    # 05 «Готово» — отступ; чашка уходит вбок, освобождая место под контент
    (dict(cam=(-0.155, -0.395, 0.112), look=(0, 0, 0.046), lens=55, fstop=5.0, shift=0.26),
     dict(cam=(-0.200, -0.455, 0.122), look=(0, 0, 0.046), lens=55, fstop=5.0, shift=0.30)),
]

# Доля прокрутки на блок и на переход. Кадры разложены по прокрутке равномерно,
# а движение камеры — нет: в блоке она почти стоит, в переходе перебрасывается
# далеко. При коротком переходе (0.068) бросок укладывался в шесть кадров и
# читался рывком — «где-то быстрее, где-то медленнее». Переход удлинён почти
# до длины блока: та же дистанция теперь размазана вдвое мягче.
BLOCK, TRANS = 0.115, 0.105


def smootherstep(x):
    """Разгон и торможение без излома.

    У обычного smoothstep на концах обнуляется только скорость, а ускорение
    прыгает — глаз ловит это как толчок в начале и в конце броска. Здесь
    нулевые и первая, и вторая производные, поэтому переход втекает в стоячий
    кадр незаметно.
    """
    t = clamp(x, 0.0, 1.0)
    return t * t * t * (t * (t * 6 - 15) + 10)


def choreography(p):
    """Состояние камеры на прокрутке p: внутри блока — дрейф, между — бросок."""
    span = BLOCK + TRANS
    for i, (a, b) in enumerate(SHOTS):
        start = i * span
        if p < start + BLOCK or i == len(SHOTS) - 1:
            t = clamp((p - start) / BLOCK, 0.0, 1.0)
            return a, b, t          # дрейф внутри блока: линейно и еле-еле
        if p < start + span:
            t = smootherstep((p - start - BLOCK) / TRANS)
            return b, SHOTS[i + 1][0], t   # бросок к следующему блоку
    return SHOTS[-1][0], SHOTS[-1][1], 1.0



def _phase_remap_table(samples=600):
    """Пересчёт прокрутки в фазу так, чтобы движение шло ровно.

    Кадры разложены по прокрутке равномерно, а хореография — нет: в блоке
    камера почти стоит, в переходе перебрасывается далеко. Из-за этого за
    один и тот же поворот колеса картинка то еле ползёт, то прыгает
    (замечание Томера про скорость).

    Считаем, сколько «видимого движения» приходится на каждый участок фазы,
    и раздаём кадры пропорционально пути, а не времени. Выравниваем не до
    конца: при полном выравнивании стоячие кадры перестают быть стоячими и
    раскадровка рассыпается обратно в равномерный проезд.
    """
    def state(p):
        f, t, tt = choreography(p)
        cam = tuple(lerp(f["cam"][j], t["cam"][j], tt) for j in range(3))
        look = tuple(lerp(f["look"][j], t["look"][j], tt) for j in range(3))
        return cam, look, lerp(f["lens"], t["lens"], tt)

    def dist(a, b):
        return sum((a[i] - b[i]) ** 2 for i in range(3)) ** 0.5

    def cost(a, b):
        # точка взгляда весит больше камеры: поворот кадра заметнее проезда
        return dist(a[0], b[0]) + dist(a[1], b[1]) * 1.4 + abs(a[2] - b[2]) / 60 * 0.35

    xs = [i / samples for i in range(samples + 1)]
    st = [state(x) for x in xs]
    cum = [0.0]
    for i in range(1, samples + 1):
        cum.append(cum[-1] + cost(st[i - 1], st[i]))
    return xs, cum, cum[-1]


_XS, _CUM, _TOTAL = _phase_remap_table()
EQUALIZE = float(arg("--equalize", "0.9"))


def remap_phase(p):
    """Прокрутка → фаза. 0 — как было, 1 — полностью ровное движение."""
    if EQUALIZE <= 0 or _TOTAL <= 0:
        return p
    target = p * _TOTAL
    lo, hi = 0, len(_CUM) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if _CUM[mid] < target:
            lo = mid + 1
        else:
            hi = mid
    return lerp(p, _XS[lo], EQUALIZE)


# Дальше по файлу PHASE — это фаза хореографии, а SCROLL — позиция прокрутки.
SCROLL = PHASE
PHASE = remap_phase(SCROLL)

# фазы хореографии
# Налив привязан к третьему блоку раскадровки (0.432–0.580 прокрутки): начинается
# на входе в блок и заканчивается к его концу, чтобы в блоке «Чёрное зеркало»
# чашка была уже полной, а волна на поверхности — затухающей.
POUR = clamp((PHASE - 0.440) / 0.150, 0.0, 1.0)
FILL = smoothstep(0.0, 1.0, POUR)
FLOW = min(clamp(POUR / 0.10, 0, 1), clamp((1 - POUR) / 0.14, 0, 1))

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
saucer.rotation_euler[2] = math.radians(18)

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

def coffee_surface(radius, height, name="Coffee"):
    """Поверхность налитого кофе — сетка колец, а не плоский диск.

    Плоскости с текстурной рябью недостаточно: рябь в нормали не гнёт
    отражение, поэтому поверхность читается мёртвым куском пластика. Здесь
    гнётся сама геометрия, и отражение свода ходит вместе с ней.

    Две волны разной природы, как в настоящей чашке:
      · расходящаяся от точки удара струи, затухающая к стенке;
      · слошинг — общий перекос всей массы, самая низкая мода колебания,
        та, из-за которой кофе плещется через край при ходьбе.
    """
    rings, seg = 26, 96
    me = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)

    # Жизнь поверхности идёт по прокрутке: во время налива волна сильная,
    # после — затухает, но не умирает совсем.
    t = PHASE * 26.0
    impact = 0.00027 * (0.35 + 0.65 * FLOW)
    slosh = 0.00022 * (0.30 + 0.70 * FLOW)
    decay = 62.0

    def z_at(r, a):
        w = math.sin(785.0 * r - t) * math.exp(-r * decay) * impact
        # перекос: у стенки максимален, в центре нуля — это и есть слошинг
        s = (r / radius) * math.cos(a - 0.6) * math.sin(t * 0.42) * slosh
        return w + s

    bm = bmesh.new()
    center = bm.verts.new((0, 0, z_at(0.0, 0.0)))
    prev = None
    for ri in range(1, rings + 1):
        r = radius * (ri / rings) ** 0.85   # кольца гуще к стенке, где круче волна
        ring = []
        for si in range(seg):
            a = (si / seg) * math.tau
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z_at(r, a))))
        if prev is None:
            for si in range(seg):
                bm.faces.new((center, ring[si], ring[(si + 1) % seg]))
        else:
            for si in range(seg):
                sj = (si + 1) % seg
                bm.faces.new((prev[si], ring[si], ring[sj], prev[sj]))
        prev = ring
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    obj.location = (0, 0, height)
    return obj


coffee = coffee_surface(inner_radius(level) - 0.0004, level)
coffee.hide_render = FILL <= 0.02

# стойка
bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, 0))
counter = bpy.context.object
counter.name = "Counter"


# ── зерно ────────────────────────────────────────────────────────────────────
# Россыпь на стойке: блок «жарим по вторникам» в раскадровке. Зерно нельзя
# слепить из шара — узнаваемым его делает борозда по плоской стороне, поэтому
# лепим вручную: сфера → сплющивание в реальные 10.4 × 7.2 × 6 мм → вдавленный
# по длине жёлоб. Без жёлоба россыпь читается фасолью или галькой.
def coffee_bean(name, seed=0):
    rnd = __import__("random").Random(seed)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=28, ring_count=16, radius=1.0)
    bean = bpy.context.object
    bean.name = name

    me = bean.data
    L, W, H = 0.0052, 0.0036, 0.0030
    # у каждого зерна своя лёгкая неправильность: одинаковые клоны видны сразу
    jitter = 1.0 + rnd.uniform(-0.09, 0.09)
    L *= jitter
    W *= 1.0 + rnd.uniform(-0.07, 0.07)

    for v in me.vertices:
        x, y, z = v.co
        x *= L
        y *= W
        z *= H
        # жёлоб: глубокий у оси, сходит на нет к бокам и к торцам
        along = max(0.0, 1.0 - (x / L) ** 2)
        across = math.exp(-((y / (W * 0.34)) ** 2))
        groove = H * 1.02 * across * along
        z -= groove if z > 0 else -groove * 0.12
        # бок зерна чуть пухлее у жёлоба — так лежит настоящее зерно
        y *= 1.0 + 0.10 * across * along
        v.co = (x, y, z)

    for p in me.polygons:
        p.use_smooth = True
    return bean


# ── следы присутствия ────────────────────────────────────────────────────────
# Людей в кадре нет намеренно: плохая фигура в 3D читается манекеном и тянет
# за собой весь кадр. Обжитость даём предметами — вторая чашка, из которой уже
# пили, питчер и темпер бариста, смятая салфетка. Всё стоит на дальнем плане
# и живёт в расфокусе: разглядывать эти вещи не нужно, нужно, чтобы зритель
# почувствовал, что здесь только что кто-то был.
PROPS = arg("--props", "on") != "off"

if PROPS:
    # Вторая чашка: та же геометрия, что у героя, но развёрнута иначе и
    # отодвинута вглубь. Стоит на блюдце, кофе допит не до конца.
    cup2 = lathe(CUP_PROFILE, "Cup2", wobble=0.010)
    saucer2 = lathe(SAUCER_PROFILE, "Saucer2", wobble=0.005)
    for o, pos, rot in (
        (cup2, (-0.225, 0.205, 0.0), math.radians(58)),
        (saucer2, (-0.225, 0.205, 0.0), math.radians(-24)),
    ):
        o.location = pos
        o.rotation_euler[2] = rot

    bpy.ops.mesh.primitive_torus_add(
        major_radius=0.019, minor_radius=0.0052, major_segments=48, minor_segments=16,
        location=(-0.225 - 0.0455 * math.cos(math.radians(58)),
                  0.205 - 0.0455 * math.sin(math.radians(58)), 0.045),
        rotation=(math.pi / 2, 0, math.radians(58)),
    )
    handle2 = bpy.context.object
    handle2.name = "Handle2"
    handle2.scale = (1.0, 1.25, 1.0)
    handle2.hide_render = True
    handle2.hide_viewport = True
    b2 = cup2.modifiers.new("join_handle", "BOOLEAN")
    b2.operation = "UNION"
    b2.object = handle2
    b2.solver = "EXACT"

    # остаток кофе на дне — гость ушёл, чашку ещё не убрали
    dregs = coffee_surface(inner_radius(0.019) - 0.0004, 0.019, "Dregs")
    dregs.location = (-0.225, 0.205, 0.019)

    # Питчер для молока: усечённый конус со сведённым носиком. Металл ловит
    # окно узким бликом и работает вторым светлым пятном в глубине кадра.
    bpy.ops.mesh.primitive_cone_add(
        vertices=64, radius1=0.030, radius2=0.034, depth=0.082,
        location=(0.255, 0.240, 0.041),
    )
    pitcher = bpy.context.object
    pitcher.name = "Pitcher"
    for v in pitcher.data.vertices:
        x, y, z = v.co
        # Носик: верхний край мягко вытягивается вперёд. Тянуть сильно нельзя —
        # получается воронка, а не питчер (первая версия давала 3 см вылета).
        if z > 0.024:
            pull = max(0.0, (x / 0.034)) ** 3 * 0.014 * ((z - 0.024) / 0.017)
            v.co = (x + pull, y * (1.0 - 0.35 * pull / 0.014), z + pull * 0.30)
    for p in pitcher.data.polygons:
        p.use_smooth = True
    pitcher.rotation_euler[2] = math.radians(-52)

    # Темпер: диск с рукоятью, лежит рядом
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.029, depth=0.010,
                                        location=(0.158, 0.148, 0.005))
    tamp_base = bpy.context.object
    tamp_base.name = "TamperBase"
    bpy.ops.mesh.primitive_cone_add(vertices=40, radius1=0.019, radius2=0.026, depth=0.042,
                                    location=(0.158, 0.148, 0.031))
    tamp_grip = bpy.context.object
    tamp_grip.name = "TamperGrip"
    for o in (tamp_base, tamp_grip):
        for p in o.data.polygons:
            p.use_smooth = True

    # Салфетка: тонкая пластина с провисом — ровный прямоугольник читается
    # бумажкой из принтера, а не тканью, которой пользовались
    nap = bpy.data.meshes.new("Napkin")
    nap_obj = bpy.data.objects.new("Napkin", nap)
    bpy.context.collection.objects.link(nap_obj)
    bmn = bmesh.new()
    NN, NS = 14, 0.115
    grid = []
    for iy in range(NN):
        row = []
        for ix in range(NN):
            u, v = ix / (NN - 1) - 0.5, iy / (NN - 1) - 0.5
            fold = 0.0035 * math.sin(u * 7.0 + 1.2) * math.cos(v * 5.0 - 0.4)
            row.append(bmn.verts.new((u * NS, v * NS, 0.0012 + fold)))
        grid.append(row)
    for iy in range(NN - 1):
        for ix in range(NN - 1):
            bmn.faces.new((grid[iy][ix], grid[iy][ix + 1], grid[iy + 1][ix + 1], grid[iy + 1][ix]))
    bmn.normal_update()
    bmn.to_mesh(nap)
    bmn.free()
    for p in nap.polygons:
        p.use_smooth = True
    nap_obj.location = (-0.115, 0.165, 0.0)
    nap_obj.rotation_euler[2] = math.radians(17)

BEAN_SPILL = 26
beans = []
if BEAN_SPILL:
    import random as _rnd
    spread = _rnd.Random(7)
    proto = coffee_bean("BeanProto", seed=0)
    proto.hide_render = True
    proto.hide_viewport = True
    for i in range(BEAN_SPILL):
        b = coffee_bean(f"Bean{i:02d}", seed=i + 1)
        # Пятно справа-впереди от чашки: в общем плане это натюрморт на стойке,
        # а в блоке «Зерно» камера приходит сюда и россыпь становится сюжетом.
        ang = spread.uniform(0, math.tau)
        rad = 0.038 * math.sqrt(spread.random())
        # каждое пятое зерно лежит на соседях: ровный ковёр в один слой
        # читается разложенным вручную, а не рассыпанным
        stacked = i % 5 == 0 and i > 0
        b.location = (
            0.105 + math.cos(ang) * rad,
            -0.028 + math.sin(ang) * rad * 0.62,
            0.0030 + (0.0042 if stacked else 0.0),
        )
        b.rotation_euler = (
            spread.uniform(-1.1, 1.1) if stacked else spread.uniform(-0.35, 0.35),
            spread.uniform(-0.3, 0.3),
            spread.uniform(0, math.tau),
        )
        beans.append(b)

# ── струя и носик ────────────────────────────────────────────────────────────
SPOUT_Z = 0.175
if FLOW > 0.02:
    height = SPOUT_Z - level
    # струя: конус, сужающийся книзу — поток ускоряется, сечение падает
    bpy.ops.mesh.primitive_cone_add(
        vertices=48, radius1=0.0021, radius2=0.0010, depth=height,
        location=(0, 0, level + height / 2),
    )
    stream = bpy.context.object
    stream.name = "Stream"
    wave = stream.modifiers.new("necking", "WAVE")
    wave.use_x = False
    wave.use_y = False
    wave.use_normal = True
    wave.height = 0.0011
    wave.width = 0.012
    wave.narrowness = 6.0
    wave.speed = 0.0
    wave.time_offset = PHASE * 40.0
    sub = stream.modifiers.new("smooth", "SUBSURF")
    sub.levels = sub.render_levels = 1
    for p in stream.data.polygons:
        p.use_smooth = True

    # капли: ниже по потоку сплошная нить распадается
    for i in range(9 if FLOW < 0.55 else 0):
        t = 0.58 + i * 0.045
        z = SPOUT_Z - height * min(0.99, t)
        off = 0.0022 * math.sin(i * 2.3 + PHASE * 9)
        r = 0.0009 + (i % 3) * 0.00035
        bpy.ops.mesh.primitive_uv_sphere_add(segments=18, ring_count=10, radius=r, location=(off, off * 0.5, z))
        d = bpy.context.object
        d.name = f"Drop{i}"
        # падающая капля вытянута по движению, а не идеальный шарик
        d.scale = (1, 1, 1.9 + (i % 4) * 0.25)
        for p in d.data.polygons:
            p.use_smooth = True

    # Венчик в точке удара. Ровный тор читается надетым колечком: настоящая
    # корона всплеска зубчатая, и с каждого зубца срывается капля. Зубцы лепим
    # по углу, фазу гоняем прокруткой — корона живёт, а не стоит.
    bpy.ops.mesh.primitive_torus_add(
        major_radius=0.0075, minor_radius=0.0016,
        major_segments=64, minor_segments=14,
        location=(0, 0, 0),
    )
    crown = bpy.context.object
    crown.name = "Crown"
    crown.scale = (1.0, 1.0, 0.55)

    TEETH = 11
    crown_phase = PHASE * 21.0
    for v in crown.data.vertices:
        x, y, z = v.co
        a = math.atan2(y, x)
        tooth = max(0.0, math.sin(TEETH * a + crown_phase))
        lift = 0.0042 * tooth ** 1.6
        # зубец не только тянется вверх, но и расходится наружу
        grow = 1.0 + 0.16 * tooth
        v.co = (x * grow, y * grow, z + (lift if z > -0.0004 else lift * 0.15))
    crown.location = (0, 0, level + 0.0012)
    for pl in crown.data.polygons:
        pl.use_smooth = True

    # брызги: с верхушек зубцов срываются капли и летят вверх-наружу
    for i in range(7):
        a = (i / 7) * math.tau + crown_phase * 0.35
        rise = 0.006 + 0.010 * ((i * 0.37 + PHASE * 3.1) % 1.0)
        rad = 0.0085 + rise * 0.55
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=16, ring_count=9, radius=0.00075 + (i % 3) * 0.00022,
            location=(math.cos(a) * rad, math.sin(a) * rad, level + rise),
        )
        sp = bpy.context.object
        sp.name = f"Splash{i}"
        # капля в полёте вытянута по траектории, а не идеальный шарик
        sp.scale = (1.0, 1.0, 1.35)
        for pl in sp.data.polygons:
            pl.use_smooth = True

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
# Порог держим высоко: шум распределён вокруг 0.5, и рамп 0.62–0.72 отсекал
# больше половины поверхности — «крап» становился сплошной светлой краской и
# перекрашивал чёрную глазурь в шоколад. Крапин должно быть мало.
speck_ramp.color_ramp.elements[0].position = 0.80
speck_ramp.color_ramp.elements[1].position = 0.88
nt.links.new(speck.outputs["Fac"], speck_ramp.inputs["Fac"])

glaze_speck = nt.nodes.new("ShaderNodeMix")
glaze_speck.data_type = "RGBA"
glaze_speck.inputs["Factor"].default_value = 0.5
nt.links.new(speck_ramp.outputs["Color"], glaze_speck.inputs["Factor"])
nt.links.new(glaze_col.outputs[0], glaze_speck.inputs[6])
crumb = nt.nodes.new("ShaderNodeRGB")
crumb.outputs[0].default_value = (0.085, 0.072, 0.060, 1)
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

# Предмет живёт задолго до финала: проворот начинается на втором экране,
# следом чашка чуть кренится — будто её только что поставили и она качнулась.
# Чашка стоит неподвижно. Прежний медленный проворот с креном имел смысл при
# непрерывном проезде, но в поблочной раскадровке камера внутри блока стоит —
# и предмет, тихо заваливающийся сам по себе, читается ошибкой, а не жизнью.
# Разворот подобран так, чтобы печать смотрела в камеру блока «Налив».
SPIN = math.radians(-106)
LEAN = 0.0
cup.rotation_euler[2] = SPIN
cup.rotation_euler[1] = LEAN
if PROPS:
    cup2.data.materials.append(mat)
# при крене ножка ушла бы в блюдце — приподнимаем на высоту касания
cup.location.z = abs(math.sin(LEAN)) * 0.021
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
if PROPS:
    saucer2.data.materials.append(mat_sa)

# кофе: почти чёрное зеркало, чуть шероховатое — рябь остывающей поверхности
mat_c, nt_c, bsdf_c = new_material("Coffee")
set_input(bsdf_c, "Base Color", (0.012, 0.006, 0.003, 1))
set_input(bsdf_c, "Roughness", 0.055)
set_input(bsdf_c, "IOR", 1.34)
set_input(bsdf_c, "Specular IOR Level", 0.6)
ripple_bump = nt_c.nodes.new("ShaderNodeBump")
# Крупную волну теперь несёт геометрия, здесь остаётся только микро-рябь:
# сильный bump поверх гнутой сетки давал бы двойную рябь и «шевелёнку».
ripple_bump.inputs["Strength"].default_value = 0.04
ripple_wave = nt_c.nodes.new("ShaderNodeTexWave")
ripple_wave.wave_type = "RINGS"
ripple_wave.inputs["Scale"].default_value = 90.0
ripple_wave.inputs["Distortion"].default_value = 4.0
nt_c.links.new(ripple_wave.outputs["Fac"], ripple_bump.inputs["Height"])
nt_c.links.new(ripple_bump.outputs["Normal"], bsdf_c.inputs["Normal"])
coffee.data.materials.append(mat_c)

if PROPS:
    dregs.data.materials.append(mat_c)

    # Сталь бариста: питчер и темпер. Отдельно от материала носика, который
    # живёт только во время налива, — эти предметы стоят на стойке всегда.
    mat_pm, nt_pm, bsdf_pm = new_material("Barware")
    set_input(bsdf_pm, "Base Color", (0.52, 0.53, 0.54, 1))
    set_input(bsdf_pm, "Metallic", 1.0)
    set_input(bsdf_pm, "Roughness", 0.22)
    pm_bump = nt_pm.nodes.new("ShaderNodeBump")
    pm_bump.inputs["Strength"].default_value = 0.06
    pm_scuff = nt_pm.nodes.new("ShaderNodeTexNoise")
    pm_scuff.inputs["Scale"].default_value = 240.0   # затёртости от рук
    nt_pm.links.new(pm_scuff.outputs["Fac"], pm_bump.inputs["Height"])
    nt_pm.links.new(pm_bump.outputs["Normal"], bsdf_pm.inputs["Normal"])
    for o in (pitcher, tamp_base, tamp_grip):
        o.data.materials.append(mat_pm)

    # Бумага салфетки: почти не блестит, чуть просвечивает на просвет
    mat_np, nt_np, bsdf_np = new_material("Napkin")
    # Крафтовая салфетка, не офисный лист: светлая бумага в тёмном кадре
    # мгновенно перетягивает взгляд на себя.
    set_input(bsdf_np, "Base Color", (0.115, 0.098, 0.078, 1))
    set_input(bsdf_np, "Roughness", 0.96)
    set_input(bsdf_np, "Specular IOR Level", 0.18)
    np_bump = nt_np.nodes.new("ShaderNodeBump")
    np_bump.inputs["Strength"].default_value = 0.28
    np_fiber = nt_np.nodes.new("ShaderNodeTexNoise")
    np_fiber.inputs["Scale"].default_value = 380.0
    nt_np.links.new(np_fiber.outputs["Fac"], np_bump.inputs["Height"])
    nt_np.links.new(np_bump.outputs["Normal"], bsdf_np.inputs["Normal"])
    nap_obj.data.materials.append(mat_np)

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

# зерно: тёмная обжарка — почти чёрное, с масляным блеском выступающих мест
# и светлой серебристой плёнкой, оставшейся в жёлобе
if beans:
    mat_bn, nt_bn, bsdf_bn = new_material("Bean")
    # Вогнутость меша даёт бесплатную маску жёлоба: разворачивать UV на два
    # десятка зёрен ради одной полоски было бы расточительством.
    geo_bn = nt_bn.nodes.new("ShaderNodeNewGeometry")
    pointy = nt_bn.nodes.new("ShaderNodeMapRange")
    # Pointiness: 0.5 — плоское место, меньше — вогнутое. Диапазон держим целиком
    # ниже 0.5, иначе гладкий бок зерна (ровно 0.5) попадает в середину маски и
    # красится плёнкой наполовину — зерно выходит цвета молочного шоколада.
    pointy.inputs["From Min"].default_value = 0.40
    pointy.inputs["From Max"].default_value = 0.49
    nt_bn.links.new(geo_bn.outputs["Pointiness"], pointy.inputs["Value"])

    roast = nt_bn.nodes.new("ShaderNodeRGB")
    roast.outputs[0].default_value = (0.048, 0.021, 0.011, 1)
    silverskin = nt_bn.nodes.new("ShaderNodeRGB")
    silverskin.outputs[0].default_value = (0.31, 0.22, 0.15, 1)

    bn_mix = nt_bn.nodes.new("ShaderNodeMix")
    bn_mix.data_type = "RGBA"
    nt_bn.links.new(pointy.outputs["Result"], bn_mix.inputs["Factor"])
    nt_bn.links.new(silverskin.outputs[0], bn_mix.inputs[6])
    nt_bn.links.new(roast.outputs[0], bn_mix.inputs[7])
    nt_bn.links.new(bn_mix.outputs[2], bsdf_bn.inputs["Base Color"])

    # масло выступает на гребнях, в жёлобе поверхность сухая и матовая
    bn_rough = nt_bn.nodes.new("ShaderNodeMix")
    bn_rough.data_type = "FLOAT"
    bn_rough.inputs[2].default_value = 0.78
    bn_rough.inputs[3].default_value = 0.31
    nt_bn.links.new(pointy.outputs["Result"], bn_rough.inputs["Factor"])
    nt_bn.links.new(bn_rough.outputs[0], bsdf_bn.inputs["Roughness"])

    bn_bump = nt_bn.nodes.new("ShaderNodeBump")
    bn_bump.inputs["Strength"].default_value = 0.22
    bn_pore = nt_bn.nodes.new("ShaderNodeTexNoise")
    bn_pore.inputs["Scale"].default_value = 620.0
    bn_pore.inputs["Detail"].default_value = 3.0
    nt_bn.links.new(bn_pore.outputs["Fac"], bn_bump.inputs["Height"])
    nt_bn.links.new(bn_bump.outputs["Normal"], bsdf_bn.inputs["Normal"])

    for b in beans:
        b.data.materials.append(mat_bn)

if FLOW > 0.02:
    # Кофе — не крашеное стекло: он гасит свет по мере прохождения. Поэтому
    # тонкая струя на просвет светится янтарём, а капля покрупнее почти черна.
    # Даёт это объёмное поглощение внутри, а не цвет поверхности.
    mat_l, nt_l, bsdf_l = new_material("Liquid")
    set_input(bsdf_l, "Base Color", (0.055, 0.022, 0.009, 1))
    set_input(bsdf_l, "Roughness", 0.02)
    set_input(bsdf_l, "Transmission Weight", 0.5)
    set_input(bsdf_l, "IOR", 1.34)
    absorb = nt_l.nodes.new("ShaderNodeVolumeAbsorption")
    absorb.inputs["Color"].default_value = (0.80, 0.30, 0.07, 1)
    absorb.inputs["Density"].default_value = 165.0
    out_l = next(n for n in nt_l.nodes if n.type == "OUTPUT_MATERIAL")
    nt_l.links.new(absorb.outputs["Volume"], out_l.inputs["Volume"])
    for o in bpy.data.objects:
        if o.name.startswith(("Stream", "Drop", "Crown", "Splash")):
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
win.data.energy = KEY
win.data.color = (1.0, 0.83, 0.62)
win.rotation_euler = (math.radians(62), 0, math.radians(-36))
win.visible_camera = False

# слабый холодный отражатель спереди — иначе перед предмета уходит в силуэт
bpy.ops.object.light_add(type="AREA", location=(0.5, 0.62, 0.3))
fill_light = bpy.context.object
fill_light.data.shape = "RECTANGLE"
fill_light.data.size = 0.7
fill_light.data.size_y = 0.5
fill_light.data.energy = FILL_LIGHT
fill_light.data.color = (0.72, 0.79, 0.88)
fill_light.rotation_euler = (math.radians(74), 0, math.radians(148))
fill_light.visible_camera = False

# Контровой стрип сзади-справа. Главный инструмент для чёрной глазури: она
# зеркальна, поэтому узкий яркий источник не заливает предмет, а рисует по нему
# вертикальный блик — кромка, изгиб стенки и ручка отделяются от тёмного фона.
# Заливающий свет здесь противопоказан: он делает из чёрной керамики шоколад.
if RIM > 0:
    bpy.ops.object.light_add(type="AREA", location=(0.34, 0.30, 0.26))
    rim = bpy.context.object
    rim.data.shape = "RECTANGLE"
    rim.data.size = 0.03      # узкий: широкий источник даст пятно, а не линию
    rim.data.size_y = 0.42
    rim.data.energy = RIM
    rim.data.color = (1.0, 0.92, 0.80)
    rim.rotation_euler = (math.radians(74), 0, math.radians(132))
    rim.visible_camera = False
    # Ключевой момент: стрип светит ТОЛЬКО в зеркальную составляющую. В диффуз он
    # не бьёт (иначе снова красит чёрную глазурь в шоколад), в объём не бьёт
    # (иначе дымка вспыхивает молоком и съедает тёмный фон). Так он существует
    # в кадре исключительно как отражение — ровно как настоящий софтбокс-стрип,
    # поставленный «в блик», а не «на предмет».
    # NB: diffuse_factor/volume_factor на данных лампы — это Eevee, Cycles их не
    # смотрит. Видимость по типам лучей здесь задаётся на объекте.
    rim.visible_diffuse = False
    rim.visible_volume_scatter = False

    # Стрип светит только на посуду. Ни камень стойки, ни зерно в приёмники не
    # входят: камень он выжигает белой заплатой, а зерно — шероховатое, и
    # зеркальный вклад такой мощности растекается по всей его поверхности,
    # превращая тёмную обжарку в белые камушки (проверено кадром).
    try:
        receivers = bpy.data.collections.new("rim_receivers")
        # Питчер и вторая чашка тоже в приёмниках: без блика металл в тёмной
        # сцене отражает одну темноту и превращается в чёрный силуэт.
        lit = [cup, saucer]
        if PROPS:
            lit += [cup2, saucer2, pitcher, tamp_base, tamp_grip]
        for o in lit:
            receivers.objects.link(o)
        rim.light_linking.receiver_collection = receivers
    except (AttributeError, TypeError) as e:  # noqa: BLE001
        # На всякий случай: без привязки стрип придётся держать слабым.
        print(f"[scene] light linking недоступен ({e}) — понижаю контровой")
        rim.data.energy = min(RIM, 40)

# Отражаемый свод. Кофе — чёрное зеркало, и без объекта над чашкой оно
# показывает пустоту: поверхность выходит угольной дырой, а волны на ней не
# видны вовсе, потому что гнуть в отражении нечего. Эта панель существует
# только ради отражения — в диффуз и в дымку она не бьёт, общей яркости кадра
# не поднимает, но даёт кофе светлую полосу, которую ломает каждая волна.
if CEIL > 0:
    # Ставится не «над чашкой», а туда, куда уходит отражённый луч: камера
    # смотрит на кофе спереди-сверху, значит зеркало показывает ей то, что
    # находится СЗАДИ и выше. Панель прямо над головой в отражение не попадает
    # вовсе — проверено кадром, поверхность оставалась угольной.
    bpy.ops.object.light_add(type="AREA", location=(-0.085, 0.265, 0.400))
    ceil = bpy.context.object
    ceil.data.shape = "RECTANGLE"
    # Размер решает не меньше энергии: панель во всю поверхность отражается
    # сплошной заливкой и кофе читается молоком. Нужна полоса — тогда часть
    # зеркала остаётся чёрной, а свет ломается волнами по светлой дорожке.
    ceil.data.size = 0.115
    ceil.data.size_y = 0.032
    ceil.data.energy = CEIL
    ceil.data.color = (1.0, 0.90, 0.76)
    ceil.rotation_euler = (math.radians(34), 0, math.radians(-6))
    ceil.visible_camera = False
    ceil.visible_diffuse = False
    ceil.visible_volume_scatter = False


# ── атмосфера ────────────────────────────────────────────────────────────────
# Воздух не пустой: тонкая дымка ловит луч из окна и даёт кадру глубину.
# Плотность намеренно мизерная — нужен намёк на объём, а не туман.
vol = wnt.nodes.new("ShaderNodeVolumeScatter")
vol.inputs["Density"].default_value = 0.055
vol.inputs["Anisotropy"].default_value = 0.35
vol.inputs["Color"].default_value = (0.85, 0.78, 0.68, 1)
wnt.links.new(vol.outputs["Volume"], wout.inputs["Volume"])

# Стена за стойкой — кладка из иерусалимского камня (легенда бренда: первый
# этаж дома 1920-х). Стену придвинули с 1.9 м до 0.62: на прежнем расстоянии
# она была вне глубины резкости и работала просто тёмным фоном, а нужен
# читаемый ряд блоков в мягком расфокусе — он и делает из пустоты помещение.
bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0.62, 0))
back = bpy.context.object
back.name = "BackWall"
back.rotation_euler = (math.radians(90), 0, 0)
mat_b, nt_b, bsdf_b = new_material("Wall")
set_input(bsdf_b, "Roughness", 0.94)

# Кладка: кирпичная текстура даёт и цвет блоков, и швы между ними. Камень
# тёплый, но держим его тёмным — светлая стена спорит с чёрной посудой.
brick = nt_b.nodes.new("ShaderNodeTexBrick")
brick.inputs["Color1"].default_value = (0.150, 0.122, 0.093, 1)
brick.inputs["Color2"].default_value = (0.115, 0.093, 0.070, 1)
brick.inputs["Mortar"].default_value = (0.052, 0.044, 0.035, 1)
brick.inputs["Scale"].default_value = 1.45
brick.inputs["Mortar Size"].default_value = 0.013
brick.inputs["Mortar Smooth"].default_value = 0.35
brick.inputs["Bias"].default_value = -0.10
brick.inputs["Brick Width"].default_value = 0.62      # блок вытянут по горизонтали
brick.inputs["Row Height"].default_value = 0.26
brick_coord = nt_b.nodes.new("ShaderNodeTexCoord")
nt_b.links.new(brick_coord.outputs["Object"], brick.inputs["Vector"])

# Пятнистость камня поверх кладки: ровный цвет блока выдаёт процедуру
stain = nt_b.nodes.new("ShaderNodeTexNoise")
stain.inputs["Scale"].default_value = 5.5
stain.inputs["Detail"].default_value = 7.0
stain_mix = nt_b.nodes.new("ShaderNodeMix")
stain_mix.data_type = "RGBA"
stain_mix.inputs["Factor"].default_value = 0.22
nt_b.links.new(brick.outputs["Color"], stain_mix.inputs[6])
darker = nt_b.nodes.new("ShaderNodeRGB")
darker.outputs[0].default_value = (0.042, 0.034, 0.026, 1)
nt_b.links.new(darker.outputs[0], stain_mix.inputs[7])
nt_b.links.new(stain.outputs["Fac"], stain_mix.inputs["Factor"])
nt_b.links.new(stain_mix.outputs[2], bsdf_b.inputs["Base Color"])

# Рельеф: швы утоплены (по маске кладки), поверх — крупная шероховатость камня
wall_bump = nt_b.nodes.new("ShaderNodeBump")
wall_bump.inputs["Strength"].default_value = 0.62
seam = nt_b.nodes.new("ShaderNodeMix")
seam.data_type = "FLOAT"
seam.inputs[2].default_value = 0.0
seam.inputs[3].default_value = 1.0
nt_b.links.new(brick.outputs["Fac"], seam.inputs["Factor"])
wall_noise = nt_b.nodes.new("ShaderNodeTexNoise")
wall_noise.inputs["Scale"].default_value = 26.0
wall_noise.inputs["Detail"].default_value = 6.0
rough_stone = nt_b.nodes.new("ShaderNodeMix")
rough_stone.data_type = "FLOAT"
rough_stone.inputs["Factor"].default_value = 0.30
nt_b.links.new(seam.outputs[0], rough_stone.inputs[2])
nt_b.links.new(wall_noise.outputs["Fac"], rough_stone.inputs[3])
nt_b.links.new(rough_stone.outputs[0], wall_bump.inputs["Height"])
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

# ── камера ──────────────────────────────────────────────────────────────────
# Раскадровка и хореография объявлены в начале файла: по ним же считается
# пересчёт прокрутки в фазу, а он нужен раньше, чем строится геометрия.
frm, to, tt = choreography(PHASE)
mix3 = lambda k: tuple(lerp(frm[k][j], to[k][j], tt) for j in range(3))
cam_pos = mix3("cam")
look_at = mix3("look")

bpy.ops.object.camera_add(location=cam_pos)
cam = bpy.context.object
scene.camera = cam
cam.data.lens = lerp(frm["lens"], to["lens"], tt)
cam.data.sensor_width = 36
# сдвиг кадра вместо доворота: перспектива предмета не искажается,
# а сбоку освобождается место под текст
cam.data.shift_x = lerp(frm["shift"], to["shift"], tt)
cam.data.dof.use_dof = True
cam.data.dof.aperture_fstop = lerp(frm["fstop"], to["fstop"], tt)

target = bpy.data.objects.new("Target", None)
bpy.context.collection.objects.link(target)
target.location = look_at

# Отладочный ракурс: посмотреть на кусок сцены, не трогая хореографию.
#   --peek beans   россыпь зерна крупно
PEEK = arg("--peek", "none")
if PEEK == "beans":
    target.location = (0.105, -0.028, 0.004)
    # 85 мм с тридцати сантиметров: кадр шириной ~10 см — россыпь целиком.
    # Ближе подходить нельзя: на 15 см это уже макро 1.3:1, где резкости
    # остаются доли миллиметра и вся россыпь плывёт независимо от диафрагмы.
    cam.location = (0.020, -0.300, 0.075)
    cam.data.lens = 85
    cam.data.shift_x = 0.0
    cam.data.dof.aperture_fstop = 5.6
elif PEEK == "top":
    # взгляд в чашку: проверять поверхность кофе и корону всплеска
    target.location = (0, 0, level)
    cam.location = (0.045, -0.105, level + 0.115)
    cam.data.lens = 70
    cam.data.shift_x = 0.0
    cam.data.dof.aperture_fstop = 6.0
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
scene.view_settings.exposure = EXPOSURE

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
print(f"[scene] scroll={SCROLL:.4f} phase={PHASE:.4f} fill={FILL:.2f} flow={FLOW:.2f}")
bpy.ops.render.render(write_still=True)
print(f"[scene] saved {OUT}")
