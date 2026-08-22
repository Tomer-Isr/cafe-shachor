import { useEffect, useRef, useState } from 'react'
import { COPY, type Locale } from './content/copy'
import { Film } from './film/Film'
import { FilmGL } from './film/FilmGL'
import { Block } from './ui/Block'
import { FilmProgress } from './film/motion'
import { Lines } from './ui/Lines'
import { BeanBlock, Booking, Footer, Menu, Space, Visit } from './ui/Sections'
import { useSmoothScroll } from './film/useSmoothScroll'

/**
 * Сцена — фон всей страницы, а не пролог с контентом под ним.
 *
 * Плёнка идёт по общей прокрутке, поэтому каждый блок страницы приходится на
 * свой участок маршрута камеры (`render/scene.py`):
 *
 *   0.00–0.20  общий план, пустая чашка     → имя и манифест
 *   0.20–0.44  сближение, россыпь зерна     → обжарка
 *   0.44–0.74  налив                        → меню
 *   0.74–0.90  взгляд внутрь чашки          → место
 *   0.90–1.00  финал, кадр раскрывается     → приглашение
 *
 * Внутри блока камера почти стоит — так писалась раскадровка, — поэтому текст
 * ложится на спокойный кадр, а смена темы совпадает с движением камеры.
 *
 * После пятого блока плёнка отыграла и стоит на последнем кадре: дальше идут
 * бронь, часы и подвал по притушенной сцене. Фон не выключается нигде.
 */
const FRAME_COUNT = 144

/** Блоки: доля высоты = доля маршрута камеры. Сумма — зона, где плёнка идёт. */
const BLOCKS = { hero: 2, roast: 2.4, menu: 3, space: 1.6, invite: 1.4 }
const FILM_SCREENS = Object.values(BLOCKS).reduce((a, b) => a + b, 0)

/**
 * Где стоит середина каждого блока на плёнке, 0..1.
 *
 * Отсюда текст узнаёт, что делает камера на его участке: где она почти стоит,
 * строки ложатся медленно и с большим зазором, где летит — быстрее и плотнее.
 * Величина детерминированная (положение блока), а не «где сейчас пользователь»,
 * иначе окно раскладки менялось бы на каждом пересчёте.
 */
const FILM_AT = (() => {
  const travel = FILM_SCREENS - 1
  let start = 0
  const out = {} as Record<keyof typeof BLOCKS, number>
  for (const [key, screens] of Object.entries(BLOCKS) as [keyof typeof BLOCKS, number][]) {
    out[key] = Math.min(1, (start + screens / 2) / travel)
    start += screens
  }
  return out
})()

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Есть ли WebGL2: без него плёнка крутится обычной канвой, без реакции на курсор.
 *
 * Проверочный контекст обязательно освобождается. Пока он висел, настоящий
 * контекст плёнки не поднимался вовсе — `getContext` отдавал null, компонент
 * молча уходил на запасную канву, и вся сцена ехала целыми кадрами, без
 * смешивания. Со стороны это выглядело просто как «всё дёргано».
 */
const hasWebGL2 = () => {
  if (typeof document === 'undefined') return false
  try {
    const probe = document.createElement('canvas').getContext('webgl2')
    if (!probe) return false
    probe.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}

/**
 * Какую плёнку везти. Кадр меньше канвы браузер растягивает, и сцена выглядит
 * замыленной — а канва равна ширине окна, помноженной на плотность пикселей
 * (не выше 1.5). Отсюда три ширины под три класса экранов:
 *
 *   до 900   — телефон, канва редко больше 600 px: хватает 1100, и это 5,8 МБ;
 *   900-1400 — ноутбук, канва до 2100: 1600 px, 13,5 МБ;
 *   от 1400  — широкий монитор, канва до 2560 и выше: 2400 px, 14,2 МБ.
 */
const filmBase = () => {
  const w = typeof window !== 'undefined' ? window.innerWidth : 0
  const dir = w >= 1400 ? 'film-xl' : w >= 900 ? 'film-hd' : 'film'
  return `${import.meta.env.BASE_URL}${dir}/`
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))

/** Позиция плёнки по текущей прокрутке — та же формула, что в обработчике. */
const initialProgress = () => {
  if (typeof window === 'undefined') return 0
  const frozen = new URLSearchParams(window.location.search).get('shot')
  if (frozen !== null) return clamp(Number(frozen) || 0)
  return clamp(window.scrollY / (window.innerHeight * (FILM_SCREENS - 1)))
}

export default function App() {
  const [locale, setLocale] = useState<Locale>('he')
  const [paused] = useState(prefersReducedMotion)
  const [gl, setGl] = useState(hasWebGL2)
  const [base] = useState(filmBase)

  // Начальный прогресс считается синхронно, до первого кадра: эффекты родителя
  // выполняются позже, чем монтируется плёнка, и она успела бы решить, что
  // страница стоит в самом начале — а браузер после обновления возвращает
  // прокрутку на прежнее место.
  // Плавная прокрутка: колесо на Windows идёт скачками, и без этого текст
  // двигался ступеньками, пока плёнка шла гладко.
  useSmoothScroll()

  const progressRef = useRef(initialProgress())
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
        // Плёнка отыгрывает за зону блоков. Последний кадр приходится на конец
        // пятого блока — то есть когда его низ дошёл до низа экрана, а не когда
        // страница целиком доскроллена: дальше идёт хвост с бронью и часами.
        const travel = window.innerHeight * (FILM_SCREENS - 1)
        progressRef.current = clamp(window.scrollY / travel)
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

  // Текст всегда с той стороны, где в кадре пусто: предмет стоит слева, значит
  // колонка справа — и в иврите тоже, поэтому отступ физический, не логический.
  const column = 'w-full px-6 sm:px-10 md:pl-[50%] md:pr-12 lg:pr-20'

  return (
    <>
      {gl ? (
        <FilmGL count={FRAME_COUNT} progressRef={progressRef} base={base} paused={paused} still={paused}
                onFail={() => setGl(false)} />
      ) : (
        <Film count={FRAME_COUNT} progressRef={progressRef} base={base} paused={paused} />
      )}

      {/* Прогресс плёнки доступен тексту: из него выводится скорость выхода строк */}
      <FilmProgress.Provider value={progressRef}>
      <div className="relative z-[2] on-scene">
        {/* 1. общий план — имя и манифест */}
        <Block screens={BLOCKS.hero} className={column}>
          <div className="w-full max-w-[34ch]" style={{ textAlign: t.dir === 'rtl' ? 'right' : 'left', marginInlineStart: 'auto' }}>
            <Lines locale={locale} level="caption" film={FILM_AT.hero} mode="intro" className="t-caption mb-5">{t.heroFact}</Lines>
            <Lines locale={locale} level="display" film={FILM_AT.hero} mode="intro" delay={0.1}>
              <h1 className="t-display">{t.brand}</h1>
            </Lines>
            <Lines locale={locale} level="lead" film={FILM_AT.hero} mode="intro" delay={0.22} className="t-lead mt-4 text-[var(--fg-dim)]">
              {t.heroLine}
            </Lines>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <button
                onClick={toMenu}
                className="bg-[var(--accent)] px-7 py-3.5 text-[15px] font-medium text-[#100a06] transition hover:brightness-110 active:scale-[.98]"
              >
                {t.ctaMenu}
              </button>
              <a
                href="#book"
                className="border border-[rgba(236,230,220,.28)] px-7 py-3.5 text-[15px] text-[#ece6dc] transition hover:border-[rgba(236,230,220,.6)]"
              >
                {t.ctaBook}
              </a>
            </div>
            <p className="t-caption mt-10 hidden md:block">{t.cursorHint}</p>
          </div>
        </Block>

        {/* 2. зерно — обжарка */}
        <Block screens={BLOCKS.roast} className={column}>
          <div className="w-full max-w-[38ch]" style={{ textAlign: t.dir === 'rtl' ? 'right' : 'left', marginInlineStart: 'auto' }}>
            <Lines locale={locale} level="caption" film={FILM_AT.roast} className="t-caption mb-5">02</Lines>
            <Lines locale={locale} level="h2" film={FILM_AT.roast} delay={0.08}>
              <h2 className="t-h2">{t.actTwoTitle}</h2>
            </Lines>
            <Lines locale={locale} level="body" film={FILM_AT.roast} delay={0.2} className="t-body mt-4">
              {t.actTwoText}
            </Lines>
            <BeanBlock t={t} locale={locale} bare />
          </div>
        </Block>

        {/* 3. налив — меню */}
        <Block screens={BLOCKS.menu} hold={false} className={`${column} block pt-[18svh]`}>
          <div className="ms-auto w-full max-w-[52ch]">
            <Lines locale={locale} level="caption" film={FILM_AT.menu} className="t-caption mb-5">03</Lines>
            <Lines locale={locale} level="h2" film={FILM_AT.menu} delay={0.08}>
              <h2 className="t-h2">{t.actThreeTitle}</h2>
            </Lines>
            <Lines locale={locale} level="body" film={FILM_AT.menu} delay={0.18} className="t-body mt-3">
              {t.actThreeText}
            </Lines>
            <Menu t={t} locale={locale} anchorRef={menuRef} />
          </div>
        </Block>

        {/* 4. взгляд внутрь — место */}
        <Block screens={BLOCKS.space} hold={false} className={`${column} block pt-[14svh]`}>
          <div className="ms-auto w-full max-w-[46ch]">
            <Space t={t} />
          </div>
        </Block>

        {/* 5. финал — приглашение */}
        <Block screens={BLOCKS.invite} className={column}>
          <div className="w-full max-w-[32ch]" style={{ textAlign: t.dir === 'rtl' ? 'right' : 'left', marginInlineStart: 'auto' }}>
            <Lines locale={locale} level="display" film={FILM_AT.invite}>
              <h2 className="t-display">{t.brand}</h2>
            </Lines>
            <Lines locale={locale} level="body" film={FILM_AT.invite} delay={0.15} className="t-body mt-4">
              {t.spaceText}
            </Lines>
            <a
              href="#book"
              className="mt-8 inline-block bg-[var(--accent)] px-7 py-3.5 text-[15px] font-medium text-[#100a06] transition hover:brightness-110"
            >
              {t.ctaBook}
            </a>
          </div>
        </Block>

        {/* Хвост: плёнка отыграла и стоит на последнем кадре. Ни заливки, ни
            градиента — текст лежит на той же сцене, что и всё остальное. */}
        <div className={`${column} on-scene`}>
          <div className="ms-auto w-full max-w-[52ch]">
            <Booking t={t} locale={locale} />
            <Visit t={t} />
            <Footer t={t} />
          </div>
        </div>
      </div>
      </FilmProgress.Provider>

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
