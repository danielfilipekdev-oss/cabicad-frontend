import { useEffect, useRef, type MouseEvent } from 'react'
import BoardParamsFields from './BoardParamsFields.tsx'
import ConstraintsFields from './ConstraintsFields.tsx'
import { boardLocks, isDimensionLocked, type AnchorConstraint } from '../layout/constraints.ts'
import NumberField from '../ui/NumberField.tsx'
import type { Furniture } from '../furniture/furniture.ts'
import {
  ORIENTATION_LABELS,
  boardParamLimits,
  boardPositionLimits,
  fitBoardToFurniture,
  type Board,
  type BoardParams,
  type BoardPosition,
} from '../boards/board.ts'
import { boardModelLabel, boardSwatchStyle, hasGrain } from '../boards/boardCatalog.ts'
import { useBoardCatalog } from '../boards/useBoardCatalog.ts'
import { edgeBandLabel, edgeSideLabel, resolveEdgeBand, type EdgeId } from '../boards/edgeBanding.ts'
import { edgeBandTagStyle } from '../boards/edgeBandCatalog.ts'
import { boardContour, boardCutouts, edgeKindLabel, shapeLabel, uniqueEdges } from '../boards/cutouts.ts'
import { boardShapeError } from '../boards/boardGeometry.ts'
import { CARCASS_LABELS } from '../carcass/carcass.ts'
import { DIVIDER_LABELS } from '../sections/sections.ts'
import { hiddenEdgeReasons, withoutHiddenBands, type HiddenBand } from '../layout/edgeContacts.ts'
import { DIMENSION_STEP, formatNumber } from '../ui/format.ts'
import { useOpenBoards } from '../scene/openBoards.ts'

interface Props {
  board: Board
  /** All boards (targets of the layout constraints). */
  boards: Board[]
  /** Furniture = working volume; the board dimensions and position are limited to it. */
  furniture: Furniture
  /** Layout constraints (wiązania) of all boards. */
  constraints: AnchorConstraint[]
  /** Ids of constraints that are not satisfied. */
  violated: string[]
  onConstraintsChange: (constraints: AnchorConstraint[]) => void
  /** Names of the boards this board collides with (empty = no collision). */
  collisions: string[]
  editing: boolean
  /** Opens (true) or closes (false) the edit mode of this tile. */
  onEditChange: (editing: boolean) => void
  onChange: (board: Board) => void
  onRemove: () => void
  /** Edges of this board touching another board – shown / configured without a band. */
  hiddenBands?: HiddenBand[]
}

const AXES: (keyof BoardPosition)[] = ['x', 'y', 'z']

/**
 * Tile of a single, already added board: summary + "Edytuj" / "Usuń".
 * Clicking the tile (or "Edytuj") opens the edit mode – the edited board is highlighted in the scene
 * (green edges). All parameters incl. position can be changed; inputs are limited to the allowed
 * ranges, so every change is valid and is applied to the scene immediately.
 */
export default function BoardCard({
  board,
  boards,
  furniture,
  constraints,
  violated,
  onConstraintsChange,
  collisions,
  editing,
  onEditChange,
  onChange,
  onRemove,
  hiddenBands: hiddenBandsOfBoard,
}: Props) {
  useBoardCatalog() // labels / swatches follow the loaded catalog
  const own = constraints.filter((c) => c.board === board.id)
  const ownViolated = own.filter((c) => violated.includes(c.id)).length
  // what the joints of this board fix – those fields are read-only, the offsets are edited above
  const locks = boardLocks(constraints, board.id)
  const lockedDims = {
    width: isDimensionLocked(locks, board, 'width'),
    height: isDimensionLocked(locks, board, 'height'),
  }
  const AXIS_INDEX: Record<keyof BoardPosition, 0 | 1 | 2> = { x: 0, y: 1, z: 2 }
  // limits keep the board inside the furniture (dimensions: up to the furniture wall from the current
  // position, position: 0 … furniture size − board size); orientation changes are fitted afterwards
  const paramLimits = boardParamLimits(board.orientation, board.position, furniture)
  const positionLimits = boardPositionLimits(board, furniture)
  const updateParams = (p: BoardParams) => onChange(fitBoardToFurniture({ ...board, ...p }, furniture))
  const updatePos = (axis: keyof BoardPosition, v: number) =>
    onChange(fitBoardToFurniture({ ...board, position: { ...board.position, [axis]: v } }, furniture))

  const edges = uniqueEdges(boardContour(board))
  // edges touching another board lose their band (see `layout/edgeContacts.ts`)
  const hidden = hiddenBandsOfBoard ?? []
  const hiddenReasons = hiddenEdgeReasons(hidden, boards)
  const nameOf = (id: string) => boards.find((b) => b.id === id)?.name ?? '?'
  // judged on the banding actually used (edges touching other boards have none)
  const bandError = boardShapeError(hiddenBandsOfBoard?.length ? { ...board, edgeBanding: withoutHiddenBands(board.edgeBanding, hiddenBandsOfBoard) } : board)

  // when the edit mode opens (e.g. after clicking the board in the scene) bring the tile into view
  const cardRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (editing) cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [editing])

  // clicking anywhere on the tile header (except its buttons) opens the edit mode
  const onHeaderClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    if (!editing) onEditChange(true)
  }

  const { hinged, open, toggle } = useOpenBoards()
  return (
    <li ref={cardRef} className={`board-card${editing ? ' board-card--editing' : ''}`} data-board-id={board.id}>
      <div className="board-card-header" onClick={onHeaderClick} title={editing ? undefined : 'Kliknij, aby edytować'}>
        <div className="board-card-title">
          <b>{board.name}</b>
          {board.role && (
            <span className="board-card-summary carcass-badge" data-summary="carcass">
              płyta korpusu
            </span>
          )}
          {board.front && (
            <span className="board-card-summary carcass-badge" data-summary="front">
              front · Fronty
            </span>
          )}
          {board.divider && (
            <span className="board-card-summary carcass-badge" data-summary="divider">
              {DIVIDER_LABELS[board.divider].toLowerCase()} · Półki i Przedziały
            </span>
          )}
          <span className="board-card-summary">
            {formatNumber(board.width)}×{formatNumber(board.height)}×{formatNumber(board.thickness)} mm ·{' '}
            {ORIENTATION_LABELS[board.orientation]}
          </span>
          {(board.grooves?.length ?? 0) > 0 && (
            <span className="board-card-summary" data-summary="grooves">
              frezowania: {board.grooves!.length}
            </span>
          )}
          {boardCutouts(board).length > 0 && (
            <span className="board-card-summary" data-summary="shape">
              kształt: {shapeLabel(boardCutouts(board))}
            </span>
          )}
          <span className="board-card-summary">
            <span className="board-swatch board-swatch--tiny" style={boardSwatchStyle(board.materialId, board.grain)} aria-hidden="true" />
            płyta: {boardModelLabel(board.materialId)}
            {hasGrain(board.materialId) && (
              <span data-summary="grain"> · usłojenie {board.grain === 'BD' ? 'B–D ↔' : 'A–C ↕'}</span>
            )}
          </span>
          <span className="board-card-summary board-card-edges">
            obrzeża:
            {edges.map((edge) => {
              const configured = resolveEdgeBand(board.edgeBanding, edge.key)
              const hiddenBy = hidden.find((h) => h.edge === edge.key)
              const band = hiddenBy ? null : configured
              const side = edge.kind === 'side' ? edgeSideLabel(board.orientation, edge.key as EdgeId) : edgeKindLabel(edge)
              return (
                <span
                  key={edge.key}
                  className={`edge-tag edge-tag--small${band ? '' : ' edge-tag--none'}${hiddenBy ? ' edge-tag--hidden' : ''}`}
                  style={edgeBandTagStyle(band?.typeId)}
                  title={
                    hiddenBy
                      ? `${edge.label} (${side}): przylega do ${nameOf(hiddenBy.by)} – obrzeże (${edgeBandLabel(configured)}) pominięte`
                      : `${edge.label} (${side}): ${edgeBandLabel(band)}`
                  }
                  data-hidden-band={hiddenBy ? 'true' : undefined}
                >
                  {edge.label}
                  {band && <small>{formatNumber(band.thickness)}</small>}
                </span>
              )
            })}
          </span>
          {hidden.length > 0 && (
            <span className="board-card-summary board-card-hidden-bands" data-summary="hidden-bands">
              bez obrzeża (przylega):{' '}
              {hidden.map((h) => `${h.edge} → ${nameOf(h.by)}`).join(', ')}
            </span>
          )}
          <span className="board-card-summary">
            poz. X {formatNumber(board.position.x)} · Y {formatNumber(board.position.y)} · Z {formatNumber(board.position.z)}
          </span>
          {own.length > 0 && (
            <span className="board-card-summary" data-summary="constraints">
              wiązania: {own.length}
              {ownViolated > 0 && <b className="text-error"> (niespełnione: {ownViolated})</b>}
            </span>
          )}
        </div>
        <div className="board-card-actions">
          {hinged.has(board.id) && (
            <button
              type="button"
              className="small-button"
              data-action="board-open"
              aria-pressed={open.has(board.id)}
              title="Płyta ma wiązanie-zawias – otwiera się wokół niego (tylko podgląd)"
              onClick={() => toggle(board.id)}
            >
              {open.has(board.id) ? 'Zamknij' : 'Otwórz'}
            </button>
          )}
          <button type="button" className="small-button" aria-pressed={editing} onClick={() => onEditChange(!editing)}>
            {editing ? 'Gotowe' : 'Edytuj'}
          </button>
          <button type="button" className="small-button small-button--danger" onClick={onRemove} aria-label={`Usuń ${board.name}`}>
            Usuń
          </button>
        </div>
      </div>
      {collisions.length > 0 && <p className="field-error">Koliduje z: {collisions.join(', ')}</p>}
      {bandError && <p className="field-error">{bandError}</p>}
      {editing && (
        <div className="side-panel-form board-card-form">
          <BoardParamsFields
            value={board}
            onChange={updateParams}
            idPrefix={`edit-${board.id}`}
            limits={paramLimits}
            title={board.name}
            lockedDims={lockedDims}
            hiddenBands={hidden}
            hiddenReasons={hiddenReasons}
            lockedOrientation={
              board.role
                ? `płyta korpusu (${CARCASS_LABELS[board.role].toLowerCase()})`
                : board.divider
                  ? `${DIVIDER_LABELS[board.divider].toLowerCase()} sekcji`
                  : board.front
                    ? 'front'
                    : locks.orientation
            }
          />
          <fieldset className="field">
            <legend>Pozycja [mm] <small>(od lewego-górnego rogu dna mebla)</small></legend>
            <div className="position-row">
              {AXES.map((axis) => (
                <label key={axis} className="position-input">
                  <span>
                    {axis.toUpperCase()}{' '}
                    {locks.position[AXIS_INDEX[axis]] ? (
                      <small className="field-locked">z wiązań</small>
                    ) : (
                      <small>(0–{formatNumber(positionLimits[axis].max)})</small>
                    )}
                  </span>
                  <NumberField
                    name={`edit-${board.id}-pos-${axis}`}
                    data-field={`pos-${axis}`}
                    aria-label={`Pozycja ${axis.toUpperCase()}`}
                    min={positionLimits[axis].min}
                    max={positionLimits[axis].max}
                    step={DIMENSION_STEP}
                    scrubStep={1}
                    disabled={locks.position[AXIS_INDEX[axis]]}
                    value={board.position[axis]}
                    onChange={(v) => updatePos(axis, v)}
                  />
                </label>
              ))}
            </div>
            {own.length > 0 && (
              <small className="field-hint">
                Pozycję i wymiary wynikające z wiązań zmienia się ich odstępem (sekcja „Wiązania”). Usunięcie
                wiązania przywraca płytę tam, gdzie była przed jego dodaniem.
              </small>
            )}
          </fieldset>
          <ConstraintsFields
            board={board}
            boards={boards}
            furniture={furniture}
            constraints={constraints}
            violated={violated}
            onChange={onConstraintsChange}
          />
        </div>
      )}
    </li>
  )
}
