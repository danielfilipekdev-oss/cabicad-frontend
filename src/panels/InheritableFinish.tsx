import FinishFields from './FinishFields.tsx'
import type { BoardOrientation } from '../boards/board.ts'
import { finishLabel, finishOf, type BoardFinish } from '../boards/finish.ts'

interface Props {
  /** Own configuration, or null = inherited. */
  value: BoardFinish | null
  onChange: (next: BoardFinish | null) => void
  /** What applies when there is no own configuration. */
  inherited: BoardFinish
  /** Where the inherited configuration comes from, e.g. "z parametrów mebla". */
  inheritedFrom: string
  /** Label of the checkbox, e.g. "Własne dla płyt korpusu". */
  label: string
  idPrefix: string
  orientation: BoardOrientation | null
}

/**
 * Board (model + thickness + grain) + edge banding that is either INHERITED from a more general configuration (furniture → carcass /
 * shelves defaults → section …) or the level's own: a checkbox switches to an own copy (starting from the
 * inherited values), unchecking it goes back to inheriting.
 */
export default function InheritableFinish({ value, onChange, inherited, inheritedFrom, label, idPrefix, orientation }: Props) {
  return (
    <>
      <label className="radio finish-inherit">
        <input
          type="checkbox"
          data-field={`${idPrefix}-own`}
          checked={value !== null}
          onChange={(e) => onChange(e.target.checked ? finishOf(inherited) : null)}
        />
        {label}
        {value === null && (
          <small data-inherited={idPrefix}>
            ({inheritedFrom}: {finishLabel(inherited)})
          </small>
        )}
      </label>
      {value !== null && <FinishFields idPrefix={idPrefix} orientation={orientation} value={value} onChange={onChange} />}
    </>
  )
}
