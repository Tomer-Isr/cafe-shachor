import { useEffect } from 'react'
import Lenis from 'lenis'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

/**
 * Плавная прокрутка всей страницы.
 *
 * Зачем. Колесо мыши на Windows выдаёт не непрерывное движение, а скачки
 * примерно по сто пикселей. Плёнку от этого спасало собственное демпфирование,
 * а текст двигался ступеньками вместе со страницей — и получался рассинхрон:
 * картинка плывёт, буквы прыгают. Глаз считывает это как рывки, даже когда
 * частота кадров ровно шестьдесят.
 *
 * Lenis перехватывает колесо и ведёт прокрутку сам, кадр за кадром. Тогда и
 * DOM, и плёнка читают одну и ту же гладкую позицию.
 *
 * Тач не трогаем: на телефоне инерцию рисует система, и она заметно лучше
 * любой эмуляции — перехват там только портит ощущение.
 */
export function useSmoothScroll(enabled = true) {
  useEffect(() => {
    if (!enabled) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    // Параметры подбираются замером ровности шага, а не на глаз:
    // ?lerp=0.1&wheel=0.8 — чтобы не пересобирать страницу на каждую пробу.
    const q = new URLSearchParams(window.location.search)
    const num = (name: string, def: number) => {
      const v = Number(q.get(name))
      return Number.isFinite(v) && v > 0 ? v : def
    }

    const lenis = new Lenis({
      // Насколько быстро прокрутка догоняет цель. Чем меньше, тем ровнее
      // размазывается щелчок колеса — и тем заметнее «резинка».
      lerp: num('lerp', 0.1),
      // Один щелчок колеса = один экранный шаг, а не рывок в полстраницы.
      wheelMultiplier: num('wheel', 0.8),
      smoothWheel: true,
      // На тач-устройствах инерция системная — она лучше.
      syncTouch: false,
    })

    // GSAP должен пересчитывать триггеры по позиции Lenis, иначе строки
    // выходят не там, где стоит страница.
    lenis.on('scroll', ScrollTrigger.update)

    const tick = (time: number) => lenis.raf(time * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)

    return () => {
      gsap.ticker.remove(tick)
      lenis.destroy()
    }
  }, [enabled])
}
