import { useEffect, useRef, useState } from 'react'
import { COPY, type Locale } from './content/copy'
import { Film } from './film/Film'
import { FilmGL } from './film/FilmGL'
import { Booking, Footer, Hero, Menu, Space, Ticker, Visit } from './ui/Sections'

/**
 * Страница собрана из двух частей на одной сквозной прокрутке.
 *
 * Пролог — скролл-плёнка из Cycles: четыре экрана прокрутки отыгрывают все 144
 * кадра, поверх идут три титра. Маршрут камеры размечен в `render/scene.py`:
 * общий план (кадры 0–28), сближение и зерно (29–62), налив (63–106), взгляд
 * внутрь чашки (107–143).
 *
 * Дальше плёнка кончилась — она остаётся стоять на последнем кадре, притухает
 * под вуалью и передаёт эстафету контенту. Так главные кадры плёнки, налив и
 * «чёрное зеркало», не закрыты текстом: ради них она и снималась.
 */
const FRAME_COUNT = 144
/** сколько экранов прокрутки отдано плёнке до начала контента */
const PROLOGUE_SCREENS = 4

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Есть ли WebGL2: без него плёнка крутится обычной канвой, без реакции на курсор. */
const hasWebGL2 = () => {
  if (typeof document === 'undefined') return false
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

/**
 * Какую плёнку везти. Кадр 1100 px честно закрывает телефон, но на мониторе
 * растягивается почти вдвое и сцена выглядит замыленной; кадр 1600 px весит
 * втрое больше и телефону не нужен. Порог по ширине окна, а не по плотности
 * пикселей: на ретина-планшете вторая плёнка — это лишние мегабайты в дорогу.
 */
const filmBase = () => {
  const hd = typeof window !== 'undefined' && window.innerWidth >= 900
  return `${import.meta.env.BASE_URL}${hd ? 'film-hd' : 'film'}/`
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))

export default function App() {
  const [locale, setLocale] = useState<Locale>('he')
  const [paused] = useState(prefersReducedMotion)
  const [gl, setGl] = useState(hasWebGL2)
  // Плёнка выбирается один раз: менять её на лету значило бы выбросить всё
  // загруженное и начать качать заново посреди прокрутки.
  const [base] = useState(filmBase)

  /** какой из трёх титров пролога показан */
  const [act, setAct] = useState<0 | 1 | 2>(0)
  /** насколько фон притушен под контентом */
  const [veil, setVeil] = useState(0)

  const progressRef = useRef(0)
  const menuRef = useRef<HTMLElement | null>(null)
  const t = COPY[locale]

  useEffect(() => {
    let raf = 0
    // ?shot=0.25 замораживает плёнку на кадре — так проверяются отдельные кадры
    const frozen = new URLSearchParams(window.location.search).get('shot')
    if (frozen !== null) {
      progressRef.current = clamp(Number(frozen) || 0)
      return
    }
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const screen = window.innerHeight
        const prologue = screen * PROLOGUE_SCREENS
        const y = window.scrollY

        // Плёнка привязана к прологу, а не ко всей странице: иначе кадры
        // размазались бы по контенту и на первом экране почти не двигались.
        const p = clamp(y / prologue)
        progressRef.current = p
        setAct(p < 0.34 ? 0 : p < 0.68 ? 1 : 2)

        // Вуаль поднимается на последней трети пролога — к началу контента
        // сцена уже приглушена, и текст читается по спокойному фону.
        setVeil(clamp((y - prologue * 0.66) / (prologue * 0.34)))
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = t.dir
  }, [locale, t.dir])

  const toMenu = () => menuRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <>
      {gl ? (
        <FilmGL count={FRAME_COUNT} progressRef={progressRef} base={base} paused={paused} still={paused}
                onFail={() => setGl(false)} />
      ) : (
        <Film count={FRAME_COUNT} progressRef={progressRef} base={base} paused={paused} />
      )}

      {/* фон не выключается, а притухает: сцена продолжает жить под контентом */}
      <div
        className="pointer-events-none fixed inset-0 z-[1] bg-[#0a0908]"
        style={{ opacity: veil * 0.88 }}
        aria-hidden="true"
      />

      <div className="relative z-[2]">
        {/* пролог: плёнка под тремя титрами */}
        <Hero t={t} onMenu={toMenu} act={act} screens={PROLOGUE_SCREENS} />

        {/* дальше обычная страница по притушенному фону */}
        <main className="bg-[#0a0908]">
          <Ticker t={t} />
          <Menu t={t} locale={locale} anchorRef={menuRef} />
          <Space t={t} />
          <Booking t={t} locale={locale} />
          <Visit t={t} />
          <Footer t={t} />
        </main>
      </div>

      <div className="fixed bottom-4 start-4 z-[3] flex gap-1 text-xs">
        {(['he', 'ru', 'en'] as Locale[]).map((l) => (
          <button
            key={l}
            onClick={() => setLocale(l)}
            className={`border border-white/15 px-2 py-1 uppercase tracking-wider backdrop-blur-sm ${
              l === locale ? 'bg-white/15 text-white' : 'bg-black/30 text-white/55'
            }`}
          >
            {l}
          </button>
        ))}
      </div>
    </>
  )
}
