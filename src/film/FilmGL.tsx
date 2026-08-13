import { useEffect, useRef, useState } from 'react'

/**
 * Скролл-плёнка на WebGL: кадры из Cycles крутятся прокруткой, но сверх этого
 * сцена отвечает на курсор.
 *
 * Зачем WebGL, а не canvas 2D. Кадры пререндерены и сами по себе мертвы: что
 * ни делай, это картинка. Чтобы страница ощущалась объёмной, кадру нужны две
 * вещи, которые в 2D дорого или невозможно: параллакс (сдвиг с лёгким зумом,
 * будто камера чуть повернулась вслед за взглядом) и рябь от клика, идущая
 * по поверхности волной. И то, и другое — это смещение координат текстуры,
 * то есть работа для фрагментного шейдера.
 *
 * Плёнка при этом остаётся плёнкой: прокрутку движок ЧИТАЕТ, а не перехватывает.
 */

interface Props {
  count: number
  progressRef: React.RefObject<number>
  base?: string
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

const framePath = (base: string, i: number) => `${base}frame-${String(i).padStart(3, '0')}.webp`

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
uniform vec2 canvasSize;
uniform vec2 frameSize;
uniform vec2 cursor;        // −1..1, сглаженная позиция курсора
uniform float cursorLive;   // 0 — курсора нет, 1 — есть
uniform vec4 ripples[${MAX_RIPPLES}];  // xy — центр, z — возраст в секундах, w — активна

/** cover-фит: канва и кадр почти никогда не совпадают по пропорциям */
vec2 coverUV(vec2 p) {
  float canvasAspect = canvasSize.x / canvasSize.y;
  float frameAspect = frameSize.x / frameSize.y;
  vec2 scale = canvasAspect > frameAspect
    ? vec2(1.0, frameAspect / canvasAspect)
    : vec2(canvasAspect / frameAspect, 1.0);
  return (p - 0.5) * scale + 0.5;
}

void main() {
  // Параллакс: кадр чуть отъезжает от курсора и слегка приближается. Зум
  // обязателен — без него по краям вылезает пустота от сдвига.
  vec2 p = uv;
  p = (p - 0.5) / 1.045 + 0.5;
  p -= cursor * 0.012 * cursorLive;

  // Рябь от клика: кольцевая волна, расходящаяся от точки и затухающая.
  // Смещаем координаты вдоль радиуса — свет в кадре ломается сам собой,
  // потому что искажается уже отрендеренная картинка со всеми её бликами.
  float glow = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    if (ripples[i].w < 0.5) continue;
    vec2 d = p - ripples[i].xy;
    d.x *= canvasSize.x / canvasSize.y;   // круг остаётся кругом
    float dist = length(d);
    float age = ripples[i].z;
    float front = age * 0.42;             // скорость фронта
    float band = dist - front;
    // узкое кольцо вокруг фронта, гаснущее со временем и с расстоянием
    float ring = exp(-band * band * 900.0) * exp(-age * 2.2) * exp(-dist * 1.6);
    p += normalize(d + 1e-6) * ring * 0.02;
    glow += ring;
  }

  vec2 t = coverUV(p);
  // за краями кадра тянем крайний пиксель, чтобы параллакс не оголял фон
  t = clamp(t, vec2(0.0005), vec2(0.9995));
  vec3 rgb = texture(frame, t).rgb;

  // Гребень волны ловит свет — иначе искажение читается как дефект картинки,
  // а не как движение жидкой поверхности.
  rgb += vec3(0.55, 0.42, 0.30) * glow * 0.30;

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

export function FilmGL({ count, progressRef, base, paused = false, still = false, onFail }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const frames = useRef<(HTMLImageElement | null)[]>([])
  const current = useRef(0)
  const [ready, setReady] = useState(0)
  const [fallback, setFallback] = useState(false)

  const cursor = useRef({ x: 0, y: 0, tx: 0, ty: 0, live: 0 })
  const ripples = useRef<{ x: number; y: number; born: number }[]>([])

  const root = base ?? `${import.meta.env.BASE_URL}film/`

  // ── загрузка кадров пачками ─────────────────────────────────────────────
  useEffect(() => {
    frames.current = new Array(count).fill(null)
    let cancelled = false
    let loaded = 0

    const loadBatch = async (start: number) => {
      if (cancelled || start >= count) return
      await Promise.all(
        Array.from({ length: Math.min(BATCH, count - start) }, (_, k) => {
          const i = start + k
          return new Promise<void>((resolve) => {
            const img = new Image()
            img.decoding = 'async'
            img.onload = () => {
              frames.current[i] = img
              loaded += 1
              if (!cancelled) setReady(loaded)
              resolve()
            }
            img.onerror = () => resolve()
            img.src = framePath(root, i)
          })
        }),
      )
      loadBatch(start + BATCH)
    }
    loadBatch(0)
    return () => {
      cancelled = true
    }
  }, [count, root])

  // ── ввод ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (still) return
    const el = canvas.current
    if (!el) return

    const move = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect()
      cursor.current.tx = ((cx - r.left) / r.width) * 2 - 1
      cursor.current.ty = ((cy - r.top) / r.height) * 2 - 1
      cursor.current.live = 1
    }
    const onMouse = (e: MouseEvent) => move(e.clientX, e.clientY)
    const onLeave = () => {
      cursor.current.live = 0
      cursor.current.tx = 0
      cursor.current.ty = 0
    }
    const splash = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect()
      ripples.current.push({
        x: (cx - r.left) / r.width,
        y: 1 - (cy - r.top) / r.height,
        born: performance.now(),
      })
      if (ripples.current.length > MAX_RIPPLES) ripples.current.shift()
    }
    const onDown = (e: PointerEvent) => {
      splash(e.clientX, e.clientY)
      if (e.pointerType !== 'mouse') move(e.clientX, e.clientY)
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

    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    const uCanvas = gl.getUniformLocation(prog, 'canvasSize')
    const uFrame = gl.getUniformLocation(prog, 'frameSize')
    const uCursor = gl.getUniformLocation(prog, 'cursor')
    const uLive = gl.getUniformLocation(prog, 'cursorLive')
    const uRipples = gl.getUniformLocation(prog, 'ripples')

    const resize = () => {
      const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1)
      el.width = Math.round(window.innerWidth * dpr)
      el.height = Math.round(window.innerHeight * dpr)
      gl.viewport(0, 0, el.width, el.height)
    }
    resize()
    window.addEventListener('resize', resize)

    const nearest = (i: number) => {
      const f = frames.current
      if (f[i]) return f[i]
      for (let d = 1; d < f.length; d++) {
        if (f[i - d]) return f[i - d]
        if (f[i + d]) return f[i + d]
      }
      return null
    }

    let raf = 0
    let uploaded: HTMLImageElement | null = null
    const rippleData = new Float32Array(MAX_RIPPLES * 4)

    const tick = () => {
      raf = requestAnimationFrame(tick)

      const target = (progressRef.current ?? 0) * (count - 1)
      current.current += (target - current.current) * (paused ? 1 : SMOOTH)
      const img = nearest(Math.round(current.current))
      if (!img) return

      if (img !== uploaded) {
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img)
        uploaded = img
        gl.uniform2f(uFrame, img.naturalWidth, img.naturalHeight)
      }

      // курсор догоняет цель — резкое следование читается дёрганьем
      const c = cursor.current
      c.x += (c.tx - c.x) * 0.07
      c.y += (c.ty - c.y) * 0.07
      gl.uniform2f(uCursor, c.x, c.y)
      gl.uniform1f(uLive, c.live)

      const now = performance.now()
      ripples.current = ripples.current.filter((r) => now - r.born < 2600)
      rippleData.fill(0)
      ripples.current.forEach((r, i) => {
        rippleData[i * 4] = r.x
        rippleData[i * 4 + 1] = r.y
        rippleData[i * 4 + 2] = (now - r.born) / 1000
        rippleData[i * 4 + 3] = 1
      })
      gl.uniform4fv(uRipples, rippleData)
      gl.uniform2f(uCanvas, el.width, el.height)

      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      gl.deleteProgram(prog)
      gl.deleteTexture(tex)
      gl.deleteBuffer(buf)
    }
  }, [count, progressRef, paused, onFail])

  return (
    <>
      <canvas
        ref={canvas}
        className="fixed inset-0 h-full w-full"
        aria-hidden="true"
        style={{ cursor: still ? 'default' : 'pointer' }}
      />
      {(ready < 3 || fallback) && <div className="fixed inset-0 bg-[#0b0a09]" aria-hidden="true" />}
    </>
  )
}
