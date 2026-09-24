import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { formatNumber, parseNumber } from './format.ts'

interface Props {
  value: number
  onChange: (value: number) => void
  /** Smallest allowed value (inclusive). */
  min?: number
  /** Largest allowed value (inclusive). */
  max?: number
  /** Precision the value is rounded to (e.g. 0.1 = tenths of a millimetre). Default 1 (= 1 mm). */
  step?: number
  /**
   * Value change per pixel of vertical mouse movement on the scrub handle (before modifiers) and per
   * ArrowUp / ArrowDown key press. Default = `step`.
   */
  scrubStep?: number
  /**
   * Optional snapping of an in-range value to the nearest allowed one (e.g. cut-out distances where some
   * values inside <min, max> are forbidden). Applied to typing, arrows and the scrub handle.
   */
  normalize?: (value: number) => number
  /** Read-only field (e.g. a value determined by a layout constraint) – input and scrub handle disabled. */
  disabled?: boolean
  name?: string
  'data-field'?: string
  'aria-label'?: string
  className?: string
}

export function clampValue(v: number, min = -Infinity, max = Infinity, step = 1): number {
  const rounded = step > 0 ? Math.round(v / step) * step : v
  // avoid -0 and floating point noise such as 0.30000000000000004
  const fixed = Number(rounded.toFixed(countDecimals(step)))
  return Math.min(max, Math.max(min, fixed)) || 0
}

function countDecimals(step: number): number {
  const s = String(step)
  const i = s.indexOf('.')
  return i < 0 ? 0 : s.length - i - 1
}

/**
 * Numeric input limited to <min, max> with a "scrub handle" (⇕) next to it.
 * Accepts fractional values with a decimal comma or dot ("18,5" / "18.5"); the value is shown with a comma.
 * ArrowUp / ArrowDown change the value by `scrubStep` (Shift ×10, Alt ×0.1).
 * press the handle and move the mouse up / down to increase / decrease the value
 * (Shift = ×10 faster, Alt = ×0.1 slower). While typing, only values in range are applied;
 * on blur / Enter the text is clamped to the allowed range, so an out-of-range value can never be set.
 */
export default function NumberField({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  scrubStep = step,
  normalize,
  disabled = false,
  name,
  className,
  ...rest
}: Props) {
  const decimals = countDecimals(step)
  const show = (v: number) => formatNumber(v, Math.max(decimals, 0))
  const [text, setText] = useState(show(value))
  const [scrubbing, setScrubbing] = useState(false)
  const focused = useRef(false)
  const scrub = useRef<{ startY: number; startValue: number; last: number } | null>(null)

  // follow external changes (other form, scrubbing) unless the user is typing in this input
  useEffect(() => {
    if (!focused.current) setText(show(value))
  }, [value, decimals])

  /** Value limited to <min, max>, rounded to `step` and snapped by `normalize`. */
  const fix = (v: number) => {
    const c = clampValue(v, min, max, step)
    return normalize ? normalize(c) : c
  }

  const emit = (v: number) => {
    const c = fix(v)
    if (c !== value) onChange(c)
    return c
  }

  const handleText = (raw: string) => {
    setText(raw)
    const n = parseNumber(raw)
    if (n !== null && n >= min && n <= max) emit(n)
  }

  const commitText = () => {
    const n = parseNumber(text)
    const c = n === null ? value : emit(n)
    setText(show(c))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitText()
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const factor = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
      const next = fix(value + (e.key === 'ArrowUp' ? 1 : -1) * scrubStep * factor)
      setText(show(next))
      if (next !== value) onChange(next)
    }
  }

  // ---- scrub handle -------------------------------------------------------------------------
  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    scrub.current = { startY: e.clientY, startValue: value, last: value }
    setScrubbing(true)
  }
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const s = scrub.current
    if (!s) return
    const factor = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
    const dy = s.startY - e.clientY // moving up increases the value
    const next = fix(s.startValue + dy * scrubStep * factor)
    if (next !== s.last) {
      s.last = next
      setText(show(next))
      onChange(next)
    }
  }
  const endScrub = (e: PointerEvent<HTMLButtonElement>) => {
    if (!scrub.current) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    scrub.current = null
    setScrubbing(false)
  }

  return (
    <span className={`number-field${scrubbing ? ' number-field--scrubbing' : ''}${disabled ? ' number-field--disabled' : ''}${className ? ` ${className}` : ''}`}>
      <input
        type="text"
        disabled={disabled}
        inputMode="decimal"
        autoComplete="off"
        name={name}
        data-field={rest['data-field']}
        aria-label={rest['aria-label']}
        value={text}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false
          commitText()
        }}
        onKeyDown={onKeyDown}
        onChange={(e) => handleText(e.target.value)}
      />
      <button
        type="button"
        className="scrub-handle"
        tabIndex={-1}
        disabled={disabled}
        title="Przytrzymaj i przesuwaj mysz w górę / w dół, aby zmienić wartość (Shift ×10, Alt ×0.1)"
        aria-label={`Zmień wartość przeciągając${rest['aria-label'] ? `: ${rest['aria-label']}` : ''}`}
        data-scrub={rest['data-field']}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
        onLostPointerCapture={endScrub}
      >
        ⇕
      </button>
    </span>
  )
}
