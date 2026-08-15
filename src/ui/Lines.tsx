import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText)

/**
 * Текст, который выходит строка за строкой из-под маски — под ритм камеры,
 * а не поверх него.
 *
 * Почему SplitText, а не «анимировать абзац целиком»: строка — единица чтения,
 * и когда они появляются по очереди, глаз идёт за текстом сам. Целый абзац,
 * выплывающий разом, читается как всплывающее окно.
 *
 * Три вещи, на которых этот приём обычно ломается, и что с ними сделано:
 *
 *  • Шрифт догружается позже разбиения — строки ломаются в других местах, и
 *    маски разъезжаются. Лечится `autoSplit`: плагин пересобирает разбиение
 *    сам, когда меняются шрифт или ширина окна.
 *  • Текст залипает невидимым, если наблюдатель промахнулся мимо секции.
 *    Поэтому здесь есть страховка: через две с половиной секунды строки
 *    показываются в любом случае. Пустой экран — цена, которую платить нельзя.
 *  • Смена языка меняет длину строк, и старое разбиение остаётся от прежнего
 *    текста. Разбиение пересобирается по ключу локали.
 */
interface Props {
  children: React.ReactNode
  className?: string
  /** локаль: смена пересобирает разбиение под новый текст */
  locale: string
  /** задержка перед первой строкой, секунды */
  delay?: number
  /** шаг между строками, секунды */
  stagger?: number
}

export function Lines({ children, className = '', locale, delay = 0, stagger = 0.085 }: Props) {
  const root = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const el = root.current
      if (!el) return

      // Уважаем системную настройку: там, где движение просят выключить,
      // текст просто стоит на месте.
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

      let shown = false
      const split = SplitText.create(el, {
        type: 'lines',
        mask: 'lines',
        autoSplit: true,
        onSplit(self) {
          return gsap.from(self.lines, {
            yPercent: 108,
            opacity: 0,
            duration: 0.85,
            ease: 'power3.out',
            stagger,
            delay,
            // Строки не должны прятаться сразу при создании: пока секция не
            // подъехала, текст остаётся обычным текстом — так его видит и
            // поисковик, и читатель без JS.
            immediateRender: false,
            scrollTrigger: {
              trigger: el,
              start: 'top 88%',
              // Уехали назад — строки убираются, вернулись — выходят снова.
              toggleActions: 'play none none reverse',
              onEnter: () => {
                shown = true
              },
            },
          })
        },
      })

      // Страховка: если наблюдатель по любой причине не сработал, показываем.
      const failsafe = window.setTimeout(() => {
        if (!shown) gsap.set(split.lines, { yPercent: 0, opacity: 1 })
      }, 2500)

      return () => {
        window.clearTimeout(failsafe)
        split.revert()
      }
    },
    { scope: root, dependencies: [locale, delay, stagger] },
  )

  return (
    <div ref={root} className={className}>
      {children}
    </div>
  )
}
