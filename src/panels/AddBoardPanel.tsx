import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import BoardParamsFields from './BoardParamsFields.tsx'
import {
  DEFAULT_BOARD_PARAMS,
  boardParamLimits,
  fitParamsToFurniture,
  isValidBoardParams,
  type BoardParams,
} from '../boards/board.ts'
import { boardShapeError } from '../boards/boardGeometry.ts'
import { finishOf, type BoardFinish } from '../boards/finish.ts'
import type { Furniture } from '../furniture/furniture.ts'

const ORIGIN = { x: 0, y: 0, z: 0 }

interface Props {
  /** Furniture = working volume; new board dimensions are limited to it. */
  furniture: Furniture
  onAdd: (params: BoardParams) => void
  onClose: () => void
  /**
   * Parameters of the board the form would add (fitted to the furniture), or null when they are invalid
   * / the mouse is not over the form / the panel closes – previewed in the scene as a green wireframe.
   */
  onDraftChange?: (params: BoardParams | null) => void
  /** Board (model + thickness + grain) + edge banding from the furniture parameters – the starting finish of a new board. */
  defaultFinish?: BoardFinish
  /** The "Płyty korpusu" part (dach, podłoga, boki, plecy) shown above the single board form. */
  carcass?: ReactNode
}

/**
 * "Dodaj płytę" (to the right of the tool panel):
 *  - top: the carcass boards (`CarcassPanel`) – the whole carcass or single roles,
 *  - below: a single board with its own parameters.
 * Hovering either part previews in the scene what would be added (green wireframe). The added boards
 * are listed in "Płyty" (`BoardsPanel`).
 */
export default function AddBoardPanel({ furniture, onAdd, onClose, onDraftChange, defaultFinish, carcass }: Props) {
  const [params, setParams] = useState<BoardParams>(() => (defaultFinish ? { ...DEFAULT_BOARD_PARAMS, ...finishOf(defaultFinish) } : DEFAULT_BOARD_PARAMS))
  // the furniture default changed → the form takes it over (the finish is inherited from the furniture)
  const lastDefault = useRef(defaultFinish)
  useEffect(() => {
    if (!defaultFinish || lastDefault.current === defaultFinish) return
    lastDefault.current = defaultFinish
    setParams((p) => ({ ...p, ...finishOf(defaultFinish) }))
  }, [defaultFinish])
  // the new board must fit into the furniture (it can shrink after the params were entered)
  const fitted = fitParamsToFurniture(params, furniture)
  const limits = boardParamLimits(fitted.orientation, ORIGIN, furniture)
  const bandError = boardShapeError(fitted)
  const valid = isValidBoardParams(fitted) && !bandError

  // report the draft to the scene preview (only when it changes – keyed by its content)
  /** The mouse is over the "Pojedyncza płyta" section – only then the new board is previewed in the scene. */
  const [hoveringNew, setHoveringNew] = useState(false)
  const draftKey = valid && hoveringNew ? JSON.stringify(fitted) : ''
  const onDraftRef = useRef(onDraftChange)
  onDraftRef.current = onDraftChange
  useEffect(() => {
    onDraftRef.current?.(draftKey ? (JSON.parse(draftKey) as BoardParams) : null)
  }, [draftKey])
  useEffect(() => () => onDraftRef.current?.(null), [])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (valid) onAdd(fitted)
  }

  return (
    <aside className="side-panel add-board-panel" aria-label="Dodaj płytę">
      <div className="side-panel-header">
        <h2>Dodaj płytę</h2>
        <button type="button" className="side-panel-close" aria-label="Zamknij" onClick={onClose}>×</button>
      </div>
      {carcass}
      <section
        className="side-panel-section"
        data-section="new-board"
        onMouseEnter={() => setHoveringNew(true)}
        onMouseLeave={() => setHoveringNew(false)}
      >
        <h3 className="side-panel-subtitle">Pojedyncza płyta</h3>
        <form className="side-panel-form" onSubmit={submit}>
          <BoardParamsFields
            value={fitted}
            onChange={(p) => setParams(fitParamsToFurniture(p, furniture))}
            idPrefix="new"
            limits={limits}
            title="Nowa płyta"
          />
          <button type="submit" className="primary-button" data-action="add-board" disabled={!valid}>Dodaj płytę</button>
          {!valid && <p className="field-error">{bandError ?? 'Wymiary poza dozwolonym zakresem.'}</p>}
        </form>
      </section>
    </aside>
  )
}
