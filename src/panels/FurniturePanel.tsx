import NumberField from '../ui/NumberField.tsx'
import FinishFields from './FinishFields.tsx'
import type { BoardFinish } from '../boards/finish.ts'
import { DIMENSION_STEP, formatNumber } from '../ui/format.ts'
import { boardsExtent, type Board } from '../boards/board.ts'
import { boardsFollowingFurniture, type AnchorConstraint } from '../layout/constraints.ts'
import { autoRemovableDividers, type Section } from '../sections/sections.ts'
import {
  FURNITURE_DIMENSION_LABELS,
  FURNITURE_LIMITS,
  type Furniture,
  type FurnitureDimension,
  type NumericLimits,
} from '../furniture/furniture.ts'

interface Props {
  furniture: Furniture
  boards: Board[]
  constraints: AnchorConstraint[]
  /** Number of layout constraints that cannot be satisfied. */
  violatedCount: number
  onChange: (furniture: Furniture) => void
  onClose: () => void
  /** Default board (model + thickness) + edge banding of the furniture – inherited by all more specific configurations. */
  finish: BoardFinish
  onFinishChange: (finish: BoardFinish) => void
  /** Sets the inherited finish on the carcass boards, shelves and partitions already added. */
  onApplyFinish: () => void
  /** Number of carcass boards + shelves / partitions (the boards "Zastosuj" changes). */
  structuredCount: number
  /** Section tree – automatic shelves / partitions go away when the furniture shrinks, so they do not limit it. */
  sections?: Section
}

const DIMENSIONS: FurnitureDimension[] = ['height', 'width', 'depth']
/** Axis index of every furniture dimension (X = width, Y = height, Z = depth). */
const AXIS: Record<FurnitureDimension, 0 | 1 | 2> = { width: 0, height: 1, depth: 2 }

/**
 * Helper panel "Parametry mebla": height / width / depth of the furniture cuboid [mm].
 * The furniture is also the working volume for the boards, so it cannot be made smaller than the
 * space the boards already occupy (the minimum of every field grows with the boards).
 */
export default function FurniturePanel({
  furniture,
  boards,
  constraints,
  violatedCount,
  onChange,
  onClose,
  finish,
  onFinishChange,
  onApplyFinish,
  structuredCount,
  sections,
}: Props) {
  // boards bound (through constraints) to the far furniture wall follow it – only the free ones limit it
  const extentOf = (key: FurnitureDimension) => {
    const following = boardsFollowingFurniture(constraints, AXIS[key])
    const removable = sections ? autoRemovableDividers(sections, AXIS[key]) : new Set<string>()
    return boardsExtent(boards.filter((b) => !following.has(b.id) && !removable.has(b.id)))[AXIS[key]]
  }
  const limitsOf = (key: FurnitureDimension): NumericLimits => {
    const { min, max } = FURNITURE_LIMITS[key]
    return { min: Math.min(max, Math.max(min, extentOf(key))), max }
  }
  const limitedByBoards = DIMENSIONS.some((key) => extentOf(key) > FURNITURE_LIMITS[key].min)

  return (
    <aside className="side-panel" aria-label="Parametry mebla">
      <section className="side-panel-section">
        <div className="side-panel-header">
          <h2>Parametry mebla</h2>
          <button type="button" className="side-panel-close" aria-label="Zamknij" onClick={onClose}>×</button>
        </div>
        <div className="side-panel-form">
          {DIMENSIONS.map((key) => {
            const limits = limitsOf(key)
            const label = FURNITURE_DIMENSION_LABELS[key]
            return (
              <label key={key} className="field">
                <span>
                  {label} [mm] <small>({formatNumber(limits.min)}–{formatNumber(limits.max)})</small>
                </span>
                <NumberField
                  name={`furniture-${key}`}
                  data-field={`furniture-${key}`}
                  aria-label={`${label} mebla`}
                  min={limits.min}
                  max={limits.max}
                  step={DIMENSION_STEP}
                  scrubStep={1}
                  value={furniture[key]}
                  onChange={(v) => onChange({ ...furniture, [key]: v })}
                />
              </label>
            )
          })}
          {limitedByBoards && (
            <p className="field-hint">Mebel nie może być mniejszy niż obszar zajęty przez płyty niezwiązane z jego ścianami.</p>
          )}
          {constraints.length > 0 && (
            <p className="field-hint">
              Płyty związane ze ścianami mebla (wiązania) przesuwają się i rozciągają razem z nim.
            </p>
          )}
          {violatedCount > 0 && (
            <p className="field-error">Niespełnione wiązania: {violatedCount} – płyty się nie mieszczą albo wiązania są sprzeczne.</p>
          )}
          <fieldset className="field finish-group" data-finish-group="furniture">
            <legend>
              Płyta i obrzeże mebla <small>(domyślne dla wszystkich płyt)</small>
            </legend>
            <FinishFields idPrefix="furniture" orientation={null} value={finish} onChange={onFinishChange} />
            <small className="field-hint">
              Dziedziczą je nowe płyty („Dodaj płytę”), płyty korpusu i półki / przedziały – chyba że mają własną konfigurację
              (domyślną panelu, płyty korpusu albo sekcji).
            </small>
            {structuredCount > 0 && (
              <button
                type="button"
                className="small-button"
                data-action="furniture-apply-finish"
                title="Ustawia na dodanych płytach korpusu, półkach i przedziałach płytę (model, grubość, usłojenie) i obrzeże, które dziedziczą (z uwzględnieniem ich nadpisań). Zwykłe płyty zostają bez zmian."
                onClick={onApplyFinish}
              >
                Zastosuj do płyt korpusu, półek i przedziałów ({structuredCount})
              </button>
            )}
          </fieldset>
          <p className="field-hint">
            Mebel to obszar roboczy płyt (niebieski obrys). Pozycje płyt liczone są od lewego-górnego rogu dna
            mebla (czerwona kropka): X – w prawo, Y – w górę, Z – do przodu.
          </p>
        </div>
      </section>
    </aside>
  )
}
