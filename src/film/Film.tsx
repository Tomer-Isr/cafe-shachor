import { useEffect, useRef, useState } from 'react'

/**
 * Скролл-плёнка: кадры, отрендеренные в Cycles, крутятся прокруткой.
 *
 * Реализм здесь берётся не из кода, а из рендера — браузеру остаётся только
 * рисовать нужный кадр на канве. Скролл при этом остаётся родным: движок его
 * ЧИТАЕТ, а не перехватывает, поэтому ничего не ломается ни в RTL, ни на тач-устройствах.
 *
 * Правила взяты из docs/scroll-film-playbook.md: DPR не выше 1.5, загрузка
 * пачками, ближайший загруженный кадр вместо ожидания, сглаживание позиции.
 */

interface Props {
  /** сколько кадров в секвенции */
  count: number
  /** прогресс 0..1, за которым следует плёнка */
  progressRef: React.RefObject<number>
  /** база пути к кадрам */
  base?: string
  paused?: boolean
}

const BATCH = 8
// 0.3, а не 0.16: прокрутку теперь сглаживает Lenis, и второе
// демпфирование поверх первого давало вязкое запаздывание — плёнка
// заметно отставала от страницы. Здесь остаётся лёгкое сглаживание
// на случай, когда Lenis выключен (reduced-motion, тач).
const SMOOTH = 0.3
const DPR_CAP = 1.5

const framePath = (base: string, i: number) => `${base}frame-${String(i).padStart(3, '0')}.webp`

export function Film({ count, progressRef, base, paused = false }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const frames = useRef<(HTMLImageElement | null)[]>([])
  const current = useRef(0)
  const [ready, setReady] = useState(0)

  const root = base ?? `${import.meta.env.BASE_URL}film/`

  // ── загрузка пачками, от начала к концу ────────────────────────────────
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

  // ── отрисовка ──────────────────────────────────────────────────────────
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const ctx = el.getContext('2d', { alpha: false })
    if (!ctx) return

    const resize = () => {
      const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1)
      el.width = Math.round(window.innerWidth * dpr)
      el.height = Math.round(window.innerHeight * dpr)
    }
    resize()
    window.addEventListener('resize', resize)

    /** Ближайший уже загруженный кадр: ждать целевой — значит показывать дыру. */
    const nearest = (i: number) => {
      const f = frames.current
      if (f[i]) return f[i]
      for (let d = 1; d < f.length; d++) {
        if (f[i - d]) return f[i - d]
        if (f[i + d]) return f[i + d]
      }
      return null
    }

    /** cover-фит вручную: канва и кадр редко совпадают по соотношению */
    const drawCover = (img: HTMLImageElement) => {
      const cw = el.width
      const ch = el.height
      const scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight)
      const w = img.naturalWidth * scale
      const h = img.naturalHeight * scale
      ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h)
    }

    let raf = 0
    let prevTs = 0
    const tick = (ts = 0) => {
      raf = requestAnimationFrame(tick)
      const dt = prevTs ? Math.min(ts - prevTs, 100) : 16.667
      prevTs = ts
      const target = (progressRef.current ?? 0) * (count - 1)
      // Сглаживание по времени, а не по кадрам: иначе при просадке частоты
      // запаздывание растёт и рывок становится заметнее (то же, что в FilmGL).
      const k = paused ? 1 : 1 - Math.pow(1 - SMOOTH, dt / 16.667)
      current.current += (target - current.current) * k
      const img = nearest(Math.round(current.current))
      if (img) drawCover(img)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [count, progressRef, paused])

  return (
    <>
      <canvas ref={canvas} className="fixed inset-0 h-full w-full" aria-hidden="true" />
      {/* пока не доехала первая пачка — держим ровный тёмный фон, а не белую вспышку */}
      {ready < 3 && <div className="fixed inset-0 bg-[#0b0a09]" aria-hidden="true" />}
    </>
  )
}
