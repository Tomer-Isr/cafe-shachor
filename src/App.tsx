import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { COPY, type Locale } from './content/copy'
import { BeanBlock, Booking, Footer, Hero, Loyalty, Menu, Space, Ticker, Visit } from './ui/Sections'
import { ACCENTS, FONT_PAIRS, Tweaks, type AccentKey, type FontPair } from './ui/Tweaks'
import type { SceneSettings } from './scene/Scene'

// Сцена грузится отдельным чанком и только если WebGL есть — витрина не должна
// зависеть от того, потянуло ли устройство 3D.
const Scene = lazy(() => import('./scene/Scene').then((m) => ({ default: m.Scene })))

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
  const [settings, setSettings] = useState<SceneSettings>({ steam: 1.05, bloom: 0.62, grain: 0.035, focus: 0.028 })
  const [webgl] = useState(hasWebGL)
  const [heroVisible, setHeroVisible] = useState(true)
  const [act, setAct] = useState<0 | 1 | 2>(0)

  const scrollRef = useRef(0)
  const menuRef = useRef<HTMLElement | null>(null)
  const t = COPY[locale]

  // прогресс прокрутки первого экрана — им живёт камера и уход чашки вглубь
  useEffect(() => {
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const h = window.innerHeight
        // Первый экран — секция в три высоты с липким содержимым. Липкий блок
        // отлипает, когда до конца секции остаётся один экран, поэтому вся
        // хореография укладывается в 2h, а не в 3h — иначе третий акт не доигрывает.
        const progress = Math.min(1, window.scrollY / (h * 2))
        scrollRef.current = progress
        // сцена гасится, когда первый экран ушёл: не жжём кадры под контентом
        setHeroVisible(window.scrollY < h * 2.25)
        setAct(progress < 0.34 ? 0 : progress < 0.66 ? 1 : 2)
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
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

  const sceneAsleep = paused || !heroVisible

  return (
    <>
      {/* Фон-сцена: fixed за контентом. Без WebGL — градиент вместо чёрного экрана. */}
      <div className="fixed inset-0 -z-10">
        {webgl ? (
          <Suspense fallback={<div className="h-full w-full bg-[#0a0908]" />}>
            <Scene paused={sceneAsleep} settings={settings} scrollRef={scrollRef} />
          </Suspense>
        ) : (
          <div
            className="h-full w-full"
            style={{ background: 'radial-gradient(120% 80% at 22% 18%, #241a12 0%, #120e0b 45%, #0a0908 100%)' }}
          />
        )}
      </div>

      <main className="relative">
        <Hero t={t} act={act} onMenu={() => menuRef.current?.scrollIntoView({ behavior: paused ? 'auto' : 'smooth' })} />

        {/* всё, что ниже первого экрана, живёт на плотном фоне: текст читается, сцена спит */}
        <div className="relative bg-[#0a0908]">
          <Ticker t={t} />
          <BeanBlock t={t} locale={locale} />
          <Menu t={t} locale={locale} anchorRef={menuRef} />
          <Space t={t} />
          <Loyalty t={t} />
          <Booking t={t} locale={locale} />
          <Visit t={t} locale={locale} />
          <Footer t={t} />
        </div>
      </main>

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
