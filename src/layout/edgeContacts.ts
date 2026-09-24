import { dimensionAxis, type Board, type BoardOrientation } from '../boards/board.ts'
import { resolveEdgeBand, type EdgeBanding, type EdgeId } from '../boards/edgeBanding.ts'
import {
  CONTACT_EPS,
  FACES,
  boardFaceValue,
  faceAxis,
  oppositeFace,
  overlapsAcross,
  type Face,
} from './constraints.ts'

/**
 * Edges hidden by a contact: an edge (a narrow face) of a board that TOUCHES another board gets NO edge
 * band – a band on an edge butting against another board makes no sense (it would be hidden inside the
 * joint and only add thickness). E.g. a shelf between the sides (its left / right edges), a side under an
 * overlaid top (its top edge), a back between the sides.
 *
 * Derived, not stored: the board keeps its configured banding; while the edge touches another board its
 * band is left out everywhere it is shown (render, board tile, 2D view, band form – locked there). Move
 * the board away / remove it and the band is back. So no way of setting a finish (a board's form, the
 * carcass / section / furniture defaults and their "Zastosuj" buttons) can put a band on such an edge.
 *
 * A contact = two boards with OPPOSITE faces in one plane and a shared area (like `findContacts`), with
 * or without a joint between them; the face of each board that is an edge (not its large surface) and
 * has a band loses it. Touching the furniture walls does not count (they are not boards), nor does touching
 * a front (a door / flap opens – the edges behind it stay banded).
 */
export interface HiddenBand {
  /** Board side A–D whose band is left out. */
  edge: EdgeId
  face: Face
  /** Board the edge is joined to. */
  by: string
}

/** Board face (on a non-thickness axis) → its side A–D (see `edgeSideLabel`). */
export function faceEdge(orientation: BoardOrientation, face: Face): EdgeId | null {
  const map: Record<BoardOrientation, Partial<Record<Face, EdgeId>>> = {
    vertical: { top: 'A', right: 'B', bottom: 'C', left: 'D' },
    side: { top: 'A', back: 'B', bottom: 'C', front: 'D' },
    horizontal: { back: 'A', right: 'B', front: 'C', left: 'D' },
  }
  return map[orientation][face] ?? null
}

/** @param movable boards opening on a hinge (`layout/hinges.ts`) – touching them takes no band away. */
export function hiddenBands(boards: Board[], movable: Set<string> = new Set()): Map<string, HiddenBand[]> {
  const result = new Map<string, HiddenBand[]>()
  const add = (board: Board, face: Face, other: Board) => {
    if (faceAxis(face) === dimensionAxis(board.orientation, 'thickness')) return // a surface, not an edge
    const edge = faceEdge(board.orientation, face)
    if (!edge || !resolveEdgeBand(board.edgeBanding, edge)) return
    const list = result.get(board.id) ?? []
    if (!list.some((h) => h.edge === edge)) list.push({ edge, face, by: other.id })
    result.set(board.id, list)
  }
  boards.forEach((a, i) => {
    // a board on a hinge (door / flap / opening top) moves – touching it takes no band away (visible when open)
    if (movable.has(a.id)) return
    for (const b of boards.slice(i + 1)) {
      if (movable.has(b.id)) continue
      for (const face of FACES) {
        const other = oppositeFace(face)
        if (Math.abs(boardFaceValue(a, face) - boardFaceValue(b, other)) > CONTACT_EPS) continue
        if (!overlapsAcross(a, b, faceAxis(face))) continue
        add(a, face, b)
        add(b, other, a)
      }
    }
  })
  return result
}

/** Map edge → reason ("przylega do Lewy bok") of the hidden bands of one board – for the band form. */
export function hiddenEdgeReasons(hidden: HiddenBand[] | undefined, boards: Board[]): Map<string, string> {
  return new Map((hidden ?? []).map((h) => [h.edge, `przylega do: ${boards.find((b) => b.id === h.by)?.name ?? '?'}`]))
}

/**
 * Puts the configured bands of the hidden edges back into a banding that was edited from the SHOWN one
 * (e.g. by the cut-out editor) – the hidden edges must never be written into the configuration.
 */
export function restoreHiddenBands(edited: EdgeBanding, configured: EdgeBanding, hidden: HiddenBand[] | undefined): EdgeBanding {
  if (!hidden?.length) return edited
  const overrides = { ...edited.overrides }
  for (const h of hidden) {
    if (h.edge in configured.overrides) overrides[h.edge] = configured.overrides[h.edge]
    else delete overrides[h.edge]
  }
  return { ...edited, overrides }
}

/** The banding with the hidden edges left out (overridden to "no band"). */
export function withoutHiddenBands(banding: EdgeBanding, hidden: HiddenBand[] | undefined): EdgeBanding {
  if (!hidden?.length) return banding
  const overrides = { ...banding.overrides }
  for (const h of hidden) overrides[h.edge] = null
  return { ...banding, overrides }
}
