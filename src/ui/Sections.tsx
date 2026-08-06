import { useEffect, useMemo, useRef, useState } from 'react'
import { BEAN_OF_WEEK, CATEGORIES, MENU, beanIsFresh, type CategoryId } from '../content/menu'
import { CATEGORY_LABELS, type Copy, type Locale } from '../content/copy'

const base = import.meta.env.BASE_URL

/** id позиции → фото. Не у всех позиций есть кадр — карточка тогда текстовая. */
const PHOTOS: Record<string, string> = {
  cappuccino: 'cappuccino.jpg',
  v60: 'filter-v60.jpg',
  coldbrew: 'cold-brew.jpg',
  tonic: 'espresso-tonic.jpg',
  matcha: 'matcha.jpg',
  croissant: 'croissant.jpg',
  avocado: 'avocado-toast.jpg',
  shakshuka: 'shakshuka.jpg',
  cheesecake: 'cheesecake.jpg',
  choco_tart: 'chocolate-tart.jpg',
}

const DIET_MARK: Record<string, string> = { vegan: '🌱', gf: '🌾', spicy: '🌶' }

export function Price({ value }: { value: number }) {
  return <span className="price tabular-nums">{value} ₪</span>
}

/** Появление при прокрутке. Failsafe: через 2.5 с всё показывается в любом случае. */
export function Reveal({ children, className = '', delay = 0 }: React.PropsWithChildren<{ className?: string; delay?: number }>) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const show = () => el.classList.add('is-in')
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setTimeout(show, delay)),
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    )
    io.observe(el)
    const failsafe = setTimeout(show, 2500)
    return () => {
      io.disconnect()
      clearTimeout(failsafe)
    }
  }, [delay])
  return (
    <div ref={ref} className={`reveal ${className}`}>
      {children}
    </div>
  )
}

/**
 * Первый экран — три акта на трёх высотах прокрутки. Сцена под ними одна и живёт
 * непрерывно: предмет стоит → поворачивается печатью → наклоняется и льёт.
 * Текст меняется слоями поверх, поэтому сцена не перезапускается между актами.
 */
export function Hero({ t, onMenu, act }: { t: Copy; onMenu: () => void; act: 0 | 1 | 2 }) {
  return (
    <section className="relative h-[300svh]">
      <div className="sticky top-0 flex h-[100svh] flex-col justify-end overflow-hidden px-6 pb-28 sm:px-10 sm:pb-20 md:justify-center md:pb-0 md:pl-[50%] md:pr-12 lg:pr-20">
        {/* на мобиле текст лежит внизу поверх сцены — гасим её градиентом;
            на десктопе он в правой половине, и сцену подпирает боковая вуаль */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[#0a0908] via-[#0a0908]/72 to-transparent md:hidden" />
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[62%] md:block" style={{ background: 'linear-gradient(to left, #0a0908 34%, rgba(10,9,8,.82) 62%, transparent 100%)' }} />

        {/* акт 1 — представление */}
        <Act visible={act === 0}>
          <p className="t-caption mb-5">{t.heroFact}</p>
          <h1 className="t-display">{t.brand}</h1>
          <p className="mt-4 max-w-md text-xl text-[#c9c0b3] sm:text-2xl">{t.heroLine}</p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <button
              onClick={onMenu}
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
        </Act>

        {/* акт 2 — то, что написано на боку */}
        <Act visible={act === 1}>
          <p className="t-caption mb-5">02</p>
          <h2 className="t-h2 max-w-lg">{t.actTwoTitle}</h2>
          <p className="t-body mt-4 max-w-md text-[#c9c0b3]">{t.actTwoText}</p>
        </Act>

        {/* акт 3 — налив */}
        <Act visible={act === 2}>
          <p className="t-caption mb-5">03</p>
          <h2 className="t-h2 max-w-lg">{t.actThreeTitle}</h2>
          <p className="t-body mt-4 max-w-md text-[#c9c0b3]">{t.actThreeText}</p>
          <button
            onClick={onMenu}
            className="mt-8 bg-[var(--accent)] px-7 py-3.5 text-[15px] font-medium text-[#100a06] transition hover:brightness-110 active:scale-[.98]"
          >
            {t.ctaMenu}
          </button>
        </Act>
      </div>
    </section>
  )
}

function Act({ visible, children }: React.PropsWithChildren<{ visible: boolean }>) {
  return (
    <div
      aria-hidden={!visible}
      className={`relative transition-[opacity,transform] duration-700 ease-out ${
        visible ? 'opacity-100 translate-y-0' : 'pointer-events-none absolute bottom-28 opacity-0 translate-y-4 sm:bottom-20'
      }`}
    >
      {children}
    </div>
  )
}

export function Ticker({ t }: { t: Copy }) {
  const items = [...t.ticker, ...t.ticker]
  return (
    <div className="group relative overflow-hidden border-y border-[rgba(236,230,220,.1)] bg-[#0a0908] py-3.5">
      <div
        className="flex w-max gap-10 whitespace-nowrap motion-reduce:animate-none"
        style={{ animation: 'ticker 38s linear infinite' }}
      >
        {items.map((s, i) => (
          <span key={i} className="t-caption flex items-center gap-10">
            {s}
            <span className="text-[var(--accent)]">·</span>
          </span>
        ))}
      </div>
      <style>{`@keyframes ticker { from { transform: translateX(0) } to { transform: translateX(-50%) } }
        .group:hover [style*="ticker"] { animation-play-state: paused }
        @media (prefers-reduced-motion: reduce) { [style*="ticker"] { animation: none !important } }`}</style>
    </div>
  )
}

export function BeanBlock({ t, locale }: { t: Copy; locale: Locale }) {
  const bean = BEAN_OF_WEEK[locale]
  const fresh = beanIsFresh()
  const roasted = new Date(BEAN_OF_WEEK.roastedOn).toLocaleDateString(locale === 'he' ? 'he-IL' : 'ru-RU', {
    day: 'numeric',
    month: 'long',
  })
  return (
    <Reveal className="mx-auto max-w-5xl px-6 py-20 sm:px-10">
      <div className="border border-[rgba(236,230,220,.14)] bg-[#15120f]/70 p-7 backdrop-blur-sm sm:p-10">
        <p className="t-caption">{t.beanTitle}</p>
        <p className="t-h2 mt-3">{bean.origin}</p>
        <p className="t-body mt-2 text-[#c9c0b3]">
          {bean.process} · {bean.notes}
        </p>
        {fresh && (
          <p className="t-caption mt-5">
            {t.beanRoasted} <span className="price">{roasted}</span>
          </p>
        )}
      </div>
    </Reveal>
  )
}

export function Menu({ t, locale, anchorRef }: { t: Copy; locale: Locale; anchorRef: React.RefObject<HTMLElement | null> }) {
  const [cat, setCat] = useState<CategoryId>('espresso')
  const items = useMemo(() => MENU.filter((m) => m.category === cat), [cat])

  return (
    <section ref={anchorRef} id="menu" className="mx-auto max-w-6xl px-6 py-16 sm:px-10">
      <Reveal>
        <h2 className="t-h2">{t.menuTitle}</h2>
        <p className="t-body mt-3 max-w-xl text-[#93897c]">{t.menuNote}</p>
      </Reveal>

      {/* табы горизонтальным скроллом: на 360px перенос в три ряда съедал бы пол-экрана */}
      <div className="mt-9 -mx-6 overflow-x-auto px-6 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              aria-pressed={cat === c}
              className={`whitespace-nowrap border px-4 py-2 text-sm transition ${
                cat === c
                  ? 'border-[var(--accent)] bg-[var(--accent)]/12 text-[#ece6dc]'
                  : 'border-[rgba(236,230,220,.14)] text-[#93897c] hover:border-[rgba(236,230,220,.34)]'
              }`}
            >
              {CATEGORY_LABELS[locale][c]}
            </button>
          ))}
        </div>
      </div>

      <ul className="mt-8 grid gap-px bg-[rgba(236,230,220,.09)] sm:grid-cols-2">
        {items.map((m) => {
          const photo = PHOTOS[m.id]
          return (
            <li key={m.id} className="flex items-center gap-4 bg-[#0a0908] p-4">
              {photo ? (
                <img
                  src={`${base}photos/${photo}`}
                  alt=""
                  loading="lazy"
                  width={72}
                  height={72}
                  className="h-18 w-18 shrink-0 object-cover grayscale-[.35] transition duration-500 hover:grayscale-0"
                  style={{ height: 72, width: 72 }}
                />
              ) : (
                // без кадра — тонкая линия вместо пустой рамки: пустые боксы читаются как дырки
                <span className="shrink-0 self-stretch border-s border-[rgba(236,230,220,.16)]" style={{ width: 1, marginInlineEnd: 8 }} />
              )}
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[17px]">{locale === 'he' ? m.he : m.ru}</span>
                  {m.diet?.map((d) => (
                    <span key={d} className="text-xs opacity-70" title={d}>
                      {DIET_MARK[d]}
                    </span>
                  ))}
                  {m.bean && <span className="t-caption text-[10px] text-[var(--accent)]">{t.beanTitle}</span>}
                </p>
                {m.friday && <p className="t-caption mt-1 text-[10px]">{locale === 'he' ? 'בימי שישי בלבד' : 'только по пятницам'}</p>}
              </div>
              <span className="text-[17px] text-[#c9c0b3]">
                <Price value={m.price} />
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function Space({ t }: { t: Copy }) {
  const photos = ['space-1-room.jpg', 'space-2-barista.jpg', 'space-3-guests.jpg', 'space-4-detail.jpg']
  return (
    <section className="mx-auto max-w-6xl px-6 py-16 sm:px-10">
      <Reveal className="grid gap-10 md:grid-cols-[1fr_1.1fr] md:items-center">
        <div>
          <h2 className="t-h2">{t.spaceTitle}</h2>
          <p className="t-body mt-4 text-[#c9c0b3]">{t.spaceText}</p>
          <ul className="mt-7 grid grid-cols-2 gap-x-6 gap-y-3">
            {t.spaceFacts.map((f) => (
              <li key={f} className="t-caption border-t border-[rgba(236,230,220,.12)] pt-3">
                {f}
              </li>
            ))}
          </ul>
        </div>
        <div className="grid grid-cols-2 gap-px bg-[rgba(236,230,220,.09)]">
          {photos.map((p, i) => (
            <img
              key={p}
              src={`${base}photos/${p}`}
              alt=""
              loading="lazy"
              className={`aspect-[4/5] w-full object-cover ${i === 0 ? 'grayscale-[.2]' : 'grayscale-[.45]'} transition duration-700 hover:grayscale-0`}
            />
          ))}
        </div>
      </Reveal>
    </section>
  )
}

export function Loyalty({ t }: { t: Copy }) {
  const [stamps, setStamps] = useState(() => Number(localStorage.getItem('shachor.stamps.v1') ?? 2))
  useEffect(() => {
    localStorage.setItem('shachor.stamps.v1', String(stamps))
  }, [stamps])

  return (
    <section className="mx-auto max-w-5xl px-6 py-16 sm:px-10">
      <Reveal className="border border-[rgba(236,230,220,.14)] p-7 sm:p-10">
        <h2 className="t-h2">{t.loyaltyTitle}</h2>
        <p className="t-body mt-3 text-[#93897c]">{t.loyaltyText}</p>
        <div className="mt-7 flex gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <button
              key={i}
              onClick={() => setStamps(i + 1 === stamps ? i : i + 1)}
              aria-label={`${i + 1}`}
              className={`h-11 w-11 border transition ${
                i < stamps
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-[#100a06]'
                  : 'border-[rgba(236,230,220,.2)] text-[#93897c] hover:border-[rgba(236,230,220,.45)]'
              } ${i === 5 ? 'rounded-full' : ''}`}
            >
              {i === 5 ? '★' : i + 1}
            </button>
          ))}
        </div>
      </Reveal>
    </section>
  )
}

export function Booking({ t, locale }: { t: Copy; locale: Locale }) {
  const [guests, setGuests] = useState(2)
  const [time, setTime] = useState('19:00')
  const slots = ['17:00', '17:30', '18:00', '18:30', '19:00', '19:30']

  const text =
    locale === 'he'
      ? `שלום! אשמח לשולחן בחצר · ${guests} סועדים · ${time}`
      : `Здравствуйте! Хочу стол во дворике · ${guests} гостей · ${time}`
  const wa = `https://wa.me/972300000000?text=${encodeURIComponent(text)}`

  return (
    <section id="book" className="mx-auto max-w-5xl px-6 py-16 sm:px-10">
      <Reveal className="bg-[#15120f] p-7 sm:p-10">
        <h2 className="t-h2">{t.bookTitle}</h2>
        <p className="t-body mt-3 max-w-lg text-[#c9c0b3]">{t.bookRule}</p>
        <p className="t-caption mt-2">{t.bookHold}</p>

        <div className="mt-8 flex flex-wrap gap-8">
          <div>
            <p className="t-caption mb-3">{locale === 'he' ? 'סועדים' : 'Гостей'}</p>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5, 6].map((g) => (
                <button
                  key={g}
                  onClick={() => setGuests(g)}
                  aria-pressed={guests === g}
                  className={`h-10 w-10 border text-sm transition ${
                    guests === g ? 'border-[var(--accent)] text-[#ece6dc]' : 'border-[rgba(236,230,220,.16)] text-[#93897c]'
                  }`}
                >
                  <span className="price">{g}</span>
                </button>
              ))}
            </div>
            {guests >= 5 && (
              <p className="t-caption mt-3 max-w-xs normal-case tracking-normal text-[var(--accent)]">
                {locale === 'he' ? 'מצמידים שני שולחנות — בחצר יש ארבעה.' : 'Сдвигаем два стола — во дворике их четыре.'}
              </p>
            )}
          </div>

          <div>
            <p className="t-caption mb-3">{locale === 'he' ? 'שעה' : 'Время'}</p>
            <div className="flex flex-wrap gap-2">
              {slots.map((s) => (
                <button
                  key={s}
                  onClick={() => setTime(s)}
                  aria-pressed={time === s}
                  className={`border px-3 py-2 text-sm transition ${
                    time === s ? 'border-[var(--accent)] text-[#ece6dc]' : 'border-[rgba(236,230,220,.16)] text-[#93897c]'
                  }`}
                >
                  <span className="price">{s}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* без экрана «бронь подтверждена»: подтверждает живой человек в переписке */}
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-9 inline-block bg-[var(--accent)] px-7 py-3.5 text-[15px] font-medium text-[#100a06] transition hover:brightness-110"
        >
          {t.bookCta}
        </a>
      </Reveal>
    </section>
  )
}

export function Visit({ t, locale }: { t: Copy; locale: Locale }) {
  const todayIdx = new Date().getDay() // 0 = вс
  const rowIdx = todayIdx === 6 ? 2 : todayIdx === 5 ? 1 : 0
  return (
    <section className="mx-auto max-w-5xl px-6 py-16 sm:px-10">
      <Reveal className="grid gap-10 sm:grid-cols-2">
        <div>
          <h2 className="t-h2">{t.visitTitle}</h2>
          <table className="mt-6 w-full text-[15px]">
            <tbody>
              {t.hoursRows.map(([d, h], i) => (
                <tr key={d} className={i === rowIdx ? 'text-[#ece6dc]' : 'text-[#93897c]'}>
                  <td className="border-t border-[rgba(236,230,220,.1)] py-2.5">{d}</td>
                  <td className="border-t border-[rgba(236,230,220,.1)] py-2.5 text-end">
                    <span className="price">{h}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="t-caption mt-5">{t.kosherOn}</p>
        </div>
        <div className="flex flex-col justify-center gap-2 text-[15px] text-[#c9c0b3]">
          <p>{t.visitAddress}</p>
          <p className="price">{t.visitPhone}</p>
          <a
            href="https://wa.me/972300000000"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 w-fit border border-[rgba(236,230,220,.25)] px-5 py-2.5 text-sm transition hover:border-[rgba(236,230,220,.6)]"
          >
            WhatsApp
          </a>
          <p className="t-caption mt-4 normal-case tracking-normal">
            {locale === 'he' ? 'הכתובת בדיונית — זהו קונספט הדגמה.' : 'Адрес вымышленный — это демо-концепт.'}
          </p>
        </div>
      </Reveal>
    </section>
  )
}

export function Footer({ t }: { t: Copy }) {
  return (
    <footer className="mx-auto max-w-6xl px-6 pb-16 pt-10 sm:px-10">
      <div className="rule mb-6" />
      <p className="t-caption normal-case tracking-normal">{t.footerDemo}</p>
      <p className="t-caption mt-2 normal-case tracking-normal">{t.footerBy}</p>
    </footer>
  )
}
