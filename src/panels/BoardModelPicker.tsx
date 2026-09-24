import { useMemo } from 'react'
import type { GrainDirection } from '../boards/board.ts'
import { boardModelOrDefault, boardSwatchStyle, boardTree, isRawModel, type BoardModel } from '../boards/boardCatalog.ts'
import { useBoardCatalog } from '../boards/useBoardCatalog.ts'
import CatalogTreePicker, { type PickerItem, type PickerNode } from './CatalogTreePicker.tsx'

interface Props {
  /** Id of the chosen board model. */
  value: string
  onChange: (materialId: string) => void
  /** Grain of the board – the swatch is turned to match it. */
  grain?: GrainDirection
  idPrefix: string
  disabled?: boolean
}

const leaf = (m: BoardModel): PickerItem => ({
  id: m.id,
  title: isRawModel(m) ? m.name : m.seriesCode,
  subtitle: isRawModel(m) ? undefined : m.name,
  swatch: boardSwatchStyle(m.id, 'AC'),
  tooltip: m.thicknesses.length ? `Grubości: ${m.thicknesses.join(', ')} mm` : 'Grubość dowolna (wpisywana ręcznie)',
  search: `${m.brand} ${m.seriesCode} ${m.name}`,
})

/**
 * Drop-down list of board models as a tree: Typ (MDF, HDF, płyta wiórowa…) → Marka (Egger, Kronospan…,
 * "Surowe") → the concrete board (series code + decor name) – see `CatalogTreePicker`.
 */
export default function BoardModelPicker({ value, onChange, grain = 'AC', idPrefix, disabled = false }: Props) {
  const { catalog, status, error } = useBoardCatalog()
  const current = boardModelOrDefault(value)
  const tree = useMemo<PickerNode[]>(
    () =>
      boardTree(catalog).map(({ type, brands }) => ({
        key: type.id,
        name: type.name,
        groups: brands.map((b) => ({ key: b.brand, name: b.brand, items: b.boards.map(leaf) })),
      })),
    [catalog],
  )
  const typeName = catalog.types.find((t) => t.id === current.type)?.name ?? current.type
  return (
    <div data-board-picker={idPrefix}>
      <CatalogTreePicker
        tree={tree}
        selectedId={current.id}
        onPick={onChange}
        field="board-model"
        ariaLabel="Płyta"
        disabled={disabled}
        current={{
          id: current.id,
          title: isRawModel(current) ? current.name : `${current.brand} ${current.seriesCode}`,
          subtitle: isRawModel(current) ? typeName : current.name,
          swatch: boardSwatchStyle(current.id, grain),
          tooltip: `${current.brand} · ${current.seriesCode} – ${current.name}`,
        }}
        note={
          status === 'error'
            ? { kind: 'error', text: `Nie udało się pobrać listy płyt z backendu – dostępna tylko płyta domyślna. (${error})` }
            : status === 'loading'
              ? { kind: 'hint', text: 'Wczytywanie listy płyt…' }
              : null
        }
      />
    </div>
  )
}
