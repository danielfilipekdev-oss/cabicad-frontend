import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  AMBIENT_LIMITS,
  DEFAULT_LIGHT,
  INTENSITY_LIMITS,
  MIN_ELEVATION,
  azimuthLabel,
  diskPoint,
  fromDiskPoint,
  type LightSettings,
} from './lighting.ts'
import type { Furniture } from '../furniture/furniture.ts'

interface Props {
  value: LightSettings
  onChange: (next: LightSettings) => void
  furniture: Furniture
  /** "Pokaż promienie": dashed rays from the sun in the scene to the furniture. */
  showRays: boolean
  onShowRaysChange: (on: boolean) => void
}

/** Disk size [px] and radius of the area the sun moves in. */
const SIZE = 168
const R = 70
const C = SIZE / 2

const PRESETS: { label: string; title: string; azimuth: number; elevation: number }[] = [
  { label: 'Z góry', title: 'Światło prosto z góry', azimuth: 0, elevation: 90 },
  { label: 'Z przodu', title: 'Z przodu, lekko z góry – dobrze oświetla wnętrze szafki', azimuth: 0, elevation: 35 },
  { label: 'Z boku', title: 'Z prawej strony, nisko – wyraźne cienie', azimuth: 90, elevation: 25 },
]

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * "Światło" – widget in the top-right corner of the viewport to place the key light (sun):
 * a disk seen from above with the furniture in the middle (front at the bottom) – drag the sun around it
 * to choose the side the light comes from, towards the centre for a higher light (centre = from above,
 * rim = low, from the side). Arrow keys on the disk: ←/→ direction, ↑/↓ height. Below: intensity of the
 * light and of the ambient light, presets and the default.
 */
export default function LightControl({ value, onChange, furniture, showRays, onShowRaysChange }: Props) {
  const [open, setOpen] = useState(false)
  const svg = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)
  const sun = diskPoint(value)
  const sx = C + sun.x * R
  const sy = C + sun.y * R

  const setFromPointer = (e: PointerEvent<SVGSVGElement>) => {
    const rect = svg.current!.getBoundingClientRect()
    const x = ((e.clientX - rect.left) * (SIZE / rect.width) - C) / R
    const y = ((e.clientY - rect.top) * (SIZE / rect.height) - C) / R
    onChange({ ...value, ...fromDiskPoint(x, y) })
  }
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const step = e.shiftKey ? 15 : 5
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    const m = d[e.key]
    if (!m) return
    e.preventDefault()
    e.stopPropagation()
    onChange({ ...value, azimuth: (value.azimuth + m[0] + 360) % 360, elevation: clamp(value.elevation + m[1], MIN_ELEVATION, 90) })
  }

  // furniture outline seen from above, scaled to fit the inner part of the disk
  const k = 38 / Math.max(furniture.width, furniture.depth, 1)
  const fw = furniture.width * k
  const fd = furniture.depth * k
  // elevation rings (every 30°)
  const ring = (el: number) => ((90 - el) / (90 - MIN_ELEVATION)) * R

  if (!open)
    return (
      <button type="button" className="light-toggle" data-action="light-open" onClick={() => setOpen(true)} title="Ustawienia oświetlenia sceny">
        <span className="light-toggle-sun" aria-hidden="true">☀</span> Światło
      </button>
    )

  return (
    <div className="light-control" role="group" aria-label="Światło" data-light-control>
      <div className="light-control-header">
        <b>☀ Światło</b>
        <button type="button" className="side-panel-close" aria-label="Zamknij" onClick={() => setOpen(false)}>×</button>
      </div>
      <svg
        ref={svg}
        className="light-disk"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        tabIndex={0}
        role="slider"
        aria-label="Kierunek światła – przeciągnij słońce (środek = z góry, brzeg = nisko z boku)"
        aria-valuetext={`z ${azimuthLabel(value.azimuth)}, wysokość ${Math.round(value.elevation)}°`}
        data-field="light-direction"
        onKeyDown={onKey}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          setFromPointer(e)
        }}
        onPointerMove={(e) => dragging.current && setFromPointer(e)}
        onPointerUp={(e) => {
          dragging.current = false
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
        }}
      >
        <circle cx={C} cy={C} r={R} className="light-disk-bg" />
        {[60, 30].map((el) => (
          <g key={el}>
            <circle cx={C} cy={C} r={ring(el)} className="light-disk-ring" />
            <text x={C + 2} y={C - ring(el) + 9} className="light-disk-ring-label">
              {el}°
            </text>
          </g>
        ))}
        <line x1={C - R} y1={C} x2={C + R} y2={C} className="light-disk-axis" />
        <line x1={C} y1={C - R} x2={C} y2={C + R} className="light-disk-axis" />
        {/* furniture from above: front edge (thicker) at the bottom */}
        <rect x={C - fw / 2} y={C - fd / 2} width={fw} height={fd} className="light-disk-furniture" />
        <line x1={C - fw / 2} y1={C + fd / 2} x2={C + fw / 2} y2={C + fd / 2} className="light-disk-front" />
        <text x={C} y={SIZE - 3} className="light-disk-label">przód</text>
        <text x={C} y={9} className="light-disk-label">tył</text>
        <text x={4} y={C + 3} className="light-disk-label" style={{ textAnchor: 'start' }}>L</text>
        <text x={SIZE - 4} y={C + 3} className="light-disk-label" style={{ textAnchor: 'end' }}>P</text>
        {/* the light: ray to the centre + the sun */}
        <line x1={C} y1={C} x2={sx} y2={sy} className="light-disk-ray" />
        <g className="light-disk-sun" transform={`translate(${sx} ${sy})`}>
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i * Math.PI) / 4
            return <line key={i} x1={Math.cos(a) * 9} y1={Math.sin(a) * 9} x2={Math.cos(a) * 13} y2={Math.sin(a) * 13} />
          })}
          <circle r={7} />
        </g>
      </svg>
      <div className="light-readout" data-light-readout>
        z {azimuthLabel(value.azimuth)} · wysokość {Math.round(value.elevation)}°{value.elevation >= 89.5 ? ' (z góry)' : ''}
      </div>
      <div className="light-presets">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" className="small-button" title={p.title} onClick={() => onChange({ ...value, azimuth: p.azimuth, elevation: p.elevation })}>
            {p.label}
          </button>
        ))}
      </div>
      <label className="light-slider">
        <span>
          Natężenie światła <small>{value.intensity.toFixed(1).replace('.', ',')}</small>
        </span>
        <input
          type="range"
          data-field="light-intensity"
          min={INTENSITY_LIMITS.min}
          max={INTENSITY_LIMITS.max}
          step={0.1}
          value={value.intensity}
          onChange={(e) => onChange({ ...value, intensity: Number(e.target.value) })}
        />
      </label>
      <label className="light-slider">
        <span>
          Światło otoczenia <small>{value.ambient.toFixed(1).replace('.', ',')}</small>
        </span>
        <input
          type="range"
          data-field="light-ambient"
          min={AMBIENT_LIMITS.min}
          max={AMBIENT_LIMITS.max}
          step={0.1}
          value={value.ambient}
          onChange={(e) => onChange({ ...value, ambient: Number(e.target.value) })}
        />
      </label>
      <button
        type="button"
        className={`small-button light-rays${showRays ? ' active' : ''}`}
        data-action="light-rays"
        aria-pressed={showRays}
        title="Pokaż w scenie przerywane promienie od słońca do mebla"
        onClick={() => onShowRaysChange(!showRays)}
      >
        {showRays ? '✓ ' : ''}Pokaż promienie
      </button>
      <button type="button" className="small-button light-reset" data-action="light-reset" onClick={() => onChange(DEFAULT_LIGHT)}>
        Przywróć domyślne
      </button>
      <small className="light-hint">Przeciągnij słońce: kierunek – wokół mebla, środek – z góry. Na tarczy działają też strzałki.</small>
    </div>
  )
}
