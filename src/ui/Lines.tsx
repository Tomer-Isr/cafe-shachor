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
 *
 * 🔴 Две вещи, из-за которых всё это раньше не доезжало до экрана — обе
 * механические, обе проверены на живом стенде:
 *
 *  1. **SplitText не умеет искать переносы в письме справа налево.** Он ставит
 *     границу строки там, где слово «уехало влево» (`SplitText.js` 3.15.0:
 *     `curBounds.top > lastBounds.top && curBounds.left < lastBounds.left +
 *     lastBounds.width - 1`). В иврите слово уезжает вправо — условие не
 *     срабатывает ни разу, и весь абзац становится одной «строкой». На проде
 *     это давало ровно 11 элементов `.line` на 11 блоков: разбиения не было
 *     вовсе, и очереди из строк взяться было неоткуда.
 *     Лечится замером: на время разбиения элемент переводится в `ltr`. Набор
 *     слов в строке от направления письма не зависит (перенос считается по
 *     ширинам, а порядок слов в потоке один и тот же) — проверено на живом
 *     тексте: группы слов в rtl и в ltr совпадают до символа. Порядок внутри
 *     строки восстанавливается сам, как только направление вернули.
 *  2. **SplitText не вызывает то, что вернул `onSplit`.** В исходнике возврат
 *     используется, только если это анимация (`onSplitResult.totalTime`).
 *     Значит «функция уборки» из `onSplit` не вызывалась никогда, а при каждой
 *     пересборке (шрифт догрузился, изменилась ширина) оставался живой набор
 *     ScrollTrigger'ов поверх нового. Счётчик уложенных строк у них общий:
 *     мёртвый триггер выбирал его на оторванных от документа узлах, а живой
 *     видел «всё уже уложено» и не трогал ничего. Отсюда и предупреждения
 *     `GSAP target not found` — `gsap.set` на пустом срезе.
 *     Лечится тем, что триггеры держим сами и гасим первым делом в `onSplit`.
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

/**
 * Пока гарнитуры не разложены, переносы считаются по фолбэку и врут.
 * Флаг общий на страницу и поднимается раньше, чем сработает любая пересборка
 * в компоненте: подписка оформлена здесь, при загрузке модуля.
 */
const FONTS: Promise<unknown> =
  typeof document !== 'undefined' && document.fonts ? document.fonts.ready : Promise.resolve()
let fontsReady = false
void FONTS.then(() => {
  fontsReady = true
})

/** Разбиение меняет высоту блоков. Пересчитываем триггеры один раз на всех. */
let refreshId = 0
const refreshSoon = () => {
  window.clearTimeout(refreshId)
  refreshId = window.setTimeout(() => ScrollTrigger.refresh(), 80)
}

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
          // ивритского текста принудительно левосторонние. И читаем его заново
          // на каждой пересборке: между разбиениями язык мог смениться, а
          // запомненный флаг тогда зеркалит движение в обратную сторону — и,
          // хуже, отменяет замер в LTR.
          const isRtl = () => getComputedStyle(el).direction === 'rtl'
          const hidden = HIDDEN[level]
          const fades = FADES.includes(level)
          const driftEm = small ? DRIFT.em * 0.6 : DRIFT.em
          const skewMax = small ? SKEW.max * 0.7 : SKEW.max

          /**
           * Разбиение считается в LTR — иначе SplitText не находит ни одного
           * переноса (см. п. 1 в шапке). Выравнивание при этом надо назвать
           * явно: `start` в ltr разложится в `left`, а SplitText запекает
           * посчитанное значение в каждую строку.
           */
          const measured = <T,>(fn: () => T): T => {
            if (!isRtl()) return fn()
            const dir = el.style.direction
            const ta = el.style.textAlign
            const computed = getComputedStyle(el).textAlign
            const align = computed === 'start' ? 'right' : computed === 'end' ? 'left' : computed
            el.style.direction = 'ltr'
            el.style.textAlign = align
            try {
              return fn()
            } finally {
              el.style.direction = dir
              el.style.textAlign = ta
            }
          }

          /**
           * Триггеры текущего разбиения. Держим сами: SplitText возврат
           * `onSplit` не вызывает (п. 2 в шапке), и без этого каждая пересборка
           * оставляла позади живой набор, деливший с новым общий счётчик строк.
           */
          let live: ScrollTrigger[] = []
          let idleId = 0
          const dropTriggers = () => {
            window.clearTimeout(idleId)
            idleId = 0
            live.forEach((t) => t.kill())
            live = []
          }

          const vars: SplitText.Vars = {
            type: 'lines',
            mask: 'lines',
            // Без своего класса маски безымянные, и запас против срезанных
            // букв применить не к чему.
            linesClass: 'line',
            // Пересборкой правим сами: свою SplitText сделал бы уже в rtl,
            // то есть заново собрал бы абзац в одну строку.
            autoSplit: false,
            onSplit(self) {
              dropTriggers()

              const lines = self.lines as HTMLElement[]
              const masks = self.masks as HTMLElement[]
              // Сторона, откуда читают, — на момент этого разбиения.
              const rtl = isRtl()
              const sign = rtl ? 1 : -1
              const origin = rtl ? 'right center' : 'left center'
              let clock = 0
              /**
               * Задержка блока уже отыграна.
               *
               * `delay` разводит по времени метку, заголовок и абзац — то есть
               * сдвигает **весь** каскад блока. Пока он висел на первой строке
               * персонально, она уходила в конец очереди: вторая ждала 55 мс,
               * третья 110, а первая — свои 200. Абзац выходил задом наперёд.
               */
              let headDone = laid.current > 0

              /** Единственное определение «строка на месте» — им же пользуется страховка. */
              const rest = (i: number) => {
                const t = [lines[i], masks[i]].filter(Boolean)
                if (t.length) gsap.set(t, { clearProps: 'transform,opacity,willChange' })
              }

              const hide = (from: number) => {
                const l = lines.slice(from)
                if (!l.length) return
                gsap.set(l, {
                  yPercent: hidden,
                  ...(fades && { opacity: 0 }),
                  willChange: 'transform',
                })
                const m = masks.slice(from)
                if (m.length) gsap.set(m, { willChange: 'transform' })
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

                const head = headDone ? 0 : delay
                headDone = true
                const wait = head + Math.max(0, clock + gapMin - gsap.ticker.time)
                clock = gsap.ticker.time + wait

                const tl = gsap.timeline({ delay: wait, onComplete: () => rest(i) })
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
                // Блок виден при загрузке, вести прокруткой нечем — играем по
                // времени. Но только когда шрифты разложены: до этого переносы
                // посчитаны по фолбэку, и пересборка оборвёт выход на середине.
                // Пока ждём — текст просто текст, а не спрятанный текст.
                if (!fontsReady) return
                hide(laid.current)
                const { stagger } = timingFor(speedAt(film))
                for (let i = laid.current; i < lines.length; i++) lay(i, 0, stagger)
                laid.current = lines.length
                return
              }

              // Взвод: за экран до выхода прячем строки и поднимаем слои.
              live.push(
                ScrollTrigger.create({
                  trigger: el,
                  start: 'top 100%',
                  once: true,
                  onEnter: () => hide(laid.current),
                }),
              )

              live.push(
                ScrollTrigger.create({
                  trigger: el,
                  start: 'top 84%',
                  end: () => '+=' + window.innerHeight * windowFor(speedAt(film)),
                  invalidateOnRefresh: true,
                  // Блок уже пройден к моменту пересчёта — перезагрузка на
                  // середине страницы, переход по якорю, смена размера окна.
                  // Анимировать позади себя нечего, но и висеть спрятанным
                  // строке нельзя: ставим её на место молча.
                  onRefresh(self) {
                    if (self.progress <= 0) return
                    while (laid.current < lines.length) rest(laid.current++)
                  },
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
                }),
              )
            },
          }

          const split = measured(() => SplitText.create(el, vars))

          // Пересборка. Своей у SplitText нет — `autoSplit` выключен, потому
          // что он пересобрал бы в rtl и снова склеил абзац в одну строку.
          let dead = false
          let width = el.offsetWidth
          const resplit = () => {
            if (dead) return
            measured(() => split.split(vars))
            refreshSoon()
          }

          // Шрифт догрузился — переносы поехали, считать их надо заново.
          void FONTS.then(resplit)

          // Ширина колонки изменилась — то же самое. Сравниваем ширину, а не
          // высоту: высота меняется от самой пересборки, и это был бы цикл.
          let roId = 0
          const ro =
            typeof ResizeObserver !== 'undefined'
              ? new ResizeObserver(() => {
                  window.clearTimeout(roId)
                  roId = window.setTimeout(() => {
                    if (dead || el.offsetWidth === width) return
                    width = el.offsetWidth
                    resplit()
                  }, 200)
                })
              : null
          ro?.observe(el)

          return () => {
            dead = true
            ro?.disconnect()
            window.clearTimeout(roId)
            dropTriggers()
            split.revert()
          }
        },
      )

      return () => mm.revert()
    },
    // revertOnUpdate обязателен: иначе откат откладывается до размонтирования,
    // и каждая смена языка оставляет позади живой набор триггеров.
    { scope: root, dependencies: [locale, level, film, mode], revertOnUpdate: true },
  )

  // key по локали — не про производительность, а про корректность. Разбиение
  // выкидывает исходный текстовый узел и ставит на его место свои. React про
  // это не знает: при смене языка он пишет новый текст в узел, которого в
  // документе давно нет, и на экране остаётся прежний язык. Ключ заставляет
  // его собрать поддерево заново — и разбиение начинается с чистого текста.
  return (
    <div key={locale} ref={root} className={className}>
      {children}
    </div>
  )
}
