import { useEffect, useRef, useState } from 'react'

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

/** насколько далеко предметы расходятся за курсором: разница глубин × это */
const float PARALLAX = 0.075;

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
  float focus = depthAt(coverUV(cursorUV));

  vec2 t = base;
  if (hasAux > 0.5) {
    // Смещение зависит от глубины в точке, которая после смещения и окажется
    // под этим пикселем — поэтому считаем в три приближения.
    for (int i = 0; i < 3; i++) {
      t = base + aim * PARALLAX * (depthAt(t) - focus);
    }
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
    // ближнее к камере качается сильнее — дальний план почти стоит
    float near = mix(1.0, clamp(1.25 - depthAt(t), 0.2, 1.0), hasAux);
    float ring = exp(-band * band * 900.0) * exp(-age * 2.2) * exp(-dist * 1.6) * near;
    t += normalize(d + 1e-6) * ring * 0.02;
    glow += ring;
  }

  // Предмет под курсором: подсвечиваем ровно его пиксели, а не круг рядом.
  float same = objectMask(t, hoverId) * hoverAmt;

  // Нажатие: предмет коротко вздрагивает и ловит свет.
  float pulse = objectMask(t, hit.x) * exp(-hit.y * 3.4) * sin(hit.y * 17.0);

  t.y += same * 0.0016 + pulse * 0.0028;

  vec3 rgb = texture(frame, hold(t)).rgb;

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
    if (q.y > -0.15 && q.y < 3.4) {
      float rise = q.y + 0.15;
      float spread = 0.42 + rise * 0.55;     // чем выше, тем шире
      float across = exp(-pow(q.x / spread, 2.0));
      float fade = smoothstep(0.0, 0.35, rise) * exp(-rise * 0.85);
      float n = fbm(vec2(q.x * 2.6, q.y * 1.7 - time * 0.42));
      float m = fbm(vec2(q.x * 5.1 + 7.3, q.y * 3.0 - time * 0.63));
      // Фрактальный шум колеблется у половины и почти не доходит до единицы;
      // прежний порог 0.42…0.95 срезал клубы почти целиком, и пар существовал
      // только в коде.
      float puff = smoothstep(0.34, 0.72, n * 0.6 + m * 0.4);
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
  rgb += vec3(0.82, 0.76, 0.70) * steam * 0.5;

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

  // ── загрузка кадров и карт глубины пачками ──────────────────────────────
  useEffect(() => {
    frames.current = new Array(count).fill(null)
    auxes.current = new Array(count).fill(null)
    let cancelled = false
    let loaded = 0

    // Кадры едут как ImageBitmap, а не как <img>: картинку декодирует рабочий
    // поток, а в видеопамять она уходит готовым буфером. На прокрутке, где
    // кадр заливается по шестьдесят раз в секунду, разница заметная.
    const load = (src: string, keep: (img: ImageBitmap) => void) =>
      fetch(src)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('нет кадра'))))
        // Переворот задаём здесь: флаг UNPACK_FLIP_Y_WEBGL на ImageBitmap не
        // действует, и без этого вся сцена встаёт вверх ногами.
        .then((blob) => createImageBitmap(blob, { imageOrientation: 'flipY' }))
        .then(keep)
        .catch(() => {})

    const loadBatch = async (start: number) => {
      if (cancelled || start >= count) return
      await Promise.all(
        Array.from({ length: Math.min(BATCH, count - start) }, (_, k) => {
          const i = start + k
          return load(framePath(root, i), (img) => {
            frames.current[i] = img
            loaded += 1
            if (!cancelled) setReady(loaded)
          })
        }),
      )
      loadBatch(start + BATCH)
    }
    loadBatch(0)

    // Карты глубины идут следом за кадрами: они лёгкие, но картинка важнее.
    const loadAux = async (start: number) => {
      if (cancelled || start >= count) return
      await Promise.all(
        Array.from({ length: Math.min(BATCH, count - start) }, (_, k) => {
          const i = start + k
          return load(auxPath(auxRoot, i), (img) => {
            auxes.current[i] = img
          })
        }),
      )
      loadAux(start + BATCH)
    }
    setTimeout(() => loadAux(0), 400)

    return () => {
      cancelled = true
    }
  }, [count, root, auxRoot])

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
      move(e.clientX, e.clientY)
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

  // ── отрисовка ───────────────────────────────────────────────────────────
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const gl = el.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'low-power' })
    if (!gl) {
      setFallback(true)
      onFail?.()
      return
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
    if (!vs || !fs) {
      setFallback(true)
      onFail?.()
      return
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      setFallback(true)
      onFail?.()
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

    const makeTex = (unit: number, smooth: boolean) => {
      const tex = gl.createTexture()
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const f = smooth ? gl.LINEAR : gl.NEAREST
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f)
      return tex
    }
    const texFrame = makeTex(0, true)
    const texAuxSmooth = makeTex(1, true)
    const texAuxSharp = makeTex(2, false)
    gl.uniform1i(gl.getUniformLocation(prog, 'frame'), 0)
    gl.uniform1i(gl.getUniformLocation(prog, 'auxSmooth'), 1)
    gl.uniform1i(gl.getUniformLocation(prog, 'auxSharp'), 2)

    const uCanvas = gl.getUniformLocation(prog, 'canvasSize')
    const uFrame = gl.getUniformLocation(prog, 'frameSize')
    const uCursor = gl.getUniformLocation(prog, 'cursorUV')
    const uLive = gl.getUniformLocation(prog, 'cursorLive')
    const uHasAux = gl.getUniformLocation(prog, 'hasAux')
    const uRipples = gl.getUniformLocation(prog, 'ripples')
    const uCup = gl.getUniformLocation(prog, 'cup')
    const uHoverId = gl.getUniformLocation(prog, 'hoverId')
    const uHoverAmt = gl.getUniformLocation(prog, 'hoverAmt')
    const uHit = gl.getUniformLocation(prog, 'hit')
    const uTime = gl.getUniformLocation(prog, 'time')

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
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, area = 0
      for (let y = 0; y < PROBE_H; y++) {
        for (let x = 0; x < PROBE_W; x++) {
          const g = probeData[(y * PROBE_W + x) * 4 + 1]
          if (Math.abs(g - (ID_CUP * 255) / 8) > 8) continue
          area += 1
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
      if (area < 12) {
        cupBox = { x: 0.5, y: 0.5, half: 0, big: 0 }
        return
      }
      const half = (maxX - minX) / 2 / PROBE_W
      cupBox = {
        x: (minX + maxX) / 2 / PROBE_W,
        // Верхняя кромка чашки — пар поднимается от неё, а не из центра.
        // Карта уже перевёрнута, поэтому верх кадра — это последние строки.
        y: maxY / PROBE_H,
        half: Math.max(half, 0.02),
        // крупно ли она стоит в кадре — по этому включается пар без курсора
        big: Math.min(1, Math.max(0, (area / (PROBE_W * PROBE_H) - 0.07) / 0.16)),
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
      if (texSize.get(tex) === key) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGB, gl.UNSIGNED_BYTE, img)
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img)
        texSize.set(tex, key)
      }
    }

    let raf = 0
    let uploadedFrame: ImageBitmap | null = null
    let uploadedAux: ImageBitmap | null = null
    const rippleData = new Float32Array(MAX_RIPPLES * 4)
    const startedAt = performance.now()

    const tick = () => {
      raf = requestAnimationFrame(tick)

      const target = (progressRef.current ?? 0) * (count - 1)
      current.current += (target - current.current) * (paused ? 1 : SMOOTH)
      const index = Math.round(current.current)
      const img = nearest(frames.current, index)
      if (!img) return

      if (img !== uploadedFrame) {
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, texFrame)
        upload(texFrame, img)
        uploadedFrame = img
        gl.uniform2f(uFrame, img.width, img.height)
      }

      const auxImg = nearest(auxes.current, index)
      if (auxImg && auxImg !== uploadedAux) {
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, texAuxSmooth)
        upload(texAuxSmooth, auxImg)
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
      gl.deleteTexture(texAuxSmooth)
      gl.deleteTexture(texAuxSharp)
      gl.deleteBuffer(buf)
    }
  }, [count, progressRef, paused, still, onFail])

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
