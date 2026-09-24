import { GRAIN_LABELS, type GrainDirection } from '../boards/board.ts'
import { hasGrain } from '../boards/boardCatalog.ts'
import { useBoardCatalog } from '../boards/useBoardCatalog.ts'

interface Props {
  value: GrainDirection
  onChange: (grain: GrainDirection) => void
  /** The board model chosen – the direction can be changed only when its grain matters. */
  materialId: string
  idPrefix: string
}

/**
 * Kierunek usłojenia (grain direction): from edge A to C (along the board height) or from B to D (along the width).
 * Locked for a board model whose grain does not matter (`BoardModel.grainMatters`, e.g. a plain colour).
 */
export default function GrainField({ value, onChange, materialId, idPrefix }: Props) {
  useBoardCatalog()
  const enabled = hasGrain(materialId)
  return (
    <fieldset className="field grain-field" disabled={!enabled} data-grain={value}>
      <legend>
        Kierunek usłojenia {!enabled && <small className="field-locked">(nie dotyczy tej płyty)</small>}
      </legend>
      <div className="grain-options">
        {(Object.keys(GRAIN_LABELS) as GrainDirection[]).map((g) => (
          <label key={g} className="radio grain-option">
            <input
              type="radio"
              name={`${idPrefix}-grain`}
              data-field={`grain-${g}`}
              checked={value === g}
              onChange={() => onChange(g)}
            />
            <span className={`grain-icon grain-icon--${g}`} aria-hidden="true" />
            {GRAIN_LABELS[g]}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
