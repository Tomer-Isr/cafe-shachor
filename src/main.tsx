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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
