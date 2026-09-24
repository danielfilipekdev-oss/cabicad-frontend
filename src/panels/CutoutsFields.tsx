import { useDeferredValue, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import NumberField from '../ui/NumberField.tsx'
import ShapeEditor2D from './ShapeEditor2D.tsx'
import { formatNumber } from '../ui/format.ts'
import type { BoardParams } from '../boards/board.ts'
import {
  CORNERS,
  CORNER_KINDS,
  CUTOUT_KIND_LABELS,
  CUT_STEP,
  MIN_EDGE_MM,
  SLOT_EDGES,
  addCutout,
  boardContour,
  boardCutouts,
  constrainCutoutParam,
  cornerLabel,
  cutoutParams,
  cutoutRange,
  fitCutouts,
  freeCorners,
  getCutoutParam,
  isSlot,
  setCutoutParam,
  slotFrame,
  withCornerKind,
  type Corner,
  type CornerCutoutKind,
  type Cutout,
  type CutoutKind,
  type CutoutParam,
} from '../boards/cutouts.ts'
import { edgeSideLabel, pruneCutoutOverrides, resolveEdgeBand, type EdgeId } from '../boards/edgeBanding.ts'
import { edgeBandTagStyle } from '../boards/edgeBandCatalog.ts'

interface Props {
  value: BoardParams
  onChange: (next: BoardParams) => void
  idPrefix: string
  /** Board name for the title of the floating editor. */
  title: string
}

interface ListProps {
  value: BoardParams
  selectedId: string | null
  onSelect: (id: string) => void
  onParam: (id: string, param: CutoutParam, v: number) => void
  onKind: (id: string, kind: CornerCutoutKind) => void
  onCorner: (id: string, corner: Corner) => void
  onEdge: (id: string, edge: EdgeId) => void
  onRemove: (id: string) => void
  idPrefix: string
}

/** Label of a parameter in the list (slot: the axis the value runs along is shown). */
function paramLabel(c: Cutout, param: CutoutParam, W: number, H: number): { label: string; aria: string } {
  if (isSlot(c)) {
    const f = slotFrame(c.edge, W, H)
    const along = f.horizontal ? 'X' : 'Y'
    const across = f.horizontal ? 'Y' : 'X'
    if (param === 'offset') return { label: `Poz. ${along}`, aria: `pozycja ${along} od narożnika` }
    if (param === 'width') return { label: 'Szer.', aria: `szerokość (${along})` }
    return { label: 'Głęb.', aria: `głębokość (${across})` }
  }
  if (param === 'r') return { label: 'Promień R', aria: 'promień R' }
  return { label: param.toUpperCase(), aria: `${param.toUpperCase()} od narożnika` }
}

/**
 * List of the cut-outs: type, corner / edge and the dimensions – limited to the allowed values
 * (forbidden values inside the range are snapped), with scrub handles. Rendered from a deferred value,
 * so dragging a point in the 2D view stays smooth while the ranges are recomputed.
 */
function CutoutList({ value: live, selectedId, onSelect, onParam, onKind, onCorner, onEdge, onRemove, idPrefix }: ListProps) {
  const value = useDeferredValue(live)
  const cutouts = boardCutouts(value)
  const edges = boardContour(value)
  const free = freeCorners(cutouts)
  const W = value.width
  const H = value.height
  return (
    <ul className="cutout-list">
      {cutouts.map((c, i) => {
        const cEdges = edges.filter((e, j) => e.cutoutId === c.id && edges.findIndex((o) => o.key === e.key) === j)
        return (
          <li
            key={c.id}
            className={`cutout-row${c.id === selectedId ? ' cutout-row--selected' : ''}`}
            data-cutout={c.id}
            data-kind={c.kind}
            onPointerDown={() => onSelect(c.id)}
            onFocus={() => onSelect(c.id)}
          >
            <div className="cutout-row-head">
              <b className="cutout-row-no">{i + 1}.</b>
              {isSlot(c) ? (
                <span className="cutout-row-title">{CUTOUT_KIND_LABELS.slot}</span>
              ) : (
                <select
                  aria-label="Rodzaj wycięcia"
                  data-field="cutout-kind"
                  value={c.kind}
                  onChange={(e) => onKind(c.id, e.target.value as CornerCutoutKind)}
                >
                  {CORNER_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {CUTOUT_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                className="small-button small-button--danger"
                aria-label={`Usuń wycięcie ${i + 1}`}
                onClick={() => onRemove(c.id)}
              >
                ×
              </button>
            </div>
            <div className="cutout-row-head">
              {isSlot(c) ? (
                <>
                  <span className="cutout-row-caption">Krawędź</span>
                  <select
                    aria-label="Krawędź wycięcia U"
                    data-field="cutout-edge"
                    value={c.edge}
                    onChange={(e) => onEdge(c.id, e.target.value as EdgeId)}
                  >
                    {SLOT_EDGES.map((k) => (
                      <option key={k} value={k}>
                        {k} – {edgeSideLabel(value.orientation, k)}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <span className="cutout-row-caption">Narożnik</span>
                  <select
                    aria-label="Narożnik wycięcia"
                    data-field="cutout-corner"
                    value={c.corner}
                    onChange={(e) => onCorner(c.id, e.target.value as Corner)}
                  >
                    {CORNERS.filter((k) => k === c.corner || free.includes(k)).map((k) => (
                      <option key={k} value={k}>
                        {k} – {cornerLabel(value.orientation, k)}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
            <div className="position-row">
              {cutoutParams(c).map((param) => {
                const range = cutoutRange(value, c.id, param)
                const { label, aria } = paramLabel(c, param, W, H)
                return (
                  <label key={param} className="position-input">
                    <span>
                      {label} <small>({formatNumber(range.min)}–{formatNumber(range.max)})</small>
                    </span>
                    <NumberField
                      name={`${idPrefix}-cut-${c.id}-${param}`}
                      data-field={`cutout-${param}`}
                      aria-label={`Wycięcie ${i + 1}: ${aria} [mm]`}
                      min={range.min}
                      max={range.max}
                      step={CUT_STEP}
                      scrubStep={1}
                      normalize={(v) => constrainCutoutParam(live, c.id, param, v)}
                      value={getCutoutParam(c, param)}
                      onChange={(v) => onParam(c.id, param, v)}
                    />
                  </label>
                )
              })}
            </div>
            {cEdges.length > 0 && (
              <div className="cutout-row-edges">
                nowe krawędzie:
                {cEdges.map((e) => {
                  const band = resolveEdgeBand(value.edgeBanding, e.key)
                  return (
                    <span
                      key={e.key}
                      className={`edge-tag edge-tag--small${band ? '' : ' edge-tag--none'}`}
                      style={edgeBandTagStyle(band?.typeId)}
                    >
                      {e.label}
                      {band && <small>{formatNumber(band.thickness)}</small>}
                    </span>
                  )
                })}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * "Wycięcia" section of the board form: 2D preview of the board with draggable cut-out points, buttons
 * adding a chamfer (skos / trapez), a rectangular corner notch (L-ka), a rounded corner (R) or a U slot,
 * the list of the cut-outs with numeric inputs and a bigger floating 2D editor. All values are limited to
 * the ones that give a valid board (every remaining straight edge 0 or ≥ 1 mm). The new edges get their
 * bands from the "Obrzeże ABS" section (common band + overrides).
 */
export default function CutoutsFields({ value, onChange, idPrefix, title }: Props) {
  const cutouts = boardCutouts(value)
  const [selected, setSelected] = useState<string | null>(null)
  const [windowOpen, setWindowOpen] = useState(false)
  const selectedId = cutouts.some((c) => c.id === selected) ? selected : null

  const setCutouts = (next: Cutout[], edgeBanding = value.edgeBanding) => onChange({ ...value, cutouts: next, edgeBanding })
  const add = (kind: CutoutKind) => {
    const next = addCutout(value, kind)
    if (!next) return
    setCutouts(next)
    setSelected(next[next.length - 1].id)
  }
  const remove = (id: string) => {
    setCutouts(
      cutouts.filter((c) => c.id !== id),
      pruneCutoutOverrides(value.edgeBanding, id),
    )
  }
  const refit = (list: Cutout[]) => fitCutouts(value.width, value.height, list)
  const setKind = (id: string, kind: CornerCutoutKind) => {
    const next = refit(cutouts.map((c) => (c.id === id && !isSlot(c) ? withCornerKind(c, kind) : c)))
    // the edges of the cut-out change (skos 1 edge, L 2 edges, R 1 arc) → their overrides no longer apply
    setCutouts(next, pruneCutoutOverrides(value.edgeBanding, id))
  }
  const setCorner = (id: string, corner: Corner) =>
    setCutouts(refit(cutouts.map((c) => (c.id === id && !isSlot(c) ? { ...c, corner } : c))))
  const setEdge = (id: string, edge: EdgeId) => setCutouts(refit(cutouts.map((c) => (c.id === id && isSlot(c) ? { ...c, edge } : c))))
  const setParam = (id: string, param: CutoutParam, v: number) => setCutouts(setCutoutParam(value, id, param, v))

  // Esc closes the floating editor
  useEffect(() => {
    if (!windowOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setWindowOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [windowOpen])

  const noFreeCorner = freeCorners(cutouts).length === 0
  const actions = (
    <div className="cutout-actions">
      <button type="button" className="small-button" data-action="add-chamfer" disabled={noFreeCorner} onClick={() => add('chamfer')}>
        + Skos
      </button>
      <button type="button" className="small-button" data-action="add-notch" disabled={noFreeCorner} onClick={() => add('notch')}>
        + Wycięcie L
      </button>
      <button type="button" className="small-button" data-action="add-radius" disabled={noFreeCorner} onClick={() => add('radius')}>
        + Zaokrąglenie
      </button>
      <button type="button" className="small-button" data-action="add-slot" onClick={() => add('slot')}>
        + Wycięcie U
      </button>
    </div>
  )
  const list = (prefix: string) => (
    <CutoutList
      value={value}
      selectedId={selectedId}
      onSelect={setSelected}
      onParam={setParam}
      onKind={setKind}
      onCorner={setCorner}
      onEdge={setEdge}
      onRemove={remove}
      idPrefix={prefix}
    />
  )
  const viewHint = {
    vertical: 'Rzut z przodu (A – góra).',
    side: 'Rzut z prawej strony, przód po lewej (A – góra, D – przód, szerokość = głębokość).',
    horizontal: 'Rzut z góry, przód na dole (A – tył, Y = głębokość).',
  }[value.orientation]
  const rulesHint = `Każda pozostała prosta krawędź i każdy mostek materiału ma co najmniej ${formatNumber(MIN_EDGE_MM)} mm plus grubość obrzeży sąsiednich krawędzi (albo krawędź znika całkiem), promień – ${formatNumber(MIN_EDGE_MM)} mm plus jego obrzeże; wartości są do tego dociągane.`

  return (
    <fieldset className="field cutouts">
      <legend>
        Wycięcia <small>(kształt płyty)</small>
      </legend>
      <ShapeEditor2D value={value} onCutoutsChange={setCutouts} selectedId={selectedId} onSelect={setSelected} />
      {actions}
      <div className="cutout-toolbar">
        <button
          type="button"
          className="small-button"
          data-action="open-shape-editor"
          aria-pressed={windowOpen}
          onClick={() => setWindowOpen((o) => !o)}
          title="Większy rzut 2D w osobnym oknie"
        >
          ⤢ Edytor 2D
        </button>
      </div>
      {cutouts.length === 0 ? (
        <p className="field-hint">
          Brak wycięć – płyta prostokątna. Dodaj skos (np. trapez), wycięcie L, zaokrąglenie narożnika lub wycięcie U w krawędzi.
        </p>
      ) : (
        list(idPrefix)
      )}

      {windowOpen &&
        createPortal(
          <div className="shape-window" role="dialog" aria-label={`Kształt płyty – ${title}`} data-shape-window={idPrefix}>
            <div className="shape-window-header">
              <h2>
                Kształt płyty – {title}{' '}
                <small>
                  {formatNumber(value.width)}×{formatNumber(value.height)} mm
                </small>
              </h2>
              <button type="button" className="side-panel-close" aria-label="Zamknij edytor 2D" onClick={() => setWindowOpen(false)}>
                ×
              </button>
            </div>
            <ShapeEditor2D value={value} onCutoutsChange={setCutouts} selectedId={selectedId} onSelect={setSelected} large />
            <p className="field-hint">
              {viewHint} Przeciągnij punkty wycięcia – etykiety pokazują odległości X / Y od narożnika odniesienia wycięcia (0, 0).
              Shift – co 10 mm, Alt – co 0,1 mm; zaznaczony punkt przesuwają też strzałki. {rulesHint}
            </p>
            <div className="shape-window-body">
              {actions}
              {cutouts.length === 0 ? <p className="field-hint">Brak wycięć.</p> : list(`${idPrefix}-win`)}
            </div>
          </div>,
          document.body,
        )}
    </fieldset>
  )
}
