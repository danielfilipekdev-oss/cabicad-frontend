import NumberField from '../ui/NumberField.tsx'
import BoardModelPicker from './BoardModelPicker.tsx'
import GrainField from './GrainField.tsx'
import { BOARD_PARAM_LIMITS, DEFAULT_GRAIN, type GrainDirection, type NumericLimits } from '../boards/board.ts'
import { boardModelOrDefault, fitThicknessToModel } from '../boards/boardCatalog.ts'
import { useBoardCatalog } from '../boards/useBoardCatalog.ts'
import { DIMENSION_STEP, formatNumber } from '../ui/format.ts'

export interface BoardModelValue {
  materialId: string
  thickness: number
  grain?: GrainDirection
}

interface Props<T extends BoardModelValue> {
  value: T
  onChange: (next: T) => void
  idPrefix: string
  /** Range of a hand-entered thickness (a board narrows it to the furniture). */
  thicknessLimits?: NumericLimits
  /** The thickness is fixed by the board's layout constraints – read-only. */
  thicknessLocked?: boolean
}

/**
 * "Płyta": the board model picked from the catalog tree (`BoardModelPicker`), its thickness and the grain
 * direction. The model decides the thickness: one of its variants from a list, or – when the model
 * has none – any thickness entered by hand. Changing the model keeps the thickness if the new model
 * offers it, otherwise 18 mm / the nearest variant. The grain direction can be changed only for a model
 * whose grain matters.
 */
export default function BoardModelFields<T extends BoardModelValue>({
  value,
  onChange,
  idPrefix,
  thicknessLimits = BOARD_PARAM_LIMITS.thickness,
  thicknessLocked = false,
}: Props<T>) {
  useBoardCatalog() // re-render when the catalog arrives (thickness variants, grain lock)
  const model = boardModelOrDefault(value.materialId)
  const variants = model.thicknesses
  const setModel = (materialId: string) =>
    onChange({ ...value, materialId, thickness: fitThicknessToModel(value.thickness, materialId) })
  const offList = variants.length > 0 && !variants.includes(value.thickness)

  return (
    <>
      <div className="field">
        <span>
          Płyta <small>(typ → marka → model; wyznacza teksturę i grubość)</small>
        </span>
        <BoardModelPicker idPrefix={idPrefix} value={value.materialId} grain={value.grain} onChange={setModel} />
      </div>
      <label className="field">
        <span>
          Grubość [mm]{' '}
          {thicknessLocked ? (
            <small className="field-locked">wynika z wiązań</small>
          ) : variants.length ? (
            <small>(warianty płyty)</small>
          ) : (
            <small>
              (dowolna: {formatNumber(thicknessLimits.min)}–{formatNumber(thicknessLimits.max)})
            </small>
          )}
        </span>
        {variants.length ? (
          <select
            className="thickness-select"
            name={`${idPrefix}-thickness`}
            data-field="thickness"
            aria-label="Grubość"
            disabled={thicknessLocked}
            value={String(value.thickness)}
            onChange={(e) => onChange({ ...value, thickness: Number(e.target.value) })}
          >
            {offList && <option value={String(value.thickness)}>{formatNumber(value.thickness)} mm (spoza wariantów płyty)</option>}
            {variants.map((t) => (
              <option key={t} value={String(t)}>
                {formatNumber(t)} mm
              </option>
            ))}
          </select>
        ) : (
          <NumberField
            name={`${idPrefix}-thickness`}
            data-field="thickness"
            aria-label="Grubość"
            min={thicknessLimits.min}
            max={thicknessLimits.max}
            step={DIMENSION_STEP}
            scrubStep={1}
            disabled={thicknessLocked}
            value={value.thickness}
            onChange={(thickness) => onChange({ ...value, thickness })}
          />
        )}
      </label>
      <GrainField
        value={value.grain ?? DEFAULT_GRAIN}
        onChange={(grain) => onChange({ ...value, grain })}
        materialId={value.materialId}
        idPrefix={idPrefix}
      />
    </>
  )
}
