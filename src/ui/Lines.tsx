import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import { speedAt, timingFor, windowFor } from '../film/motion'

/**
 * Текст, который стелется строка за строкой вслед за кадром.
 *
 * Разбор механики и чисел — docs/LINE-MOTION.md. Коротко устройство:
 *
 *  • **Прокрутка решает, какая строка уже начала ложиться** — счётчик, который
 *    только растёт. **Как** она ложится — свой временной твин. Чистый скраб
 *    сюда не годится: строка отматывалась бы назад при возврате вверх и
 *    замирала бы на середине, если палец остановился, — читать невозможно.
 *  • **Стелется** — это три вещи вместе: маска раскрывает строку сверху вниз,
 *    сдвиг маски задаёт направление по ходу чтения, а наклон от скорости
 *    прокрутки с точкой отсчёта у края чтения даёт инерцию хвоста. Голова
 *    строки стоит, хвост догоняет и выпрямляется.
 *  • **Длительность берётся в момент выпуска строки**, а не при разбиении:
 *    иначе скорость камеры читается один раз на старте, когда плёнка ещё в
 *    самом начале, и связь с кадром существует только на бумаге.
 *  • Прокрутка встала, а строки остались — через 220 мс выпускаем оставшиеся.
 *    Ни одна анимация не имеет права мешать чтению.
 */

type Level = 'display' | 'h2' | 'lead' | 'body' | 'caption'

/** Скрытое положение строки в процентах — выведено из межстрочного и запаса маски. */
const HIDDEN: Record<Level, number> = {
  display: 145,
  h2: 124,
  lead: 112,
  body: 110,
  caption: 112,
}
/** Прозрачность добавляется только крупным: на большом кегле край маски слишком жёсткий. */
const FADES: Level[] = ['display', 'h2']

const MIN_GAP = 0.055 // с — ниже строки сливаются в один «хлоп»
const IDLE = 220 // мс тишины прокрутки → дожать оставшиеся
const DRIFT = { em: 0.22, maxPx: 20 }
const SKEW = { max: 1.2, ref: 2400, width: 480 }

interface Props {
  children: React.ReactNode
  className?: string
  /** локаль: смена пересобирает разбиение и пересчитывает триггеры */
  locale: string
  /** типографический уровень — от него скрытое положение и запас маски */
  level?: Level
  /** положение блока на плёнке 0..1: из него окно раскладки и длительность */
  film?: number
  /** 'intro' — блок виден сразу при загрузке, вести прокруткой нечем */
  mode?: 'film' | 'intro'
  delay?: number
}

export function Lines({
  children,
  className = '',
  locale,
  level = 'body',
  film = 0,
  mode = 'film',
  delay = 0,
}: Props) {
  const root = useRef<HTMLDivElement>(null)
  /** сколько строк уже уложено — переживает пересборку разбиения */
  const laid = useRef(0)

  useGSAP(
    () => {
      const el = root.current
      if (!el) return

      const mm = gsap.matchMedia()

      mm.add(
        { motion: '(prefers-reduced-motion: no-preference)', small: '(max-width: 640px)' },
        (ctx) => {
          const { motion, small } = ctx.conditions as Record<string, boolean>
          // Просят выключить движение — не разбиваем вовсе. Текст остаётся
          // текстом: так его видит и поисковик, и скринридер, и DOM чист.
          if (!motion) return

          // Направление берём у самого элемента, а не у документа: цены внутри
          // ивритского текста принудительно левосторонние.
          const rtl = getComputedStyle(el).direction === 'rtl'
          const sign = rtl ? 1 : -1
          const origin = rtl ? 'right center' : 'left center'
          const hidden = HIDDEN[level]
          const fades = FADES.includes(level)
          const driftEm = small ? DRIFT.em * 0.6 : DRIFT.em
          const skewMax = small ? SKEW.max * 0.7 : SKEW.max

          const split = SplitText.create(el, {
            type: 'lines',
            mask: 'lines',
            // Без своего класса маски безымянные, и запас против срезанных
            // букв применить не к чему.
            linesClass: 'line',
            autoSplit: true,
            onSplit(self) {
              const lines = self.lines as HTMLElement[]
              const masks = (self as unknown as { masks: HTMLElement[] }).masks ?? []
              let clock = 0

              /** Единственное определение «строка на месте» — им же пользуется страховка. */
              const rest = (i: number) =>
                gsap.set([lines[i], masks[i]].filter(Boolean), {
                  clearProps: 'transform,opacity,willChange',
                })

              const hide = (from: number) => {
                gsap.set(lines.slice(from), {
                  yPercent: hidden,
                  ...(fades && { opacity: 0 }),
                  willChange: 'transform',
                })
                if (masks.length) gsap.set(masks.slice(from), { willChange: 'transform' })
              }

              /** Уложить строку i. vel — скорость прокрутки, px/с. */
              const lay = (i: number, vel: number, gapMin = MIN_GAP) => {
                // Тайминг берётся здесь — в момент выпуска, когда камера уже
                // в этой точке ленты.
                const { duration } = timingFor(speedAt(film))
                const px = parseFloat(getComputedStyle(lines[i]).fontSize) || 16
                const drift = Math.min(DRIFT.maxPx, px * driftEm)
                const w = lines[i].offsetWidth || SKEW.width
                const skew =
                  gsap.utils.clamp(-1, 1, vel / SKEW.ref) *
                  skewMax *
                  Math.min(1, SKEW.width / w) *
                  (rtl ? -1 : 1)

                const wait = Math.max(0, clock + gapMin - gsap.ticker.time)
                clock = gsap.ticker.time + wait

                const tl = gsap.timeline({
                  delay: wait + (i === 0 ? delay : 0),
                  onComplete: () => rest(i),
                })
                if (masks[i]) {
                  tl.fromTo(
                    masks[i],
                    { x: sign * drift, skewY: skew, transformOrigin: origin },
                    { x: 0, skewY: 0, duration, ease: 'e-out' },
                    0,
                  )
                }
                tl.fromTo(
                  lines[i],
                  { yPercent: hidden, ...(fades && { opacity: 0 }) },
                  { yPercent: 0, ...(fades && { opacity: 1 }), duration, ease: 'e-out' },
                  0,
                )
              }

              // Пересборка разбиения (догрузился шрифт, изменилась ширина):
              // что уже лежало — ставим на место мгновенно, без повторной игры.
              for (let i = 0; i < Math.min(laid.current, lines.length); i++) rest(i)

              if (mode === 'intro') {
                hide(laid.current)
                const run = () => {
                  const { stagger } = timingFor(speedAt(film))
                  for (let i = laid.current; i < lines.length; i++) lay(i, 0, stagger)
                  laid.current = lines.length
                }
                if (document.fonts) document.fonts.ready.then(run)
                else run()
                return
              }

              // Взвод: за экран до выхода прячем строки и поднимаем слои.
              const arm = ScrollTrigger.create({
                trigger: el,
                start: 'top 100%',
                once: true,
                onEnter: () => hide(laid.current),
              })

              let idleId = 0
              const layout = ScrollTrigger.create({
                trigger: el,
                start: 'top 84%',
                end: () => '+=' + window.innerHeight * windowFor(speedAt(film)),
                invalidateOnRefresh: true,
                onUpdate(self) {
                  const want = Math.ceil(self.progress * lines.length)
                  while (laid.current < want) lay(laid.current++, self.getVelocity())

                  window.clearTimeout(idleId)
                  if (laid.current < lines.length) {
                    idleId = window.setTimeout(() => {
                      while (laid.current < lines.length) lay(laid.current++, 0)
                    }, IDLE)
                  }
                },
              })

              return () => {
                window.clearTimeout(idleId)
                arm.kill()
                layout.kill()
              }
            },
          })

          return () => split.revert()
        },
      )

      return () => mm.revert()
    },
    // revertOnUpdate обязателен: иначе откат откладывается до размонтирования,
    // и каждая смена языка оставляет позади живой набор триггеров.
    { scope: root, dependencies: [locale, level, film, mode], revertOnUpdate: true },
  )

  return (
    <div ref={root} className={className}>
      {children}
    </div>
  )
}
