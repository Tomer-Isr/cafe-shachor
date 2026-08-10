import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { COPY, type Locale } from './content/copy'
import { ACCENTS, FONT_PAIRS, Tweaks, type AccentKey, type FontPair } from './ui/Tweaks'
import type { SceneSettings } from './scene/Scene'

// Сцена грузится отдельным чанком и только если WebGL есть.
const Scene = lazy(() => import('./scene/Scene').then((m) => ({ default: m.Scene })))

/**
 * Страница намеренно пустая: ничего, кроме сцены и одной строки текста.
 * Контент витрины (меню, зал, бронь) вернётся позже — сейчас проверяется
 * только одно: держит ли кадр как фотография и как читается хореография.
 * Прокрутка существует не ради контента, а ради времени: она и есть плёнка.
 */
const SCROLL_SCREENS = 5

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function App() {
  const [locale, setLocale] = useState<Locale>('he')
  const [paused, setPaused] = useState(prefersReducedMotion)
  const [font, setFont] = useState<FontPair>('serif')
  const [accent, setAccent] = useState<AccentKey>('copper')
  const [settings, setSettings] = useState<SceneSettings>({ steam: 1, bloom: 0.55, grain: 0.03, focus: 0.03 })
  const [webgl] = useState(hasWebGL)
  const [progress, setProgress] = useState(0)

  const scrollRef = useRef(0)
  const t = COPY[locale]

  // Прогресс прокрутки 0..1 по всей длине страницы — им живёт вся хореография.
  // ?shot=0.42 замораживает прогресс на заданной точке: так кадры хореографии
  // снимаются детерминированно, без ручной прокрутки.
  useEffect(() => {
    const frozen = new URLSearchParams(window.location.search).get('shot')
    if (frozen !== null) {
      const p = Math.min(1, Math.max(0, Number(frozen) || 0))
      scrollRef.current = p
      setProgress(p)
      return
    }
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const travel = document.documentElement.scrollHeight - window.innerHeight
        const p = travel > 0 ? Math.min(1, Math.max(0, window.scrollY / travel)) : 0
        scrollRef.current = p
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

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--accent', ACCENTS[accent].value)
    root.style.setProperty('--font-display', FONT_PAIRS[font].display)
    root.style.setProperty('--font-body', FONT_PAIRS[font].body)
  }, [accent, font])

  // Титул уходит, как только начинается движение: дальше кадр должен быть чистым.
  const titleOpacity = Math.max(0, 1 - progress / 0.13)

  return (
    <>
      <div className="fixed inset-0 -z-10">
        {webgl ? (
          <Suspense fallback={<div className="h-full w-full bg-[#0a0908]" />}>
            <Scene paused={paused} settings={settings} scrollRef={scrollRef} />
          </Suspense>
        ) : (
          <div
            className="h-full w-full"
            style={{ background: 'radial-gradient(120% 80% at 22% 18%, #241a12 0%, #120e0b 45%, #0a0908 100%)' }}
          />
        )}
      </div>

      {/* Титул липнет к первому экрану и растворяется при первом же движении колеса */}
      <div
        className="pointer-events-none fixed inset-0 flex items-center px-[6vw]"
        style={{ opacity: titleOpacity, transition: 'opacity 120ms linear' }}
      >
        <div className="ms-auto max-w-[42ch] text-end">
          <h1
            className="text-[clamp(3.2rem,11vw,8rem)] leading-[0.9] text-[#efe7db]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {t.brand}
          </h1>
          <p className="mt-4 text-[clamp(1rem,2.2vw,1.5rem)] text-[#a99f92]" style={{ fontFamily: 'var(--font-body)' }}>
            {t.heroLine}
          </p>
        </div>
      </div>

      {/* Полоса прокрутки: пустая по содержанию, нужна только чтобы дать сцене время */}
      <main style={{ height: `${SCROLL_SCREENS * 100}svh` }} aria-hidden="true" />

      <Tweaks
        locale={locale}
        setLocale={setLocale}
        paused={paused}
        setPaused={setPaused}
        settings={settings}
        setSettings={setSettings}
        font={font}
        setFont={setFont}
        accent={accent}
        setAccent={setAccent}
        labels={{ tweaks: t.tweaks, pause: t.pause, play: t.play }}
      />
    </>
  )
}
