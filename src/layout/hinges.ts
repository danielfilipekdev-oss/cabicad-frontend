import { furnitureSize, type Furniture } from '../furniture/furniture.ts'
import { boardBounds, dimensionAxis, type Board } from '../boards/board.ts'
import { FACE_INFO, type AnchorConstraint, type Axis } from './constraints.ts'

/**
 * Hinges (zawiasy) – a MODE of an ordinary joint (`AnchorConstraint.hinge`), not a kind of board: any
 * board can be opened (a door, a flap, an opening top …) when one of its joints is a hinge.
 *
 * A hinge joint is on an EDGE face of the board (not on its flat sides) and joins it to a PERPENDICULAR
 * board (e.g. the left edge of a door → the side of the carcass) or to a furniture wall. The board then
 * turns around that edge: the rotation axis runs along the edge (perpendicular to both the face and the
 * board thickness), on the OUTER flat side of the board (the side away from the middle of the furniture),
 * and the free edge swings out of the furniture. The layout (and the joints) do not change – the turn is
 * shown in the scene only (`scene/HingedGroup.tsx`). One hinge joint per board (`otherHinge`).
 */

export interface BoardHinge {
  /** The hinge joint. */
  jointId: string
  /** A point on the rotation axis [mm]. */
  pivot: [number, number, number]
  /** Rotation axis. */
  axis: 'x' | 'y' | 'z'
  /** Signed opening angle [rad] – the free edge swings out of the furniture. */
  angle: number
}

/** Doors (vertical axis) open by 100°, flaps / tops by 85°. */
const DOOR_ANGLE = (100 * Math.PI) / 180
const FLAP_ANGLE = (85 * Math.PI) / 180
const AXIS_NAMES = ['x', 'y', 'z'] as const

/** Why the joint cannot be a hinge (null = it can). */
export function hingeProblem(c: Pick<AnchorConstraint, 'board' | 'face' | 'target'>, boards: Board[]): string | null {
  const board = boards.find((b) => b.id === c.board)
  if (!board) return 'Brak płyty.'
  const t = dimensionAxis(board.orientation, 'thickness')
  if (FACE_INFO[c.face][0] === t) return 'Zawias jest na krawędzi płyty – nie na jej płaskiej stronie.'
  if (c.target.kind === 'board') {
    const id = c.target.id
    const other = boards.find((b) => b.id === id)
    if (!other) return 'Brak płyty docelowej.'
    if (dimensionAxis(other.orientation, 'thickness') === t) return 'Zawias łączy płytę z płytą prostopadłą (albo ze ścianą mebla).'
  }
  return null
}

/**
 * A board turns around ONE axis, so it has at most one hinge joint: the other hinge joint of the same
 * board, if there is one (a second hinge is then blocked until that one is switched off).
 */
export function otherHinge(c: Pick<AnchorConstraint, 'id' | 'board'>, constraints: AnchorConstraint[]): AnchorConstraint | null {
  return constraints.find((o) => o.hinge && o.board === c.board && o.id !== c.id) ?? null
}

/** Levi-Civita symbol of three different axes (+1 for x→y→z order, −1 otherwise). */
const levi = (i: number, j: number, k: number) => ((j - i + 3) % 3 === 1 && (k - j + 3) % 3 === 1 ? 1 : -1)

/** Hinge of one board from one hinge joint. */
export function hingeOf(c: AnchorConstraint, board: Board, furniture: Furniture): BoardHinge {
  const [a, side] = FACE_INFO[c.face]
  const t = dimensionAxis(board.orientation, 'thickness')
  const r = (3 - a - t) as Axis
  const b = boardBounds(board)
  const F = furnitureSize(furniture)
  // outer flat side: away from the middle of the furniture (a tie → the positive side: front / top / right)
  const centre = (b.min[t] + b.max[t]) / 2
  const out = centre >= F[t] / 2 ? 1 : -1
  const pivot: [number, number, number] = [0, 0, 0]
  pivot[a] = side ? b.max[a] : b.min[a]
  pivot[t] = out > 0 ? b.max[t] : b.min[t]
  pivot[r] = b.min[r]
  // the board lies on the −a side of a max-face hinge (+a of a min-face one); rotating it by θ around r
  // moves its free edge along t by sign θ · d · ε(r, a, t) – chosen so it goes out of the furniture
  const d = side ? -1 : 1
  const sign = out * d * levi(r, a, t)
  const angle = (r === 1 ? DOOR_ANGLE : FLAP_ANGLE) * sign
  return { jointId: c.id, pivot, axis: AXIS_NAMES[r], angle }
}

/** Boards that can be opened: board id → its hinge (the first valid hinge joint of the board). */
export function boardHinges(constraints: AnchorConstraint[], boards: Board[], furniture: Furniture): Map<string, BoardHinge> {
  const map = new Map<string, BoardHinge>()
  for (const c of constraints) {
    if (!c.hinge || map.has(c.board) || hingeProblem(c, boards)) continue
    const board = boards.find((b) => b.id === c.board)!
    map.set(c.board, hingeOf(c, board, furniture))
  }
  return map
}
