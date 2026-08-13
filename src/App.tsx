import { useEffect, useRef, useState } from 'react'
import { COPY, type Locale } from './content/copy'
import { Film } from './film/Film'

/**
 * Первый экран — скролл-плёнка: кадры, отрендеренные в Cycles, крутятся прокруткой.
 * Контента на странице пока нет намеренно: сначала должен держать кадр.
 */
const FRAME_COUNT = 144
const SCROLL_SCREENS = 5

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function App() {
  const [locale, setLocale] = useState<Locale>('he')
  const [paused] = useState(prefersReducedMotion)
  const [progress, setProgress] = useState(0)

  const progressRef = useRef(0)
  const t = COPY[locale]

  useEffect(() => {
    let raf = 0
    const frozen = new URLSearchParams(window.location.search).get('shot')
    if (frozen !== null) {
      const p = Math.min(1, Math.max(0, Number(frozen) || 0))
      progressRef.current = p
      setProgress(p)
      return
    }
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const travel = document.documentElement.scrollHeight - window.innerHeight
        const p = travel > 0 ? Math.min(1, Math.max(0, window.scrollY / travel)) : 0
        progressRef.current = p
        setProgress(p)
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

  // Титул держится на первом экране и растворяется, как только пошло движение.
  const titleOpacity = Math.max(0, 1 - progress / 0.12)

  return (
    <>
      <Film count={FRAME_COUNT} progressRef={progressRef} paused={paused} />

      <div
        className="pointer-events-none fixed inset-0 flex items-center px-[7vw]"
        style={{ opacity: titleOpacity, transition: 'opacity 140ms linear' }}
      >
        {/* Предмет в кадре всегда слева, поэтому титул прижимаем физически вправо —
            логическое ms-auto в иврите уводило его на ту же сторону, что и чашку. */}
        <div className="max-w-[36ch]" style={{ marginLeft: 'auto', textAlign: t.dir === 'rtl' ? 'right' : 'left' }}>
          <h1 className="text-[clamp(2.6rem,8vw,6rem)] leading-[0.95] text-[#efe7db]" style={{ fontFamily: 'var(--font-display)' }}>
            {t.brand}
          </h1>
          <p className="mt-4 text-[clamp(0.95rem,2vw,1.35rem)] text-[#a99f92]" style={{ fontFamily: 'var(--font-body)' }}>
            {t.heroLine}
          </p>
        </div>
      </div>

      {/* полоса прокрутки: содержания нет, она нужна плёнке как время */}
      <main style={{ height: `${SCROLL_SCREENS * 100}svh` }} aria-hidden="true" />

      <div className="fixed bottom-4 start-4 flex gap-1 text-xs">
        {(['he', 'ru', 'en'] as Locale[]).map((l) => (
          <button
            key={l}
            onClick={() => setLocale(l)}
            className={`border border-white/15 px-2 py-1 uppercase tracking-wider ${
              l === locale ? 'bg-white/15 text-white' : 'text-white/55'
            }`}
          >
            {l}
          </button>
        ))}
      </div>
    </>
  )
}
