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
/** сколько экранов прокрутки занимает пролог целиком */
const PROLOGUE_SCREENS = 4.5
/**
 * Какую долю пролога занимает сама плёнка. Остаток — пауза на финальном кадре.
 *
 * Считать надо с поправкой на то, что контент виден снизу за целый экран до
 * конца пролога: он выезжает в кадр, пока сцена ещё идёт. Поэтому плёнка
 * должна доигрывать заметно раньше — тогда налив и отъезд камеры зритель
 * видит на чистом экране, а не под наползающим чёрным блоком.
 */
const FILM_SPAN = 0.62

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
 * Какую плёнку везти. Кадр меньше канвы браузер растягивает, и сцена выглядит
 * замыленной — а канва равна ширине окна, помноженной на плотность пикселей
 * (не выше 1.5). Отсюда три ширины под три класса экранов:
 *
 *   до 900   — телефон, канва редко больше 600 px: хватает 1100, и это 5 МБ;
 *   900-1400 — ноутбук, канва до 2100: 1600 px, 11 МБ;
 *   от 1400  — широкий монитор, канва до 2560 и выше: 2400 px, 14 МБ.
 *
 * Порог по ширине окна, а не по плотности пикселей: на ретина-планшете крупная
 * плёнка — это лишние мегабайты в дорогу при неразличимой разнице.
 */
const filmBase = () => {
  const w = typeof window !== 'undefined' ? window.innerWidth : 0
  const dir = w >= 1400 ? 'film-xl' : w >= 900 ? 'film-hd' : 'film'
  return `${import.meta.env.BASE_URL}${dir}/`
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
        const p = clamp(y / (prologue * FILM_SPAN))
        progressRef.current = p
        setAct(p < 0.34 ? 0 : p < 0.72 ? 1 : 2)

        // Вуаль привязана не к доле пролога, а к моменту, когда контент реально
        // показался снизу: экран до конца пролога. Прежде она начиналась с двух
        // третей, и финал плёнки — налив и отъезд камеры — зритель смотрел уже
        // сквозь черноту.
        setVeil(clamp((y - (prologue - screen)) / (screen * 0.85)))
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
