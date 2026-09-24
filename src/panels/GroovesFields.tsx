import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import NumberField from '../ui/NumberField.tsx'
import { formatNumber } from '../ui/format.ts'
import type { BoardParams } from '../boards/board.ts'
import { edgeSideLabel } from '../boards/edgeBanding.ts'
import {
  GROOVE_EDGES,
  GROOVE_STEP,
  boardGrooves,
  createGroove,
  faceLabel,
  fitGroove,
  grooveProblem,
  grooveRange,
  isFaceSide,
  withGrooveParam,
  type Groove,
  type GrooveDir,
  type GrooveParam,
  type GrooveSide,
} from '../boards/grooves.ts'
import { GrooveRzut, GrooveSection } from './GrooveView2D.tsx'

interface Props {
  /** Board params with the bands as shown (edges touching another board count as bare). */
  value: BoardParams
  onChange: (next: BoardParams) => void
  idPrefix: string
  title: string
}

const FACES: GrooveSide[] = ['front', 'back']

function paramLabels(g: Groove): Record<GrooveParam, string> {
  if (!isFaceSide(g.side) && g.across) {
    const ref = g.side === 'A' || g.side === 'C' ? 'od D' : 'od C'
    return { offset: `Poz. ${ref}`, width: 'Szerokość', depth: 'Głębokość', start: 'Początek od strony 2', length: 'Długość (w grubości)' }
  }
  const ref = isFaceSide(g.side) ? (g.dir === 'AC' ? 'od krawędzi C' : 'od krawędzi D') : 'od strony 2'
  const along = isFaceSide(g.side) ? (g.dir === 'AC' ? 'od D' : 'od C') : g.side === 'A' || g.side === 'C' ? 'od D' : 'od C'
  return { offset: `Poz. ${ref}`, width: 'Szerokość', depth: 'Głębokość', start: `Początek ${along}`, length: 'Długość' }
}

/**
 * "Frezowania" of the board form: grooves (width × depth × length) on both faces and on the bare edges
 * (an edge with a band cannot be milled), any number of them. A new groove runs through the whole
 * available length. 2D rzut + cross-section of the selected groove with draggable points, the list with
 * the numeric values and a bigger floating editor – like "Wycięcia".
 */
export default function GroovesFields({ value, onChange, idPrefix, title }: Props) {
  const grooves = boardGrooves(value)
  const [selected, setSelected] = useState<string | null>(null)
  const [windowOpen, setWindowOpen] = useState(false)
  const selectedId = grooves.some((g) => g.id === selected) ? selected : null
  const current = grooves.find((g) => g.id === selectedId) ?? null

  const setGrooves = (next: Groove[]) => onChange({ ...value, grooves: next })
  const replace = (g: Groove) => setGrooves(grooves.map((o) => (o.id === g.id ? g : o)))
  const add = (side: GrooveSide) => {
    const g = createGroove(value, side)
    setGrooves([...grooves, g])
    setSelected(g.id)
  }
  const remove = (id: string) => setGrooves(grooves.filter((g) => g.id !== id))
  const setSide = (g: Groove, side: GrooveSide) => {
    const across = !isFaceSide(side) && !!g.across
    const base = createGroove(value, side, g.dir, across)
    const same = isFaceSide(side) === isFaceSide(g.side)
    replace(fitGroove(value, { ...g, side, across: across || undefined, offset: same ? g.offset : base.offset }))
  }

  useEffect(() => {
    if (!windowOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setWindowOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [windowOpen])

  const sideName = (s: GrooveSide) => (isFaceSide(s) ? faceLabel(value.orientation, s) : `Krawędź ${s} – ${edgeSideLabel(value.orientation, s)}`)
  const actions = (
    <div className="cutout-actions groove-actions">
      {FACES.map((s) => (
        <button key={s} type="button" className="small-button" data-action={`add-groove-${s}`} onClick={() => add(s)} title={`Frez na: ${sideName(s)}`}>
          + {s === 'front' ? 'Strona 1' : 'Strona 2'}
        </button>
      ))}
      {GROOVE_EDGES.map((e) => {
        const problem = grooveProblem(value, { side: e })
        return (
          <button
            key={e}
            type="button"
            className="small-button"
            data-action={`add-groove-${e}`}
            disabled={!!problem}
            title={problem ?? `Frez w krawędzi ${e} (${edgeSideLabel(value.orientation, e)})`}
            onClick={() => add(e)}
          >
            + Kraw. {e}
          </button>
        )
      })}
    </div>
  )

  const list = (prefix: string) => (
    <ul className="cutout-list groove-list">
      {grooves.map((g, i) => {
        const problem = grooveProblem(value, g)
        const labels = paramLabels(g)
        const params: GrooveParam[] = g.through ? ['offset', 'width', 'depth'] : ['offset', 'width', 'depth', 'start', 'length']
        return (
          <li
            key={g.id}
            className={`cutout-row${g.id === selectedId ? ' cutout-row--selected' : ''}`}
            data-groove={g.id}
            onPointerDown={() => setSelected(g.id)}
            onFocus={() => setSelected(g.id)}
          >
            <div className="cutout-row-head">
              <b className="cutout-row-no">{i + 1}.</b>
              <select aria-label="Gdzie frez" data-field="groove-side" value={g.side} onChange={(e) => setSide(g, e.target.value as GrooveSide)}>
                {FACES.map((s) => (
                  <option key={s} value={s}>
                    {sideName(s)}
                  </option>
                ))}
                {GROOVE_EDGES.map((e) => (
                  <option key={e} value={e} disabled={e !== g.side && !!grooveProblem(value, { side: e })}>
                    {sideName(e)}
                    {grooveProblem(value, { side: e }) ? ' (ma obrzeże)' : ''}
                  </option>
                ))}
              </select>
              <button type="button" className="small-button small-button--danger" aria-label={`Usuń frez ${i + 1}`} onClick={() => remove(g.id)}>
                ×
              </button>
            </div>
            {!isFaceSide(g.side) && (
              <div className="cutout-row-head">
                <span className="cutout-row-caption">Kierunek</span>
                <select
                  aria-label="Kierunek frezu w krawędzi"
                  data-field="groove-edge-dir"
                  value={g.across ? 'across' : 'along'}
                  onChange={(e) => {
                    const fresh = createGroove(value, g.side, g.dir, e.target.value === 'across')
                    replace(fitGroove(value, { ...fresh, id: g.id, width: g.width, depth: g.depth }))
                  }}
                >
                  <option value="along">wzdłuż krawędzi</option>
                  <option value="across">w poprzek krawędzi (przez grubość)</option>
                </select>
              </div>
            )}
            {isFaceSide(g.side) && (
              <div className="cutout-row-head">
                <span className="cutout-row-caption">Kierunek</span>
                <select
                  aria-label="Kierunek frezu"
                  data-field="groove-dir"
                  value={g.dir}
                  onChange={(e) => replace(fitGroove(value, { ...g, dir: e.target.value as GrooveDir }))}
                >
                  <option value="AC">wzdłuż A–C (szerokości)</option>
                  <option value="BD">wzdłuż B–D (wysokości)</option>
                </select>
              </div>
            )}
            <label className="radio groove-through">
              <input
                type="checkbox"
                data-field="groove-through"
                checked={g.through}
                onChange={(e) => replace(fitGroove(value, { ...g, through: e.target.checked }))}
              />
              {!isFaceSide(g.side) && g.across ? 'Przez całą grubość' : 'Na całą długość'} <small>({formatNumber(g.length)} mm)</small>
            </label>
            <div className="position-row groove-params">
              {params.map((p) => {
                const range = grooveRange(value, g, p)
                return (
                  <label key={p} className="position-input">
                    <span>
                      {labels[p]} <small>({formatNumber(range.min)}–{formatNumber(range.max)})</small>
                    </span>
                    <NumberField
                      name={`${prefix}-groove-${g.id}-${p}`}
                      data-field={`groove-${p}`}
                      aria-label={`Frez ${i + 1}: ${labels[p]} [mm]`}
                      min={range.min}
                      max={range.max}
                      step={GROOVE_STEP}
                      scrubStep={1}
                      value={g[p]}
                      onChange={(v) => replace(withGrooveParam(value, g, p, v))}
                    />
                  </label>
                )
              })}
            </div>
            {problem && <p className="field-error">{problem} Frez nie jest wykonywany.</p>}
          </li>
        )
      })}
    </ul>
  )

  const views = (large: boolean) => (
    <>
      <GrooveRzut value={value} onGrooveChange={replace} selectedId={selectedId} onSelect={setSelected} large={large} />
      {current && !grooveProblem(value, current) && (
        <>
          <div className="groove-section-title">
            Przekrój frezu {grooves.indexOf(current) + 1} <small>({sideName(current.side)})</small>
          </div>
          <GrooveSection value={value} groove={current} onGrooveChange={replace} large={large} />
        </>
      )}
    </>
  )

  return (
    <fieldset className="field cutouts grooves">
      <legend>
        Frezowania <small>(rowki na stronach i w krawędziach bez obrzeża)</small>
      </legend>
      {grooves.length > 0 && views(false)}
      {actions}
      {grooves.length > 0 && (
        <div className="cutout-toolbar">
          <button
            type="button"
            className="small-button"
            data-action="open-groove-editor"
            aria-pressed={windowOpen}
            onClick={() => setWindowOpen((o) => !o)}
            title="Większy rzut i przekrój w osobnym oknie"
          >
            ⤢ Edytor 2D
          </button>
        </div>
      )}
      {grooves.length === 0 ? (
        <p className="field-hint">
          Brak frezów. Dodaj frez na stronie 1 (widocznej w rzucie), stronie 2 albo w krawędzi bez obrzeża – domyślnie biegnie przez
          całą dostępną długość (4 × 8 mm).
        </p>
      ) : (
        list(idPrefix)
      )}
      {windowOpen &&
        createPortal(
          <div className="shape-window" role="dialog" aria-label={`Frezowania – ${title}`} data-groove-window={idPrefix}>
            <div className="shape-window-header">
              <h2>
                Frezowania – {title}{' '}
                <small>
                  {formatNumber(value.width)}×{formatNumber(value.height)}×{formatNumber(value.thickness)} mm
                </small>
              </h2>
              <button type="button" className="side-panel-close" aria-label="Zamknij edytor frezowań" onClick={() => setWindowOpen(false)}>
                ×
              </button>
            </div>
            {views(true)}
            <p className="field-hint">
              Rzut: strona 1 – frez wypełniony, strona 2 – kreskowany (widziany przez płytę), frez w krawędzi – ukryty kanał od krawędzi.
              Przeciągnij punkty zaznaczonego frezu (położenie, szerokość, głębokość, początek / koniec); Shift – co 10 mm, Alt – co 0,1 mm,
              strzałki przesuwają zaznaczony punkt.
            </p>
            <div className="shape-window-body">
              {actions}
              {list(`${idPrefix}-win`)}
            </div>
          </div>,
          document.body,
        )}
    </fieldset>
  )
}
