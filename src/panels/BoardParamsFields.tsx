import NumberField from '../ui/NumberField.tsx'
import EdgeBandingFields from './EdgeBandingFields.tsx'
import CutoutsFields from './CutoutsFields.tsx'
import GroovesFields from './GroovesFields.tsx'
import { restoreHiddenBands, withoutHiddenBands, type HiddenBand } from '../layout/edgeContacts.ts'
import { boardContour, uniqueEdges } from '../boards/cutouts.ts'
import { DIMENSION_STEP, formatNumber } from '../ui/format.ts'
import {
  BOARD_PARAM_LIMITS,
  ORIENTATION_LABELS,
  type BoardDimension,
  type BoardOrientation,
  type BoardParams,
  type NumericLimits,
} from '../boards/board.ts'
import BoardModelFields from './BoardModelFields.tsx'

type NumericField = BoardDimension

const ORIENTATION_HINTS: Record<BoardOrientation, string> = {
  vertical: ' (płaszczyzna XY – front / plecy)',
  side: ' (płaszczyzna YZ – bok, szerokość = głębokość)',
  horizontal: ' (płaszczyzna XZ – leży poziomo)',
}

/** Thickness is not here – it comes with the board model (`BoardModelFields`). */
const NUMERIC_FIELDS: { key: NumericField; label: string }[] = [
  { key: 'height', label: 'Wysokość' },
  { key: 'width', label: 'Szerokość' },
]

interface Props {
  value: BoardParams
  onChange: (next: BoardParams) => void
  /** Prefix making input / radio names unique when several forms are shown at once. */
  idPrefix: string
  /** Allowed ranges of the dimensions – narrowed by the furniture (and the board position). */
  limits?: Record<BoardDimension, NumericLimits>
  /** Name shown in the title of the 2D shape editor window (e.g. "Płyta 3" / "Nowa płyta"). */
  title?: string
  /** Dimensions fixed by the board's layout constraints – read-only here (see `boardLocks`). */
  lockedDims?: Partial<Record<NumericField, boolean>>
  /**
   * The orientation cannot be changed – true: other boards hang on this one (their joints would break),
   * or a string with the reason shown instead (e.g. a carcass board – its role sets the orientation).
   */
  lockedOrientation?: boolean | string
  /** Edges touching another board – no band there (shown without it, locked in the band form). */
  hiddenBands?: HiddenBand[]
  /** Names of the boards those edges touch (edge → "przylega do: …"). */
  hiddenReasons?: Map<string, string>
}

/**
 * Shared inputs for the board model (płyta: model + thickness + grain), dimensions [mm], orientation, cut-outs (shape) and edge banding (used by the add and the edit forms).
 * Dimensions are limited to `limits` (so the board cannot leave the furniture, min 1 mm) – typing and
 * the scrub handle are both clamped to that range.
 */
export default function BoardParamsFields({ value, onChange, idPrefix, limits = BOARD_PARAM_LIMITS, title = 'Płyta', lockedDims = {}, lockedOrientation = false, hiddenBands, hiddenReasons }: Props) {
  const setNumber = (key: NumericField, v: number) => onChange({ ...value, [key]: v })
  const edges = uniqueEdges(boardContour(value))
  const shown = hiddenBands?.length ? { ...value, edgeBanding: withoutHiddenBands(value.edgeBanding, hiddenBands) } : value

  return (
    <>
      <BoardModelFields
        idPrefix={idPrefix}
        value={value}
        onChange={onChange}
        thicknessLimits={limits.thickness}
        thicknessLocked={lockedDims.thickness}
      />
      {NUMERIC_FIELDS.map(({ key, label }) => (
        <label key={key} className="field">
          <span>
            {label} [mm]{' '}
            {lockedDims[key] ? (
              <small className="field-locked">wynika z wiązań</small>
            ) : (
              <small>({formatNumber(limits[key].min)}–{formatNumber(limits[key].max)})</small>
            )}
          </span>
          <NumberField
            name={`${idPrefix}-${key}`}
            data-field={key}
            aria-label={label}
            min={limits[key].min}
            max={limits[key].max}
            step={DIMENSION_STEP}
            scrubStep={1}
            disabled={lockedDims[key]}
            value={value[key]}
            onChange={(v) => setNumber(key, v)}
          />
        </label>
      ))}
      <fieldset className="field" disabled={!!lockedOrientation}>
        <legend>
          Orientacja płyty{' '}
          {lockedOrientation && (
            <small className="field-locked">
              zablokowana – {typeof lockedOrientation === 'string' ? lockedOrientation : 'inne płyty są od niej zależne'}
            </small>
          )}
        </legend>
        {(Object.keys(ORIENTATION_LABELS) as BoardOrientation[]).map((o) => (
          <label key={o} className="radio">
            <input
              type="radio"
              name={`${idPrefix}-orientation`}
              value={o}
              checked={value.orientation === o}
              onChange={() => onChange({ ...value, orientation: o })}
            />
            {ORIENTATION_LABELS[o]}
            <small>{ORIENTATION_HINTS[o]}</small>
          </label>
        ))}
      </fieldset>
      {/* the 2D view shows the banding without the hidden edges; they never get written back */}
      <CutoutsFields
        value={shown}
        onChange={(next) => onChange({ ...next, edgeBanding: restoreHiddenBands(next.edgeBanding, value.edgeBanding, hiddenBands) })}
        idPrefix={idPrefix}
        title={title}
      />
      <GroovesFields
        value={shown}
        onChange={(next) => onChange({ ...value, grooves: next.grooves })}
        idPrefix={idPrefix}
        title={title}
      />
      <EdgeBandingFields
        value={value.edgeBanding}
        materialId={value.materialId}
        boardThickness={value.thickness}
        onChange={(edgeBanding) => onChange({ ...value, edgeBanding })}
        orientation={value.orientation}
        edges={edges}
        idPrefix={idPrefix}
        locked={hiddenReasons}
      />
    </>
  )
}
