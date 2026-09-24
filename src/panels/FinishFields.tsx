import EdgeBandingFields from './EdgeBandingFields.tsx'
import BoardModelFields from './BoardModelFields.tsx'
import type { BoardOrientation } from '../boards/board.ts'
import { RECT_EDGES, type BoardFinish } from '../boards/finish.ts'

interface Props {
  value: BoardFinish
  onChange: (next: BoardFinish) => void
  idPrefix: string
  /**
   * Orientation of the boards the configuration is for (side names next to the edge letters), or null
   * when it is for boards of different orientations – then a hint says which letter is the front.
   */
  orientation: BoardOrientation | null
}

/**
 * Board (model płyty + grubość + kierunek usłojenia) + ABS edge banding (obrzeże) – the same inputs as
 * in the form of an ordinary board (see `BoardParamsFields` / `EdgeBandingFields`), for a default /
 * override configuration of new boards.
 */
export default function FinishFields({ value, onChange, idPrefix, orientation }: Props) {
  return (
    <div className="finish-fields" data-finish={idPrefix}>
      <BoardModelFields idPrefix={idPrefix} value={value} onChange={onChange} />
      <EdgeBandingFields
        value={value.edgeBanding}
        materialId={value.materialId}
        boardThickness={value.thickness}
        onChange={(edgeBanding) => onChange({ ...value, edgeBanding })}
        orientation={orientation}
        edges={RECT_EDGES}
        idPrefix={idPrefix}
      />
      {orientation === null && (
        <p className="field-hint">
          Krawędzie A–D liczone jak w płycie: pozioma (dach, podłoga, półka) – C przód; pionowa boczna (bok, przedział) – D
          przód; plecy – A góra.
        </p>
      )}
    </div>
  )
}
