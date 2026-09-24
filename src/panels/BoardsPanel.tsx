import { useMemo } from 'react'
import BoardCard from './BoardCard.tsx'
import { collidingBoards, type Board } from '../boards/board.ts'
import type { HiddenBand } from '../layout/edgeContacts.ts'
import type { Furniture } from '../furniture/furniture.ts'
import type { AnchorConstraint } from '../layout/constraints.ts'

interface Props {
  boards: Board[]
  furniture: Furniture
  onUpdate: (board: Board) => void
  onRemove: (id: string) => void
  onClose: () => void
  /** Board currently being edited (highlighted in the scene), or null. */
  editingId: string | null
  onEditingChange: (id: string | null) => void
  /** Layout constraints (wiązania) of all boards. */
  constraints: AnchorConstraint[]
  /** Ids of constraints that are not satisfied. */
  violated: string[]
  onConstraintsChange: (constraints: AnchorConstraint[]) => void
  /** Per board: edges touching another board (no band there – see `layout/edgeContacts.ts`). */
  hiddenBands?: Map<string, HiddenBand[]>
  /** Opens "Dodaj płytę" (from the empty list). */
  onAddClick?: () => void
}

/**
 * "Płyty" – every added board (carcass, shelves / partitions, fronts, single boards): a card per board
 * with its summary; the expanded card edits it (dimensions, board model, bands, cut-outs, grooves,
 * joints). A board clicked in the scene opens here.
 */
export default function BoardsPanel({
  boards,
  furniture,
  onUpdate,
  onRemove,
  onClose,
  editingId,
  onEditingChange,
  constraints,
  violated,
  onConstraintsChange,
  hiddenBands,
  onAddClick,
}: Props) {
  const collisions = useMemo(
    () => new Map(boards.map((b) => [b.id, collidingBoards(b, boards).map((o) => o.name)])),
    [boards],
  )
  return (
    <aside className="side-panel" aria-label="Płyty">
      <div className="side-panel-header">
        <h2>Płyty ({boards.length})</h2>
        <button type="button" className="side-panel-close" aria-label="Zamknij" onClick={onClose}>×</button>
      </div>
      <section className="board-list-section" aria-label="Dodane płyty">
        {boards.length === 0 ? (
          <p className="board-list-empty">
            Brak płyt.{' '}
            {onAddClick && (
              <button type="button" className="small-button" onClick={onAddClick}>
                Dodaj płytę
              </button>
            )}
          </p>
        ) : (
          <ul className="board-list">
            {boards.map((b) => (
              <BoardCard
                key={b.id}
                board={b}
                boards={boards}
                furniture={furniture}
                constraints={constraints}
                violated={violated}
                onConstraintsChange={onConstraintsChange}
                collisions={collisions.get(b.id) ?? []}
                editing={editingId === b.id}
                onEditChange={(on) => onEditingChange(on ? b.id : editingId === b.id ? null : editingId)}
                onChange={onUpdate}
                onRemove={() => onRemove(b.id)}
                hiddenBands={hiddenBands?.get(b.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </aside>
  )
}
