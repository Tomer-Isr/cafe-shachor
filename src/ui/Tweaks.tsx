import { useState } from 'react'
import type { SceneSettings } from '../scene/Scene'
import type { Locale } from '../content/copy'

export const FONT_PAIRS = {
  serif: { label: 'Frank Ruhl · Heebo', display: "'Frank Ruhl Libre', serif", body: "'Heebo', sans-serif" },
  editorial: { label: 'Cormorant · Manrope', display: "'Cormorant Garamond', serif", body: "'Manrope', sans-serif" },
  sans: { label: 'Heebo · Manrope', display: "'Heebo', sans-serif", body: "'Manrope', sans-serif" },
} as const
export type FontPair = keyof typeof FONT_PAIRS

export const ACCENTS = {
  copper: { label: 'נחושת · медь', value: '#c8703a' },
  ochre: { label: 'אוכרה · охра', value: '#b8913f' },
  wine: { label: 'יין · вино', value: '#8e3b3b' },
  pine: { label: 'אורן · хвоя', value: '#4c7a5f' },
} as const
export type AccentKey = keyof typeof ACCENTS

interface Props {
  locale: Locale
  setLocale: (l: Locale) => void
  paused: boolean
  setPaused: (p: boolean) => void
  settings: SceneSettings
  setSettings: (s: SceneSettings) => void
  font: FontPair
  setFont: (f: FontPair) => void
  accent: AccentKey
  setAccent: (a: AccentKey) => void
  labels: { tweaks: string; pause: string; play: string }
}

/**
 * Панель твиков прямо в странице: выбирать шрифт и плотность пара глазами дешевле,
 * чем гонять агента по кругу «а сделай другой шрифт».
 */
export function Tweaks(p: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className="fixed bottom-4 z-50 ltr:right-4 rtl:left-4" dir="ltr">
      <div className="flex items-center gap-2">
        <button
          onClick={() => p.setPaused(!p.paused)}
          className="border border-[rgba(236,230,220,.25)] bg-[#0a0908]/85 px-3 py-2 text-xs text-[#ece6dc] backdrop-blur transition hover:border-[rgba(236,230,220,.6)]"
          title={p.paused ? p.labels.play : p.labels.pause}
        >
          {p.paused ? '▶' : '❚❚'}
        </button>
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="border border-[rgba(236,230,220,.25)] bg-[#0a0908]/85 px-4 py-2 text-xs uppercase tracking-widest text-[#ece6dc] backdrop-blur transition hover:border-[rgba(236,230,220,.6)]"
        >
          {p.labels.tweaks}
        </button>
      </div>

      {open && (
        <div className="mt-2 w-[19rem] border border-[rgba(236,230,220,.18)] bg-[#0a0908]/95 p-4 text-xs backdrop-blur-md">
          <Row label="Language">
            <Seg options={[['he', 'עברית'], ['ru', 'Русский']]} value={p.locale} onChange={(v) => p.setLocale(v as Locale)} />
          </Row>

          <Row label="Type">
            <Seg
              options={Object.entries(FONT_PAIRS).map(([k, v]) => [k, v.label.split(' · ')[0]])}
              value={p.font}
              onChange={(v) => p.setFont(v as FontPair)}
            />
          </Row>

          <Row label="Accent">
            <div className="flex gap-1.5">
              {Object.entries(ACCENTS).map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => p.setAccent(k as AccentKey)}
                  title={v.label}
                  aria-label={v.label}
                  className={`h-6 w-6 border transition ${p.accent === k ? 'border-[#ece6dc]' : 'border-transparent'}`}
                  style={{ background: v.value }}
                />
              ))}
            </div>
          </Row>

          <Slider label="Steam" min={0} max={1.6} step={0.05} value={p.settings.steam} onChange={(v) => p.setSettings({ ...p.settings, steam: v })} />
          <Slider label="Glow" min={0} max={1.4} step={0.05} value={p.settings.bloom} onChange={(v) => p.setSettings({ ...p.settings, bloom: v })} />
          <Slider label="Grain" min={0} max={0.12} step={0.005} value={p.settings.grain} onChange={(v) => p.setSettings({ ...p.settings, grain: v })} />
          <Slider label="Focus" min={0.005} max={0.09} step={0.002} value={p.settings.focus} onChange={(v) => p.setSettings({ ...p.settings, focus: v })} />

          <p className="mt-3 border-t border-[rgba(236,230,220,.12)] pt-3 text-[10px] leading-relaxed text-[#93897c]">
            Demo tweak panel — pick with your eyes, not by re-prompting.
          </p>
        </div>
      )}
    </div>
  )
}

function Row({ label, children }: React.PropsWithChildren<{ label: string }>) {
  return (
    <div className="mb-3">
      <p className="mb-1.5 uppercase tracking-widest text-[#93897c]">{label}</p>
      {children}
    </div>
  )
}

function Seg({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1">
      {options.map(([k, l]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          className={`flex-1 border px-2 py-1.5 transition ${
            value === k ? 'border-[var(--accent)] text-[#ece6dc]' : 'border-[rgba(236,230,220,.16)] text-[#93897c]'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
}) {
  return (
    <label className="mb-2.5 block">
      <span className="mb-1 flex justify-between uppercase tracking-widest text-[#93897c]">
        {label}
        <span className="tabular-nums">{value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
    </label>
  )
}
