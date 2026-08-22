import { useEffect, useState } from 'react'

/**
 * Панель «что происходит на ЭТОЙ машине». Открывается по `?debug=1`.
 *
 * Зачем. Замеры со стороны разработчика ничего не говорят о машине владельца:
 * там своя видеокарта, своя плотность пикселей и свои системные настройки.
 * Дважды подряд получилось так, что здесь всё ровно, а там «подглючивает» —
 * гадать дальше бессмысленно. Панель показывает всё, что решает поведение
 * сцены, одним экраном, чтобы прислать скриншот и закончить спор.
 *
 * Главная строка — «меньше движения». Если система просит уменьшить анимацию,
 * страница выключает плавную прокрутку, разбиение текста на строки и
 * сглаживание плёнки — и выглядит ровно так, как её описывают жалобы.
 */

type Row = { label: string; value: string; bad?: boolean }

export function Diagnostics() {
  const [fps, setFps] = useState({ now: 0, min: 999, drops: 0 })
  const [rows, setRows] = useState<Row[]>([])

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const canvas = document.querySelector('canvas')
    const gl = canvas?.getContext('webgl2')
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info')
    const card = dbg ? String(gl?.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'не сообщается'

    const script = [...document.querySelectorAll('script[src]')]
      .map((s) => (s as HTMLScriptElement).src)
      .find((s) => /assets\/index-/.test(s))
    const build = script ? script.split('/').pop() ?? '?' : '?'

    const filmDir = performance
      .getEntriesByType('resource')
      .map((r) => r.name)
      .find((n) => /\/film(-hd|-xl)?\/frame-/.test(n))
    const film = filmDir ? (filmDir.match(/\/(film(?:-hd|-xl)?)\//)?.[1] ?? '?') : 'ещё не грузилась'

    setRows([
      { label: 'версия сборки', value: build },
      {
        label: 'меньше движения',
        value: reduce ? 'ВКЛЮЧЕНО — анимации выключены' : 'выключено (норма)',
        bad: reduce,
      },
      { label: 'плавная прокрутка', value: document.documentElement.classList.contains('lenis') ? 'работает' : 'НЕТ', bad: !document.documentElement.classList.contains('lenis') },
      { label: 'WebGL2', value: gl ? 'работает' : 'НЕТ — запасная канва', bad: !gl },
      { label: 'видеокарта', value: card },
      { label: 'окно', value: `${window.innerWidth}x${window.innerHeight}, плотность ${window.devicePixelRatio}` },
      { label: 'холст', value: canvas ? `${canvas.width}x${canvas.height}` : 'нет' },
      { label: 'плёнка', value: film },
      { label: 'строк текста разбито', value: String(document.querySelectorAll('.line').length) },
    ])
  }, [])

  useEffect(() => {
    let raf = 0
    let prev = performance.now()
    let min = 999
    let drops = 0
    const tick = (t: number) => {
      const dt = t - prev
      prev = t
      if (dt > 0 && dt < 500) {
        const f = 1000 / dt
        if (f < min) min = f
        if (dt > 20) drops += 1
        setFps({ now: Math.round(f), min: Math.round(min), drops })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div
      dir="ltr"
      style={{
        position: 'fixed',
        insetInlineStart: 12,
        insetBlockStart: 12,
        zIndex: 9999,
        background: 'rgba(10,9,8,0.92)',
        color: '#ece6dc',
        font: '12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace',
        padding: '12px 14px',
        borderRadius: 6,
        border: '1px solid rgba(236,230,220,0.22)',
        maxWidth: 340,
        pointerEvents: 'none',
      }}
    >
      <div style={{ opacity: 0.55, letterSpacing: '0.14em', marginBottom: 8 }}>ДИАГНОСТИКА</div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <span style={{ opacity: 0.6 }}>{r.label}</span>
          <span style={{ color: r.bad ? '#ff7a5c' : '#ece6dc', textAlign: 'right' }}>{r.value}</span>
        </div>
      ))}
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(236,230,220,0.18)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ opacity: 0.6 }}>кадров в секунду</span>
          <span style={{ color: fps.now < 45 ? '#ff7a5c' : '#ece6dc' }}>{fps.now}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ opacity: 0.6 }}>худший</span>
          <span style={{ color: fps.min < 30 ? '#ff7a5c' : '#ece6dc' }}>{fps.min}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ opacity: 0.6 }}>просадок всего</span>
          <span style={{ color: fps.drops > 30 ? '#ff7a5c' : '#ece6dc' }}>{fps.drops}</span>
        </div>
      </div>
      <div style={{ marginTop: 8, opacity: 0.45 }}>прокрути страницу и пришли скриншот</div>
    </div>
  )
}
