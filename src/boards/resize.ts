import { furnitureSize, type Furniture } from '../furniture/furniture.ts'
import { boardBounds, dimensionAxis, type Board } from './board.ts'

/**
 * Resizing a board by dragging an edge of its outline in the scene.
 *
 * A board box has 12 edges; each one lies where two faces meet:
 *  - edge along the board HEIGHT      → lies on a width face  → changes the WIDTH (from that side),
 *  - edge along the board WIDTH       → lies on a height face → changes the HEIGHT,
 *  - edge along the THICKNESS (short) → a corner              → changes the width AND the height.
 * The thickness never changes. The face on the other side stays in place (dragging the min side moves
 * the position), the board stays inside the furniture and at least 1 mm big.
 */

export type ResizeKey = 'width' | 'height'
export type Axis3 = 0 | 1 | 2
export type Vec3 = [number, number, number]

/** One dimension changed by an edge: its world axis and which face moves (0 = min, 1 = max). */
export interface ResizeSide {
  key: ResizeKey
  axis: Axis3
  side: 0 | 1
}

export interface BoardEdge {
  /** Unique id, e.g. "width:1|height:0". */
  id: string
  a: Vec3
  b: Vec3
  sides: ResizeSide[]
}

/** Board edges (of the gross bounding box) with the dimensions each of them changes. */
export function boardEdges(board: Board): BoardEdge[] {
  const { min, max } = boardBounds(board)
  const wAxis = dimensionAxis(board.orientation, 'width')
  const hAxis = dimensionAxis(board.orientation, 'height')
  const tAxis = dimensionAxis(board.orientation, 'thickness')
  const coord = (axis: Axis3, side: 0 | 1) => (side ? max[axis] : min[axis])
  const point = (fixed: [Axis3, 0 | 1][], along: Axis3, end: 0 | 1): Vec3 => {
    const p: Vec3 = [0, 0, 0]
    for (const [axis, side] of fixed) p[axis] = coord(axis, side)
    p[along] = coord(along, end)
    return p
  }
  const edges: BoardEdge[] = []
  const sides = [0, 1] as const
  // along the height → width
  for (const sw of sides)
    for (const st of sides) {
      const fixed: [Axis3, 0 | 1][] = [[wAxis, sw], [tAxis, st]]
      edges.push({ id: `width:${sw}|t:${st}`, a: point(fixed, hAxis, 0), b: point(fixed, hAxis, 1), sides: [{ key: 'width', axis: wAxis, side: sw }] })
    }
  // along the width → height
  for (const sh of sides)
    for (const st of sides) {
      const fixed: [Axis3, 0 | 1][] = [[hAxis, sh], [tAxis, st]]
      edges.push({ id: `height:${sh}|t:${st}`, a: point(fixed, wAxis, 0), b: point(fixed, wAxis, 1), sides: [{ key: 'height', axis: hAxis, side: sh }] })
    }
  // along the thickness → corner (width + height)
  for (const sw of sides)
    for (const sh of sides) {
      const fixed: [Axis3, 0 | 1][] = [[wAxis, sw], [hAxis, sh]]
      edges.push({
        id: `width:${sw}|height:${sh}`,
        a: point(fixed, tAxis, 0),
        b: point(fixed, tAxis, 1),
        sides: [
          { key: 'width', axis: wAxis, side: sw },
          { key: 'height', axis: hAxis, side: sh },
        ],
      })
    }
  return edges
}

/**
 * Board `start` resized by moving the faces of `sides` by `delta` [mm, per world axis, + = along the axis].
 * Result rounded to `step` mm, clamped to ≥ 1 mm and to the furniture.
 */
export function resizeBoard(start: Board, sides: ResizeSide[], delta: Vec3, furniture: Furniture, step = 1): Board {
  const { min, max } = boardBounds(start)
  const F = furnitureSize(furniture)
  const round = (v: number) => Math.round(v / step) * step
  const position = { ...start.position }
  const axes = ['x', 'y', 'z'] as const
  const result: Board = { ...start, position }
  for (const s of sides) {
    const lo = min[s.axis]
    const hi = max[s.axis]
    if (s.side === 1) {
      const newMax = Math.min(F[s.axis], Math.max(lo + 1, round(hi + delta[s.axis])))
      result[s.key] = Number((newMax - lo).toFixed(3))
    } else {
      const newMin = Math.max(0, Math.min(hi - 1, round(lo + delta[s.axis])))
      result[s.key] = Number((hi - newMin).toFixed(3))
      position[axes[s.axis]] = Number(newMin.toFixed(3))
    }
  }
  return result
}

export const RESIZE_LABELS: Record<ResizeKey, string> = { width: 'Szerokość', height: 'Wysokość' }
