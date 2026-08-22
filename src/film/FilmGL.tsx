import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Скролл-плёнка на WebGL: кадры из Cycles крутятся прокруткой, но сверх этого
 * сцена отвечает на курсор — и отвечает как объём, а не как картинка.
 *
 * Как это возможно у пререндера. Вместе с каждым кадром Cycles отдаёт вторую,
 * служебную карту (`public/film-aux`): в красном канале — расстояние от
 * камеры, в зелёном — номер предмета, которому принадлежит пиксель. Браузер
 * читает её тем же шейдером, что и картинку, и поэтому знает три вещи,
 * которых плоская плёнка знать не может:
 *
 *   • что ближе, а что дальше — предметы расходятся при движении курсора с
 *     разной скоростью, как при настоящем смещении камеры;
 *   • что именно лежит под курсором — свет ложится по контуру чашки, а не
 *     круглым пятном рядом с ней;
 *   • где поверхность, по которой идёт волна от нажатия.
 *
 * Прошлая версия считала положение предметов проекцией камеры заранее
 * (`bake_hotspots.py`). Математика была верной, но жила отдельно от кадра:
 * зоны разъезжались с картинкой на пару процентов, попасть в них курсором
 * было почти нельзя, и эффект, сделанный и выложенный, Томер так и не увидел.
 * Маска приходит из того же рендера, что и пиксели, поэтому разъехаться с
 * ними уже не может.
 *
 * Плёнка при этом остаётся плёнкой: прокрутку движок ЧИТАЕТ, а не перехватывает.
 */

interface Props {
  count: number
  progressRef: React.RefObject<number>
  /** папка с кадрами; на десктопе — крупная плёнка, на телефоне лёгкая */
  base?: string
  /** папка с картами глубины; без них эффекты вырождаются в мягкий сдвиг */
  auxBase?: string
  paused?: boolean
  /** отключить реакцию на курсор (например, при prefers-reduced-motion) */
  still?: boolean
  /** WebGL не поднялся — страница должна показать обычную плёнку, а не пустоту */
  onFail?: () => void
}

const BATCH = 8
// Сколько кадров по обе стороны от текущего держать распакованными.
// 33 кадра x 13 МБ = 433 МБ вместо 1 871 МБ на всю плёнку.
const WINDOW = 16
// Сколько кадров распаковывать за один проход обслуживания окна.
// Распаковка стоит ~15 мс; пачкой она даёт всплески по 80-120 мс.
const DECODES_PER_PASS = 3
const SMOOTH = 0.16
const DPR_CAP = 1.5
const MAX_RIPPLES = 4
/** номера предметов из render/scene.py: 1 — чашка, 2 — кофе, 3 — зерно… */
const ID_CUP = 1
/** размер служебной канвы, на которой JS читает маску под курсором */
const PROBE_W = 160
const PROBE_H = 90

const framePath = (base: string, i: number) => `${base}frame-${String(i).padStart(3, '0')}.webp`
const auxPath = (base: string, i: number) => `${base}aux-${String(i).padStart(3, '0')}.webp`
const flowPath = (base: string, i: number) => `${base}flow-${String(i).padStart(3, '0')}.webp`
/** масштаб кодирования карт движения — должен совпадать с render/pack_flow.py */
const FLOW_RANGE = 96

const VERT = `#version 300 es
in vec2 pos;
out vec2 uv;
void main() {
  uv = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;

in vec2 uv;
out vec4 color;

uniform sampler2D frame;
// Следующий кадр плёнки и доля перехода к нему. Без этой пары кадр
// переключался целым номером, и на прокрутке движение шло ступенями — при
// 144 кадрах на несколько экранов ступень видна глазом как дёрганье.
// Смешивание двух соседних кадров превращает лестницу в непрерывное движение.
uniform sampler2D frameNext;
uniform float frameMix;
// Карта движения между текущим кадром и следующим: куда уехал каждый кусок
// картинки. Нужна, потому что соседние кадры расходятся на 20-30 пикселей, а
// простое перетекание читается движением только пока разрыв 2-3 px. На нашем
// разрыве глаз видел не движение, а два наложенных изображения — надпись на
// чашке двоилась при прокрутке.
uniform sampler2D flowMap;
uniform float flowRange;   // масштаб кодирования карты, в пикселях кадра
uniform float hasFlow;
// Одна и та же карта заведена дважды: глубину надо читать сглаженно, иначе
// ступени округления видны как полосы, а номер предмета — наоборот, точно,
// иначе на границе чашки появляется предмет с номером «два с половиной».
uniform sampler2D auxSmooth;  // R — глубина
uniform sampler2D auxSharp;   // G — номер предмета / 8
uniform vec2 canvasSize;
uniform vec2 frameSize;
uniform vec2 cursorUV;      // 0..1 в координатах канвы, y снизу
uniform float cursorLive;   // 0 — курсора нет, 1 — есть
uniform float hasAux;       // карта глубины загружена
uniform vec4 ripples[${MAX_RIPPLES}];  // xy — центр в координатах кадра, z — возраст, w — активна
uniform vec4 cup;           // xy — центр чашки в кадре, z — полуширина, w — крупно ли она в кадре
uniform float hoverId;      // номер предмета под курсором, 0 — фон
uniform float hoverAmt;     // сила наведения, нарастает и гаснет плавно
uniform vec2 hit;           // x — номер предмета по нажатию, y — возраст удара в секундах
uniform float time;

/** Кадр плёнки в точке: два соседних снимка, смешанных по дробной части позиции. */
vec3 sampleFilm(vec2 p) {
  vec3 a = texture(frame, p).rgb;
  if (frameMix <= 0.001) return a;

  if (hasFlow < 0.5) return mix(a, texture(frameNext, p).rgb, frameMix);

  float t = frameMix;

  // Смещение в этой точке. Карта хранит его вокруг середины диапазона:
  // 128 — ноль, края — плюс-минус flowRange пикселей.
  vec2 raw = (texture(flowMap, p).rg - 128.0 / 255.0) * (255.0 / 127.0);
  vec2 f = raw * flowRange / frameSize;
  // Кадры декодируются перевёрнутыми по вертикали, а поток считался по
  // исходным: по Y знак противоположный.
  f.y = -f.y;

  // Насколько потоку можно верить. На быстрых участках камеры смещение
  // доходит до сотни пикселей, там за краем движущегося предмета попросту
  // нет данных — что бы мы ни сдвигали, получится каша. В таких местах
  // честнее показать один кадр резким, чем два размазанными.
  float px = length(f * frameSize);
  float trust = 1.0 - smoothstep(55.0, 105.0, px);
  if (trust < 0.02) return t < 0.5 ? a : texture(frameNext, p).rgb;

  // Каждый кадр сдвигается навстречу другому на свою долю пути — и совпадают
  // они уже в промежуточном положении, а не накладываются в исходных.
  vec3 aw = texture(frame,     p - f * t).rgb;
  vec3 bw = texture(frameNext, p + f * (1.0 - t)).rgb;
  vec3 warped = mix(aw, bw, t);

  // Плавный переход к обычному перетеканию там, где потоку веры мало.
  vec3 plain = mix(a, texture(frameNext, p).rgb, t);
  return mix(plain, warped, trust);
}

/**
 * Насколько далеко предметы расходятся за курсором: разница глубин × это.
 *
 * История величины: 0.075 разваливал чашку на части (см. depthSoft ниже), 0.04
 * контуры сохранял, но предмет заметно менял форму — Томер видел, как чашку
 * «ведёт матрицей». Эффект должен быть на грани различимости: сцена чуть
 * дышит вслед за курсором, и всё. Больше — уже не глубина, а кривое зеркало.
 */
const float PARALLAX = 0.012;
/** дальше этой разницы глубин смещение не растёт — страховка от того же */
const float MAX_DEPTH_GAP = 0.4;
/** уровень mip-цепочки, с которого читается глубина для смещения */
const float DEPTH_LOD = 4.0;

// Простой value-noise и фрактальная сумма: пар должен клубиться, а не ползти
// однородным пятном.
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.02; a *= 0.5; }
  return v;
}

/** cover-фит: канва и кадр почти никогда не совпадают по пропорциям */
vec2 coverUV(vec2 p) {
  float canvasAspect = canvasSize.x / canvasSize.y;
  float frameAspect = frameSize.x / frameSize.y;
  vec2 scale = canvasAspect > frameAspect
    ? vec2(1.0, frameAspect / canvasAspect)
    : vec2(canvasAspect / frameAspect, 1.0);
  return (p - 0.5) * scale + 0.5;
}

/** за краями кадра тянем крайний пиксель, чтобы сдвиг не оголял фон */
vec2 hold(vec2 t) {
  return clamp(t, vec2(0.0005), vec2(0.9995));
}

float depthAt(vec2 t) {
  return hasAux > 0.5 ? texture(auxSmooth, hold(t)).r : 0.5;
}

/**
 * Глубина для смещения читается СГЛАЖЕННОЙ — с четвёртого уровня mip-цепочки
 * (карта 512 px, значит смещение считается по картинке в 32 px).
 *
 * По резкой карте на силуэте предмета глубина прыгает сразу на всю разницу:
 * чашка стоит на 0,4, стена за ней на 0,95. Соседние пиксели по разные
 * стороны контура уезжают в противоположные стороны на десятки пикселей — и
 * контур раздваивается: «стенка выходит из стенки», ручка обрывается, край
 * блюдца превращается в пилу. Ехать должны плоскости целиком, а не края
 * предметов относительно самих себя, поэтому смещение берётся по мягкому
 * полю глубины, а сама картинка при этом остаётся резкой.
 *
 * Мягкость выбрана по нижней границе: mip 3 ещё оставлял «расчёску» на
 * кромке чашки, mip 5 уже заметно раздувал её форму.
 */
float depthSoft(vec2 t) {
  return hasAux > 0.5 ? textureLod(auxSmooth, hold(t), DEPTH_LOD).r : 0.5;
}

/** номер предмета в точке кадра: 0 — фон, 1 — чашка, 2 — кофе… */
float objectAt(vec2 t) {
  return hasAux > 0.5 ? texture(auxSharp, hold(t)).g * 8.0 : 0.0;
}

/**
 * Принадлежит ли точка предмету — с мягким краем. Маска втрое мельче кадра,
 * и жёсткое сравнение дало бы по контуру чашки лесенку из крупных ступеней.
 * Пять проб вокруг точки превращают ступень в полупиксельную растушёвку.
 */
float objectMask(vec2 t, float id) {
  if (id < 0.5 || hasAux < 0.5) return 0.0;
  vec2 e = 1.4 / vec2(textureSize(auxSharp, 0));
  float s = step(abs(objectAt(t) - id), 0.35) * 2.0;
  s += step(abs(objectAt(t + vec2(e.x, 0.0)) - id), 0.35);
  s += step(abs(objectAt(t - vec2(e.x, 0.0)) - id), 0.35);
  s += step(abs(objectAt(t + vec2(0.0, e.y)) - id), 0.35);
  s += step(abs(objectAt(t - vec2(0.0, e.y)) - id), 0.35);
  return s / 6.0;
}

void main() {
  float frameAspect = frameSize.x / frameSize.y;

  // Лёгкий зум обязателен: без него сдвиг оголяет края кадра.
  vec2 p = (uv - 0.5) / 1.045 + 0.5;
  vec2 base = coverUV(p);

  // Направление взгляда и глубина точки, на которую смотрит курсор. Всё, что
  // ближе неё, поедет в одну сторону, всё, что дальше — в другую: так ведёт
  // себя настоящая сцена, когда камера чуть сдвигается вбок.
  vec2 aim = (cursorUV - 0.5) * 2.0 * cursorLive;
  float focus = depthSoft(coverUV(cursorUV));

  vec2 t = base;
  if (hasAux > 0.5) {
    // Один проход, без уточняющих итераций. Прежде их было три — они искали
    // точку, которая после смещения окажется ровно под этим пикселем, но у
    // края предмета такой поиск не сходится, а начинает прыгать между двумя
    // ответами, и кромка чашки покрывалась поперечной «расчёской». Одна
    // выборка даёт заведомо непрерывное поле смещения; неточность на доли
    // пикселя глаз не различает, а разрывы — различает сразу.
    float gap = clamp(depthSoft(base) - focus, -MAX_DEPTH_GAP, MAX_DEPTH_GAP);
    t = base + aim * PARALLAX * gap;
  } else {
    t = base - aim * 0.012;
  }

  // Волна от нажатия идёт по поверхности от точки клика. Центр записан в
  // координатах кадра, поэтому волна остаётся на своём месте в сцене, даже
  // когда картинка едет за курсором.
  float glow = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    if (ripples[i].w < 0.5) continue;
    vec2 d = t - ripples[i].xy;
    d.x *= frameAspect;                   // круг остаётся кругом
    float dist = length(d);
    float age = ripples[i].z;
    float front = age * 0.42;             // скорость фронта
    float band = dist - front;
    // Ближнее к камере качается сильнее — дальний план почти стоит. Глубина
    // здесь тоже мягкая: по резкой карте волна рвала бы контур предмета, через
    // который проходит, ровно так же, как это делал параллакс.
    float near = mix(1.0, clamp(1.25 - depthSoft(t), 0.2, 1.0), hasAux);
    float ring = exp(-band * band * 900.0) * exp(-age * 2.2) * exp(-dist * 1.6) * near;
    t += normalize(d + 1e-6) * ring * 0.02;
    glow += ring;
  }

  // Предмет под курсором: подсвечиваем ровно его пиксели, а не круг рядом.
  float same = objectMask(t, hoverId) * hoverAmt;

  // Нажатие: предмет коротко вздрагивает и ловит свет.
  float pulse = objectMask(t, hit.x) * exp(-hit.y * 3.4) * sin(hit.y * 17.0);

  t.y += same * 0.0016 + pulse * 0.0028;

  vec3 rgb = sampleFilm(hold(t));

  // На мониторе кадр всегда растягивается: плёнка в 1600 px против канвы в
  // 1920 и больше. Растяжение съедает определённость краёв, и сцена читается
  // замыленной. Лёгкий контурный шарпен возвращает их — деталей он не
  // добавляет, но ощущение мыла снимает.
  //
  // Включается только там, где растяжение действительно есть: на телефоне
  // кадр вдвое крупнее канвы, там подчёркивать нечего. В тенях приглушён —
  // иначе вместо камня подчёркивался бы шум рендера.
  float grow = smoothstep(1.05, 1.35, canvasSize.x / frameSize.x);
  if (grow > 0.001) {
    vec2 texel = 1.0 / frameSize;
    vec3 around = (sampleFilm(hold(t + vec2(texel.x, 0.0)))
                 + sampleFilm(hold(t - vec2(texel.x, 0.0)))
                 + sampleFilm(hold(t + vec2(0.0, texel.y)))
                 + sampleFilm(hold(t - vec2(0.0, texel.y)))) * 0.25;
    float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
    rgb += (rgb - around) * 0.55 * grow * smoothstep(0.04, 0.26, lum);
  }

  // Пар над чашкой. На компьютере он поднимается, когда курсор на чашке; на
  // телефоне наведения нет, поэтому пар включается сам, когда чашка выходит
  // в кадре крупно — иначе эффекта не существовало бы вовсе.
  // Сила пара зависит от того, на чашке ли курсор — а не от того, чашка ли
  // под этим пикселем: пар поднимается над кромкой, где никакой чашки уже нет.
  float cupHover = step(abs(hoverId - ${ID_CUP}.0), 0.35) * hoverAmt;
  float steamAmt = max(cupHover, cup.w * 0.6);
  float steam = 0.0;
  if (steamAmt > 0.01 && cup.z > 0.001) {
    vec2 q = (t - cup.xy) / cup.z;
    q.x *= frameAspect;
    if (q.y > -0.05 && q.y < 2.6) {
      float rise = q.y + 0.05;
      // Струйка не поднимается отвесной колонной: она уводится вбок тем
      // сильнее, чем выше, и сам увод медленно качается. Без этого пар читается
      // столбом дыма из трубы, а не воздухом над чашкой.
      float drift = sin(rise * 1.7 + time * 0.55) * 0.20 * rise;
      float across = exp(-pow((q.x - drift) / (0.32 + rise * 0.50), 2.0));
      // Появляется вплотную к кромке и гаснет вдвое ближе прежнего: высокий
      // пар над маленькой чашкой выглядит спецэффектом.
      float fade = smoothstep(0.0, 0.12, rise) * exp(-rise * 1.05);
      float n = fbm(vec2(q.x * 3.2, q.y * 2.0 - time * 0.50));
      float m = fbm(vec2(q.x * 6.4 + 7.3, q.y * 3.6 - time * 0.76));
      // Порог мягкий: жёсткий давал ватные хлопья с рваным краем, а пар — это
      // плотность, а не форма.
      float puff = smoothstep(0.28, 0.74, n * 0.62 + m * 0.38);
      steam = puff * across * fade * steamAmt;
    }
  }

  float luma = dot(rgb, vec3(0.299, 0.587, 0.114));
  // Свет по предмету ложится сильнее там, где он и так светлее — иначе
  // подсветка читается как наклейка поверх кадра. Доля намеренно скромная:
  // предмет должен «отозваться», а не вспыхнуть.
  rgb += vec3(0.42, 0.32, 0.20) * same * (0.05 + luma * 0.75) * 0.38;
  rgb += vec3(0.55, 0.42, 0.30) * glow * 0.30;
  rgb += vec3(0.60, 0.48, 0.34) * abs(pulse) * 0.22;
  // Пар не белый и не плотный: над тёмной сценой даже половинная яркость
  // читается привидением. Он лишь подсвечивает воздух.
  rgb += vec3(0.74, 0.70, 0.66) * steam * 0.40;

  color = vec4(rgb, 1.0);
}`

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('shader:', gl.getShaderInfoLog(sh))
    gl.deleteShader(sh)
    return null
  }
  return sh
}

/** Чашка на кадре: центр, полуширина и то, насколько крупно она стоит. */
interface CupBox {
  x: number
  y: number
  half: number
  big: number
}

export function FilmGL({ count, progressRef, base, auxBase, paused = false, still = false, onFail }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const frames = useRef<(ImageBitmap | null)[]>([])
  const auxes = useRef<(ImageBitmap | null)[]>([])
  // Скачанные, но ещё не распакованные кадры. Blob лежит сжатым (вся плёнка
  // ~12 МБ), ImageBitmap — распакованным (13 МБ на кадр). Держать распакованными
  // все 144 значило 1,9 ГБ на вкладку; теперь распакованы только соседние.
  const blobs = useRef<(Blob | null)[]>([])
  const auxBlobs = useRef<(Blob | null)[]>([])
  const flows = useRef<(ImageBitmap | null)[]>([])
  const flowBlobs = useRef<(Blob | null)[]>([])
  const decoding = useRef<Set<number>>(new Set())
  const current = useRef(0)
  const [ready, setReady] = useState(0)
  const [fallback, setFallback] = useState(false)

  // курсор в координатах канвы (0..1, y снизу) — в том же виде уходит в шейдер
  const cursor = useRef({ u: 0.5, v: 0.5, tu: 0.5, tv: 0.5, live: 0 })
  const ripples = useRef<{ x: number; y: number; born: number }[]>([])
  const hovered = useRef({ id: 0, amt: 0 })
  const hit = useRef({ id: 0, born: -1e9 })
  const [overObject, setOverObject] = useState(false)
  const overRef = useRef(false)

  const root = base ?? `${import.meta.env.BASE_URL}film/`
  const auxRoot = auxBase ?? `${import.meta.env.BASE_URL}film-aux/`
  const flowRoot = `${import.meta.env.BASE_URL}film-flow/`

  // ── распаковка по требованию ────────────────────────────────────────────
  // Blob'ы качаются все и сразу, а распаковываются только вокруг текущего
  // места. Раньше распакованными держались все 144 кадра — 1,9 ГБ на вкладку,
  // из-за чего страница «долго открывается» и подтормаживает на слабой машине.

  const decodeFrame = useCallback(async (i: number) => {
    if (frames.current[i] || decoding.current.has(i)) return
    const b = blobs.current[i]
    if (!b) return
    decoding.current.add(i)
    try {
      frames.current[i] = await createImageBitmap(b, { imageOrientation: 'flipY' })
    } catch {
      /* битый кадр — пропускаем, nearest возьмёт соседний */
    } finally {
      decoding.current.delete(i)
    }
  }, [])

  const decodeAux = useCallback(async (i: number) => {
    const key = i + 100000 // отдельное пространство ключей от кадров
    if (auxes.current[i] || decoding.current.has(key)) return
    const b = auxBlobs.current[i]
    if (!b) return
    decoding.current.add(key)
    try {
      auxes.current[i] = await createImageBitmap(b, { imageOrientation: 'flipY' })
    } catch {
      /* без карты глубины сцена рисуется, просто без объёма */
    } finally {
      decoding.current.delete(key)
    }
  }, [])

  const decodeFlow = useCallback(async (i: number) => {
    const key = i + 200000
    if (flows.current[i] || decoding.current.has(key)) return
    const b = flowBlobs.current[i]
    if (!b) return
    decoding.current.add(key)
    try {
      flows.current[i] = await createImageBitmap(b, { imageOrientation: 'flipY' })
    } catch {
      /* без карты движения кадры просто перетекают, как раньше */
    } finally {
      decoding.current.delete(key)
    }
  }, [])

  /** Держит распакованными кадры вокруг center, остальные отпускает. */
  const maintainWindow = useCallback(
    (center: number, total: number) => {
      const lo = center - WINDOW
      const hi = center + WINDOW

      // Сначала освобождаем вышедшее из окна, потом добираем недостающее —
      // и добираем понемногу. Распаковка кадра стоит ~15 мс; если запустить
      // её сразу на всё окно (а при быстрой прокрутке окно обновляется целиком),
      // очередь декодера забивается и появляются всплески по 80-120 мс.
      // Ближние кадры важнее дальних, поэтому идём от центра наружу.
      let budget = DECODES_PER_PASS
      const want: number[] = []
      for (let d = 0; d <= WINDOW; d++) {
        for (const i of d === 0 ? [center] : [center - d, center + d]) {
          if (i >= 0 && i < total) want.push(i)
        }
      }

      for (let i = 0; i < total; i++) {
        if (i >= lo && i <= hi) {
          // распаковкой займёмся ниже, по бюджету
        } else {
          const f = frames.current[i]
          if (f) {
            f.close()
            frames.current[i] = null
          }
          const a = auxes.current[i]
          if (a) {
            a.close()
            auxes.current[i] = null
          }
          const fl = flows.current[i]
          if (fl) {
            fl.close()
            flows.current[i] = null
          }
        }
      }

      for (const i of want) {
        if (budget <= 0) break
        if (!frames.current[i] && !decoding.current.has(i)) {
          void decodeFrame(i)
          budget--
        }
      }
      // Карты глубины лёгкие (512 px), но и их незачем распаковывать пачкой.
      let auxBudget = DECODES_PER_PASS
      for (const i of want) {
        if (auxBudget <= 0) break
        if (!auxes.current[i] && !decoding.current.has(i + 100000)) {
          void decodeAux(i)
          auxBudget--
        }
      }
      // Карты движения — 320 px, распаковка почти бесплатная.
      let flowBudget = DECODES_PER_PASS * 2
      for (const i of want) {
        if (flowBudget <= 0) break
        if (!flows.current[i] && !decoding.current.has(i + 200000)) {
          void decodeFlow(i)
          flowBudget--
        }
      }
    },
    [decodeFrame, decodeAux, decodeFlow],
  )

  // ── загрузка кадров и карт глубины пачками ──────────────────────────────
  useEffect(() => {
    // Фиксируем ссылки на массивы: cleanup должен отпускать именно те кадры,
    // которые завёл этот прогон эффекта, а не то, что окажется в ref потом.
    const frameList: (ImageBitmap | null)[] = new Array(count).fill(null)
    const auxList: (ImageBitmap | null)[] = new Array(count).fill(null)
    const flowList: (ImageBitmap | null)[] = new Array(count).fill(null)
    frames.current = frameList
    auxes.current = auxList
    flows.current = flowList
    const decodingSet = decoding.current
    let cancelled = false
    let loaded = 0

    // Скачиваем сжатый blob и кладём в кэш. Распаковкой занимается окно ниже:
    // держать распакованными все кадры сразу — 1,9 ГБ, вкладка начинает
    // свопиться и страница «долго открывается».
    const fetchBlob = (src: string, keep: (b: Blob) => void) =>
      fetch(src)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('нет кадра'))))
        .then(keep)
        .catch(() => {})

    // Порядок загрузки — от того места, где человек стоит, а не от начала
    // плёнки. При обновлении страницы браузер возвращает прокрутку на середину,
    // и последовательная загрузка с нуля означала, что нужный кадр приедет
    // последним: до этого сцена показывала начало и потом рывком догоняла.
    // Сначала вперёд по ходу чтения, следом назад — возврат вверх тоже бывает.
    const startAt = Math.round((progressRef.current ?? 0) * (count - 1))
    const order: number[] = []
    for (let d = 0; d < count; d++) {
      const ahead = startAt + d
      const behind = startAt - d
      if (ahead < count) order.push(ahead)
      if (d > 0 && behind >= 0) order.push(behind)
    }

    const loadBatch = async (from: number) => {
      if (cancelled || from >= order.length) return
      await Promise.all(
        order.slice(from, from + BATCH).map((i) =>
          fetchBlob(framePath(root, i), (b) => {
            blobs.current[i] = b
            loaded += 1
            if (!cancelled) setReady(loaded)
            // Первые кадры вокруг стартовой позиции распаковываем сразу,
            // не дожидаясь цикла отрисовки — иначе первый экран пустой.
            if (Math.abs(i - startAt) <= 2) void decodeFrame(i)
          }),
        ),
      )
      loadBatch(from + BATCH)
    }
    loadBatch(0)

    // Карты глубины идут следом за кадрами: они лёгкие, но картинка важнее.
    const loadAux = async (from: number) => {
      if (cancelled || from >= order.length) return
      await Promise.all(
        order.slice(from, from + BATCH).map((i) =>
          fetchBlob(auxPath(auxRoot, i), (b) => {
            auxBlobs.current[i] = b
          }),
        ),
      )
      loadAux(from + BATCH)
    }
    setTimeout(() => loadAux(0), 400)

    // Карты движения — данные того же порядка, что и глубина: 12 КБ на кадр.
    const loadFlow = async (from: number) => {
      if (cancelled || from >= order.length) return
      await Promise.all(
        order.slice(from, from + BATCH).map((i) =>
          fetchBlob(flowPath(flowRoot, i), (b) => {
            flowBlobs.current[i] = b
          }),
        ),
      )
      loadFlow(from + BATCH)
    }
    setTimeout(() => loadFlow(0), 600)

    return () => {
      cancelled = true
      // Отпускаем распакованные кадры: без close() они висят до сборки мусора,
      // а это сотни мегабайт.
      for (const list of [frameList, auxList, flowList]) {
        list.forEach((b) => b?.close?.())
        list.fill(null)
      }
      blobs.current = []
      auxBlobs.current = []
      flowBlobs.current = []
      decodingSet.clear()
    }
  }, [count, root, auxRoot, flowRoot, progressRef, decodeFrame])

  // ── ввод ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (still) return
    const el = canvas.current
    if (!el) return

    const move = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect()
      cursor.current.tu = (cx - r.left) / r.width
      cursor.current.tv = 1 - (cy - r.top) / r.height
      cursor.current.live = 1
    }
    const onMouse = (e: MouseEvent) => move(e.clientX, e.clientY)
    const onLeave = () => {
      cursor.current.live = 0
      cursor.current.tu = 0.5
      cursor.current.tv = 0.5
    }
    const onDown = (e: PointerEvent) => {
      // Палец курсором не работает. Прокрутка на телефоне начинается с
      // касания, поэтому прежде сцена считала точку касания «курсором» и
      // держала её там навсегда: параллакс включался на весь экран от
      // случайной точки и никогда не гас. Волна от нажатия остаётся — она и
      // задумана как отклик именно на касание.
      if (e.pointerType !== 'touch') move(e.clientX, e.clientY)
      // Точку удара пересчитаем в координаты кадра в цикле отрисовки, где
      // известен cover-фит; здесь запоминаем только момент и место на канве.
      const r = el.getBoundingClientRect()
      ripples.current.push({
        x: (e.clientX - r.left) / r.width,
        y: 1 - (e.clientY - r.top) / r.height,
        born: -1, // −1 значит «ещё не переведено в координаты кадра»
      })
      if (ripples.current.length > MAX_RIPPLES) ripples.current.shift()
    }

    window.addEventListener('mousemove', onMouse, { passive: true })
    window.addEventListener('mouseout', onLeave)
    window.addEventListener('pointerdown', onDown, { passive: true })
    return () => {
      window.removeEventListener('mousemove', onMouse)
      window.removeEventListener('mouseout', onLeave)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [still])

  // Колбэк живёт в ref и не попадает в зависимости отрисовки.
  //
  // Иначе получалась цепочка, которая и делала плёнку дёрганой: `onFail`
  // приходит новой стрелкой на каждый рендер, каждый загруженный кадр двигает
  // счётчик `ready` → рендер → эффект пересобирается → cleanup гасит контекст
  // (`loseContext`) → следующий `getContext` отдаёт уже мёртвый → компонент
  // тихо падает на запасную плёнку, а она показывает целые кадры без
  // смешивания. То есть весь WebGL-путь умирал молча на первых же секундах.
  const onFailRef = useRef(onFail)
  useEffect(() => {
    onFailRef.current = onFail
  }, [onFail])

  // ── отрисовка ───────────────────────────────────────────────────────────
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const gl = el.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance' })
    if (!gl) {
      setFallback(true)
      onFailRef.current?.()
      return
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
    if (!vs || !fs) {
      setFallback(true)
      onFailRef.current?.()
      return
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      setFallback(true)
      onFailRef.current?.()
      return
    }
    gl.useProgram(prog)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'pos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    // Кадры приходят уже перевёрнутыми (imageOrientation: 'flipY' при
    // создании ImageBitmap), поэтому здесь переворачивать нечего: строка ноль
    // текстуры — это низ кадра, как и ждёт UV-пространство WebGL.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)

    // mip: карте глубины нужна уменьшенная копия — по ней шейдер считает
    // смещение, чтобы силуэты не разрывались. Кадру и маске номеров она не
    // нужна: первый читается один в один, вторая — строго ближайшим пикселем.
    const makeTex = (unit: number, smooth: boolean, mip = false) => {
      const tex = gl.createTexture()
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const f = smooth ? gl.LINEAR : gl.NEAREST
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : f)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f)
      return tex
    }
    const texFrame = makeTex(0, true)
    const texAuxSmooth = makeTex(1, true, true)
    const texAuxSharp = makeTex(2, false)
    const texFrameNext = makeTex(3, true)
    // Карта движения читается сглаженно: она втрое мельче кадра, и по резкой
    // на границах предметов появлялись бы ступени сдвига.
    const texFlow = makeTex(4, true)
    const uFrameTex = gl.getUniformLocation(prog, 'frame')
    const uFrameNextTex = gl.getUniformLocation(prog, 'frameNext')
    gl.uniform1i(uFrameTex, 0)
    gl.uniform1i(gl.getUniformLocation(prog, 'auxSmooth'), 1)
    gl.uniform1i(gl.getUniformLocation(prog, 'auxSharp'), 2)
    gl.uniform1i(uFrameNextTex, 3)
    gl.uniform1i(gl.getUniformLocation(prog, 'flowMap'), 4)
    gl.uniform1f(gl.getUniformLocation(prog, 'flowRange'), FLOW_RANGE)

    const uCanvas = gl.getUniformLocation(prog, 'canvasSize')
    const uFrame = gl.getUniformLocation(prog, 'frameSize')
    const uCursor = gl.getUniformLocation(prog, 'cursorUV')
    const uLive = gl.getUniformLocation(prog, 'cursorLive')
    const uHasAux = gl.getUniformLocation(prog, 'hasAux')
    const uHasFlow = gl.getUniformLocation(prog, 'hasFlow')
    const uRipples = gl.getUniformLocation(prog, 'ripples')
    const uCup = gl.getUniformLocation(prog, 'cup')
    const uHoverId = gl.getUniformLocation(prog, 'hoverId')
    const uHoverAmt = gl.getUniformLocation(prog, 'hoverAmt')
    const uHit = gl.getUniformLocation(prog, 'hit')
    const uTime = gl.getUniformLocation(prog, 'time')
    const uFrameMix = gl.getUniformLocation(prog, 'frameMix')

    const resize = () => {
      const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1)
      el.width = Math.round(window.innerWidth * dpr)
      el.height = Math.round(window.innerHeight * dpr)
      gl.viewport(0, 0, el.width, el.height)
    }
    resize()
    window.addEventListener('resize', resize)

    // Служебная канва: JS читает по ней, какой предмет под курсором и где
    // стоит чашка. Мелкой копии хватает — счёт идёт на проценты экрана.
    const probe = document.createElement('canvas')
    probe.width = PROBE_W
    probe.height = PROBE_H
    const pctx = probe.getContext('2d', { willReadFrequently: true })
    // Без этого карта номеров уменьшается со сглаживанием, и на границе
    // питчера (номер 4) с фоном (0) появляется промежуточное значение, равное
    // номеру чашки. Рамка чашки растягивалась до питчера, и пар поднимался не
    // над кромкой, а посреди кадра — «привидение».
    if (pctx) pctx.imageSmoothingEnabled = false
    let probeFor = -1
    let probeData: Uint8ClampedArray | null = null
    let cupBox: CupBox = { x: 0.5, y: 0.5, half: 0, big: 0 }

    let probeAt = 0

    /** Разбор карты глубины: маска под курсором и рамка чашки. */
    const readProbe = (img: ImageBitmap, index: number) => {
      if (!pctx || probeFor === index) return
      // На быстрой прокрутке кадр меняется каждый раз, а перебор четырнадцати
      // тысяч пикселей на слабом телефоне стоит заметно дороже, чем польза от
      // того, что рамка чашки обновилась не через шестую долю секунды, а сразу.
      const now = performance.now()
      if (now - probeAt < 120) return
      probeAt = now
      probeFor = index
      pctx.drawImage(img, 0, 0, PROBE_W, PROBE_H)
      probeData = pctx.getImageData(0, 0, PROBE_W, PROBE_H).data
      const xs: number[] = []
      const ys: number[] = []
      for (let y = 0; y < PROBE_H; y++) {
        for (let x = 0; x < PROBE_W; x++) {
          const g = probeData[(y * PROBE_W + x) * 4 + 1]
          if (Math.abs(g - (ID_CUP * 255) / 8) > 5) continue
          xs.push(x)
          ys.push(y)
        }
      }
      if (xs.length < 12) {
        cupBox = { x: 0.5, y: 0.5, half: 0, big: 0 }
        return
      }
      // Рамка считается по перцентилям, а не по крайним точкам: одиночный
      // пиксель на другом конце кадра — а он находится, край маски никогда не
      // бывает идеально чистым — растягивал бы её через полкадра.
      xs.sort((a, b) => a - b)
      ys.sort((a, b) => a - b)
      const at = (arr: number[], q: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))]
      const minX = at(xs, 0.02), maxX = at(xs, 0.98), maxY = at(ys, 0.98)
      const half = (maxX - minX) / 2 / PROBE_W
      cupBox = {
        x: (minX + maxX) / 2 / PROBE_W,
        // Верхняя кромка чашки — пар поднимается от неё, а не из центра.
        // Карта уже перевёрнута, поэтому верх кадра — это последние строки.
        y: maxY / PROBE_H,
        half: Math.max(half, 0.02),
        // крупно ли она стоит в кадре — по этому включается пар без курсора
        big: Math.min(1, Math.max(0, (xs.length / (PROBE_W * PROBE_H) - 0.07) / 0.16)),
      }
    }

    /** Номер предмета в точке кадра (0..1, y снизу). */
    const objectAt = (u: number, v: number) => {
      if (!probeData) return 0
      const x = Math.round(u * (PROBE_W - 1))
      const y = Math.round(v * (PROBE_H - 1))
      if (x < 0 || y < 0 || x >= PROBE_W || y >= PROBE_H) return 0
      const g = probeData[(y * PROBE_W + x) * 4 + 1]
      return Math.round((g / 255) * 8)
    }

    /** Канва → кадр: тот же cover-фит, что в шейдере. */
    const toFrame = (u: number, v: number, fw: number, fh: number) => {
      const ca = el.width / el.height
      const fa = fw / fh
      const sx = ca > fa ? 1 : ca / fa
      const sy = ca > fa ? fa / ca : 1
      return [(u - 0.5) * sx + 0.5, (v - 0.5) * sy + 0.5] as const
    }

    const nearest = (list: (ImageBitmap | null)[], i: number) => {
      if (list[i]) return list[i]
      for (let d = 1; d < list.length; d++) {
        if (list[i - d]) return list[i - d]
        if (list[i + d]) return list[i + d]
      }
      return null
    }

    // Кадр заливается в видеопамять каждый раз, когда плёнка сдвинулась, то
    // есть до шестидесяти раз в секунду. Полная texImage2D каждый раз заново
    // выделяет хранилище под 1600×902; texSubImage2D пишет в уже выделенное,
    // и на прокрутке это заметно дешевле.
    const texSize = new WeakMap<WebGLTexture, string>()
    const upload = (tex: WebGLTexture, img: ImageBitmap) => {
      const key = `${img.width}x${img.height}`
      // RGBA, не RGB: у драйвера трёхбайтовый пиксель не выровнен по 4, и он
      // переупаковывает строку за строкой. Замер на кадре 2400x1353:
      // 11,9 мс -> 7,4 мс на заливку, это треть бюджета кадра при 60 Гц.
      if (texSize.get(tex) === key) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, img)
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
        texSize.set(tex, key)
      }
    }

    let raf = 0
    let snap = true
    let uploadedFrame: ImageBitmap | null = null
    let uploadedNext: ImageBitmap | null = null
    // Какая из двух текстур сейчас играет «текущий кадр», какая «следующий».
    // Роли меняются местами по ходу прокрутки (см. пинг-понг в tick).
    let slotCur = texFrame
    let slotNext = texFrameNext
    let unitCur = 0
    let unitNext = 3
    let uploadedAux: ImageBitmap | null = null
    let uploadedFlow: ImageBitmap | null = null
    const rippleData = new Float32Array(MAX_RIPPLES * 4)
    const startedAt = performance.now()

    // Отметка предыдущего кадра — нужна, чтобы демпфирование считалось по
    // времени, а не по числу кадров (см. ниже).
    let prevTs = 0
    let lastWindowAt = -1e9

    const tick = (ts = 0) => {
      raf = requestAnimationFrame(tick)
      // Первый кадр: dt неизвестен, берём один кадр при 60 Гц.
      const dt = prevTs ? Math.min(ts - prevTs, 100) : 16.667
      prevTs = ts

      const target = (progressRef.current ?? 0) * (count - 1)
      // Первый кадр после загрузки берётся как есть. Иначе при обновлении
      // страницы браузер восстанавливает прокрутку, плёнка стартует с нуля и
      // на глазах догоняет нужное место — это и читалось как «сам перематывает
      // видео куда-то очень быстро».
      if (snap) {
        current.current = target
        snap = false
      } else {
        // Демпфирование по времени, а не по кадрам. Раньше коэффициент был
        // фиксированным на кадр, и при падении частоты вдвое запаздывание
        // удваивалось: 220 мс при 60 Гц, 440 мс при 30. Это замыкало петлю —
        // просадка частоты делала плёнку заметно ступенчатее, что читалось
        // как дёрганость. Теперь постоянная времени одна и та же в миллисекундах.
        const k = paused ? 1 : 1 - Math.pow(1 - SMOOTH, dt / 16.667)
        current.current += (target - current.current) * k
      }

      const index = Math.floor(current.current)
      const frac = current.current - index

      // Раз в 120 мс подтягиваем окно распакованных кадров к текущему месту.
      // Чаще незачем: за 120 мс прокрутка сдвигает плёнку максимум на пару
      // кадров, а окно ±16 покрывает это с большим запасом.
      if (ts - lastWindowAt > 120) {
        lastWindowAt = ts
        maintainWindow(index, count)
      }

      const img = nearest(frames.current, index)
      if (!img) return

      // Следующий кадр и доля перехода к нему. Соседний кадр берём только если
      // он действительно загружен: подставлять вместо него дальний (как делает
      // nearest) значило бы смешивать несмежные позиции камеры — получилось бы
      // призрачное двоение вместо плавности.
      const nextImg = frames.current[Math.min(index + 1, count - 1)] ?? null

      // Пинг-понг вместо двух независимых заливок. При обычной прокрутке кадр
      // сдвигается на единицу, и то, что секунду назад было «следующим», уже
      // лежит в видеопамяти — незачем заливать его второй раз как «текущий».
      // Меняем текстуры ролями: одна заливка на шаг вместо двух.
      if (img === uploadedNext && nextImg !== uploadedFrame) {
        const t = slotCur; slotCur = slotNext; slotNext = t
        const u = unitCur; unitCur = unitNext; unitNext = u
        const up = uploadedFrame; uploadedFrame = uploadedNext; uploadedNext = up
        gl.uniform1i(uFrameTex, unitCur)
        gl.uniform1i(uFrameNextTex, unitNext)
      }

      if (img !== uploadedFrame) {
        gl.activeTexture(gl.TEXTURE0 + unitCur)
        gl.bindTexture(gl.TEXTURE_2D, slotCur)
        upload(slotCur, img)
        uploadedFrame = img
        gl.uniform2f(uFrame, img.width, img.height)
      }

      const mix = nextImg && nextImg !== img ? frac : 0
      if (nextImg && nextImg !== uploadedNext) {
        gl.activeTexture(gl.TEXTURE0 + unitNext)
        gl.bindTexture(gl.TEXTURE_2D, slotNext)
        upload(slotNext, nextImg)
        uploadedNext = nextImg
      }
      gl.uniform1f(uFrameMix, mix)

      // Карта движения нужна только когда кадры действительно смешиваются.
      // Берём строго карту текущего кадра: она описывает переход именно
      // к следующему, соседняя описывала бы другой переход.
      const flowImg = mix > 0 ? (flows.current[index] ?? null) : null
      if (flowImg && flowImg !== uploadedFlow) {
        gl.activeTexture(gl.TEXTURE4)
        gl.bindTexture(gl.TEXTURE_2D, texFlow)
        upload(texFlow, flowImg)
        uploadedFlow = flowImg
      }
      gl.uniform1f(uHasFlow, flowImg ? 1 : 0)

      const auxImg = nearest(auxes.current, index)
      if (auxImg && auxImg !== uploadedAux) {
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, texAuxSmooth)
        upload(texAuxSmooth, auxImg)
        // Уменьшенные копии пересобираются вместе с картой: без них текстура
        // с mip-фильтром считается неполной и все выборки приходят чёрными.
        // Карта 512×289 — на прокрутке это заметно дешевле самой заливки.
        gl.generateMipmap(gl.TEXTURE_2D)
        gl.activeTexture(gl.TEXTURE2)
        gl.bindTexture(gl.TEXTURE_2D, texAuxSharp)
        upload(texAuxSharp, auxImg)
        uploadedAux = auxImg
      }
      if (auxImg) readProbe(auxImg, index)
      gl.uniform1f(uHasAux, auxImg ? 1 : 0)

      // курсор догоняет цель — резкое следование читается дёрганьем
      const c = cursor.current
      c.u += (c.tu - c.u) * 0.07
      c.v += (c.tv - c.v) * 0.07
      gl.uniform2f(uCursor, c.u, c.v)
      gl.uniform1f(uLive, c.live)

      const now = performance.now()
      const fw = img.width
      const fh = img.height

      // Что под курсором. Смотрим по невозмущённой точке кадра: параллакс
      // сдвигает картинку на доли процента, а промах по предмету стоил бы
      // всего эффекта.
      const [cu, cv] = toFrame(c.u, c.v, fw, fh)
      const idNow = c.live > 0 && !still ? objectAt(cu, cv) : 0
      const h = hovered.current
      if (idNow !== h.id) {
        // перескочили на другой предмет — старый гасим быстро
        h.amt *= 0.5
        if (h.amt < 0.12) h.id = idNow
      }
      const want = h.id !== 0 && h.id === idNow ? 1 : 0
      h.amt += (want - h.amt) * (want ? 0.12 : 0.07)
      gl.uniform1f(uHoverId, h.id)
      gl.uniform1f(uHoverAmt, h.amt)

      const over = idNow !== 0
      if (over !== overRef.current) {
        overRef.current = over
        setOverObject(over)
      }

      // Нажатие: точка удара переводится в координаты кадра один раз, чтобы
      // волна осталась на месте в сцене.
      rippleData.fill(0)
      ripples.current = ripples.current.filter((r) => r.born < 0 || now - r.born < 2600)
      ripples.current.forEach((r, i) => {
        if (r.born < 0) {
          const [fx, fy] = toFrame(r.x, r.y, fw, fh)
          r.x = fx
          r.y = fy
          r.born = now
          const id = objectAt(fx, fy)
          if (id !== 0) hit.current = { id, born: now }
        }
        rippleData[i * 4] = r.x
        rippleData[i * 4 + 1] = r.y
        rippleData[i * 4 + 2] = (now - r.born) / 1000
        rippleData[i * 4 + 3] = 1
      })
      gl.uniform4fv(uRipples, rippleData)
      gl.uniform2f(uHit, hit.current.id, (now - hit.current.born) / 1000)

      gl.uniform4f(uCup, cupBox.x, cupBox.y, cupBox.half, still ? 0 : cupBox.big)
      gl.uniform1f(uTime, (now - startedAt) / 1000)
      gl.uniform2f(uCanvas, el.width, el.height)

      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      gl.deleteProgram(prog)
      gl.deleteTexture(texFrame)
      gl.deleteTexture(texFrameNext)
      gl.deleteTexture(texAuxSmooth)
      gl.deleteTexture(texAuxSharp)
      gl.deleteBuffer(buf)
    }
  }, [count, progressRef, paused, still, maintainWindow])

  return (
    <>
      <canvas
        ref={canvas}
        className="fixed inset-0 h-full w-full"
        aria-hidden="true"
        style={{ cursor: still ? 'default' : overObject ? 'pointer' : 'crosshair' }}
      />
      {(ready < 3 || fallback) && <div className="fixed inset-0 bg-[#0b0a09]" aria-hidden="true" />}
    </>
  )
}
