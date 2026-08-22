import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import { CustomEase } from 'gsap/CustomEase'
import './index.css'
import App from './App.tsx'

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText, CustomEase)

// Те же кривые, что в CSS-токенах: движение текста и переходы состояний обязаны
// идти по одной кривой, иначе страница ощущается собранной из двух разных.
// expo.out похож на --e-out, но это НЕ та же кривая.
CustomEase.create('e-out', '0.16, 1, 0.30, 1')
CustomEase.create('e-inout', '0.65, 0, 0.35, 1')

// На iOS адресная строка сворачивается при прокрутке, меняет высоту окна и
// вызывает refresh — он сбросил бы окна раскладки прямо посреди выхода строк.
ScrollTrigger.config({ ignoreMobileResize: true, limitCallbacks: true })

// Пока шрифты не разложены, строки ломаются по фолбэку, и все start/end
// посчитаны не по тому тексту.
document.fonts?.ready.then(() => ScrollTrigger.refresh())

/**
 * Последний рубеж (LINE-MOTION §9.1): строка в кадре, спрятана и ничем не
 * анимируется — показать. Проверяется состояние, а не время: таймер внутри
 * компонента срабатывал бы на норме (блок в пяти экранах ниже) и не срабатывал
 * на аварии. `getTweensOf`, а не `isTweening`: твин, ждущий своей очереди в
 * каскаде, ещё не идёт, но уже существует — трогать его нельзя.
 */
const net = () => {
  document.querySelectorAll<HTMLElement>('.line').forEach((l) => {
    const r = l.getBoundingClientRect()
    if (r.top >= window.innerHeight || r.bottom <= 0) return
    const hidden =
      Number(gsap.getProperty(l, 'opacity')) === 0 ||
      Math.abs(Number(gsap.getProperty(l, 'yPercent'))) > 1
    if (hidden && !gsap.getTweensOf(l).length) {
      gsap.set(l, { clearProps: 'transform,opacity,willChange' })
    }
  })
}
window.addEventListener('load', () => window.setTimeout(net, 1500))
document.fonts?.ready.then(() => window.setTimeout(net, 1500))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
