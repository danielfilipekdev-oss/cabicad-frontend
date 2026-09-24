import { Constraint, Expression, Operator, Solver, Strength, Variable } from '@lume/kiwi'
import { furnitureSize, type Furniture } from '../furniture/furniture.ts'
import { boardBounds, boardSizeMm, dimensionAxis, type Board, type BoardDimension } from '../boards/board.ts'
import {
  AXIS_FACES,
  FACE_INFO,
  MIN_BOARD_SIZE,
  centeredPairs,
  centeredUnit,
  isAnchorValid,
  offsetDirection,
  twoSidedParts,
  twoSidedProblem,
  violatedAnchors,
  type AnchorConstraint,
  type Axis,
} from './constraints.ts'

/**
 * Cassowary solver of the board layout (kiwi = fast JS implementation of Cassowary).
 *
 * Variables: for every board and axis the min and max face coordinate (6 per board).
 * Constraint strengths (strongest first):
 *   required  – every size ≥ 1 mm, size along the thickness axis = thickness
 *   contain   – the board stays inside the furniture (0 ≤ min, max ≤ furniture size)
 *   strong    – anchors (wiązania) added by the user
 *   medium    – the other two sizes keep their current value (they give way to anchors on both sides
 *               → the board stretches between them, like 0dp / match_constraint); a board with no anchor
 *               of its own on the axis keeps its size harder (SIZE_FREE), so resizing an independent
 *               board stretches the boards hanging on it, not the other way round
 *   edited    – the board the user has just moved / resized (`pinnedId`) keeps what was set, so the
 *               boards hanging on it follow instead of pulling it back
 *   weak      – "stay": the board keeps its current position if nothing says otherwise; a board with
 *               no anchor of its own on the axis stays a bit harder (STAY_FREE) than a dependent board,
 *               so an anchor pulls the dependent board, never the target
 * Conflicting constraints do not throw – the weaker ones are sacrificed and reported as violated.
 *
 * A two-sided joint (`twoSided`) adds a second equation: the gap between the two boards is centred at
 * `bias` of their common span, so both of them give way (like a chain in ConstraintLayout).
 *
 * A board joined on both flat sides (the faces of its thickness axis) cannot stretch, so the two anchors
 * become ONE constraint putting it in the middle between the two planes (`centeredPairs`).
 *
 * Offsets are typed as a distance away from the target plane (`offsetDirection`), in mm or in percent
 * of the free space. A percent offset stays linear – it depends on the target plane, the furniture size
 * and the board size, all of which are variables / constants of the solver – so the board keeps its
 * relative place when the furniture or the target board changes.
 */

const CONTAIN = Strength.create(500, 0, 0)
const STAY_DEPENDENT = Strength.weak
const STAY_FREE = Strength.create(0, 0, 10)
const SIZE_DEPENDENT = Strength.medium
const SIZE_FREE = Strength.create(0, 10, 0)
/** The board just edited by the user – stronger than the anchors, weaker than the furniture walls. */
const EDITED = Strength.create(200, 0, 0)
const MIN_SIZE = MIN_BOARD_SIZE

export interface LayoutResult {
  /** Boards with the solved positions / dimensions (unchanged boards keep their object identity). */
  boards: Board[]
  /** Ids of anchors that could not be satisfied (conflicting or invalid). */
  violated: string[]
}

const roundMm = (v: number) => Number(v.toFixed(3)) || 0

/**
 * @param pinnedId board the user has just edited – its position and size are kept ABOVE the anchors, so
 *   the edit wins and the boards hanging on it follow (instead of pulling it back). If a dependent board
 *   is held somewhere else too, its anchor is reported as unsatisfied.
 */
export function solveLayout(
  furniture: Furniture,
  boards: Board[],
  constraints: AnchorConstraint[],
  pinnedId?: string,
): LayoutResult {
  if (constraints.length === 0) return { boards, violated: [] }

  const solver = new Solver()
  const F = furnitureSize(furniture)
  const vars = new Map<string, [Variable, Variable][]>()
  const add = (lhs: Expression | Variable, op: Operator, rhs: Expression | Variable | number, strength: number) => {
    try {
      solver.addConstraint(new Constraint(lhs, op, rhs, strength))
    } catch {
      // an unsatisfiable required constraint – ignore it, the result is validated afterwards
    }
  }

  const valid = constraints.filter((c) => isAnchorValid(c, boards))
  /** Board has its own anchor on the axis (it is the dependent side of a joint there). */
  const twoSided = valid.filter((c) => c.twoSided && !twoSidedProblem(c, boards))
  const dependentOn = (id: string, axis: number) =>
    valid.some((c) => c.board === id && FACE_INFO[c.face][0] === axis) ||
    twoSided.some((c) => c.target.kind === 'board' && c.target.id === id && FACE_INFO[c.face][0] === axis)

  for (const b of boards) {
    const v: [Variable, Variable][] = [0, 1, 2].map((i) => [new Variable(`${b.name}.min${i}`), new Variable(`${b.name}.max${i}`)])
    vars.set(b.id, v)
    const bounds = boardBounds(b)
    const size = boardSizeMm(b)
    const tAxis = dimensionAxis(b.orientation, 'thickness')
    for (let i = 0; i < 3; i++) {
      const [lo, hi] = v[i]
      const len = new Expression(hi).minus(lo)
      add(len, Operator.Ge, MIN_SIZE, Strength.required)
      if (i === tAxis) add(len, Operator.Eq, b.thickness, Strength.required)
      else add(len, Operator.Eq, size[i], b.id === pinnedId ? EDITED : dependentOn(b.id, i) ? SIZE_DEPENDENT : SIZE_FREE)
      add(lo, Operator.Ge, 0, CONTAIN)
      add(hi, Operator.Le, F[i], CONTAIN)
      add(lo, Operator.Eq, bounds.min[i], b.id === pinnedId ? EDITED : dependentOn(b.id, i) ? STAY_DEPENDENT : STAY_FREE)
    }
  }

  /** Board has anchors on both faces of the axis (stretched between them). */
  const stretched = (id: string, axis: number) => {
    const [loFace, hiFace] = AXIS_FACES[axis as Axis]
    return valid.some((c) => c.board === id && c.face === loFace) && valid.some((c) => c.board === id && c.face === hiFace)
  }

  // the target plane of an anchor: a furniture wall or a face of another board
  const onePlane = (target: AnchorConstraint['target'], face: AnchorConstraint['targetFace'], axis: number) => {
    const [, tSide] = FACE_INFO[face]
    return target.kind === 'furniture' ? new Expression(tSide ? F[axis] : 0) : new Expression(vars.get(target.id)![axis][tSide])
  }
  // …or the middle between two target faces (`target2` – e.g. the leaves of a double front)
  const planeExpr = (c: AnchorConstraint, axis: number) =>
    c.target2 && c.targetFace2
      ? onePlane(c.target, c.targetFace, axis).plus(onePlane(c.target2, c.targetFace2, axis)).multiply(0.5)
      : onePlane(c.target, c.targetFace, axis)

  // where the face gets at 100 % of the free space – the same as `freeLimitValue`, as an expression
  const limitExpr = (c: AnchorConstraint, axis: number) => {
    const [, side] = FACE_INFO[c.face]
    const [lo, hi] = vars.get(c.board)![axis]
    const L = stretched(c.board, axis) ? new Expression(0) : new Expression(hi).minus(lo)
    if (offsetDirection(c) > 0) return side === 0 ? new Expression(F[axis]).minus(L) : new Expression(F[axis])
    return side === 1 ? L : new Expression(0)
  }

  // where the anchor wants the face: plane + offset (mm along the offset direction / % of the free space)
  const targetExpr = (c: AnchorConstraint, axis: number) => {
    const plane = planeExpr(c, axis)
    if (c.unit === '%') return plane.plus(limitExpr(c, axis).minus(plane).multiply(c.offset / 100))
    return plane.plus(offsetDirection(c) * c.offset)
  }

  // boards centred between two planes A (min) and B (max):
  //   mm: min + max = A + B + 2 · shift
  //   % : min = A + p · (B − A − thickness)  →  min + max = 2A + 2p · (B − A − t) + t
  const pairs = centeredPairs(constraints, boards)
  const centered = new Set(pairs.flatMap((p) => [p.min.id, p.max.id]))
  for (const pair of pairs) {
    const [lo, hi] = vars.get(pair.boardId)![pair.axis]
    const b = boards.find((o) => o.id === pair.boardId)!
    const t = boardSizeMm(b)[pair.axis]
    const A = planeExpr(pair.min, pair.axis)
    const B = planeExpr(pair.max, pair.axis)
    const wanted =
      centeredUnit(pair) === '%'
        ? A.multiply(2).plus(B.minus(A).minus(t).multiply((2 * pair.min.offset) / 100)).plus(t)
        : targetExpr(pair.min, pair.axis).plus(targetExpr(pair.max, pair.axis))
    add(new Expression(lo).plus(hi), Operator.Eq, wanted, Strength.strong)
  }

  for (const c of valid) {
    if (centered.has(c.id)) continue
    const [axis, side] = FACE_INFO[c.face]
    add(vars.get(c.board)![axis][side], Operator.Eq, targetExpr(c, axis), Strength.strong)
  }

  // two-sided joints: besides the gap (above), the middle of the gap sits at `bias` of the span between
  // the far faces – both boards give way:  (low.max + high.min) / 2 = low.min + bias · (high.max − low.min)
  for (const c of twoSided) {
    const parts = twoSidedParts(c)!
    const [lMin, lMax] = vars.get(parts.low)![parts.axis]
    const [hMin, hMax] = vars.get(parts.high)![parts.axis]
    const bias = c.bias ?? 0.5
    add(
      new Expression(lMax).plus(hMin).multiply(0.5),
      Operator.Eq,
      new Expression(lMin).plus(new Expression(hMax).minus(lMin).multiply(bias)),
      Strength.strong,
    )
  }

  solver.updateVariables()

  const solved = boards.map((b) => {
    const v = vars.get(b.id)!
    const lo = v.map(([l]) => roundMm(l.value()))
    const len = v.map(([l, h]) => roundMm(h.value() - l.value()))
    const dim = (key: BoardDimension) => len[dimensionAxis(b.orientation, key)]
    const next: Board = {
      ...b,
      width: dim('width'),
      height: dim('height'),
      position: { x: lo[0], y: lo[1], z: lo[2] },
    }
    const same =
      next.width === b.width &&
      next.height === b.height &&
      next.position.x === b.position.x &&
      next.position.y === b.position.y &&
      next.position.z === b.position.z
    return same ? b : next
  })

  return { boards: solved, violated: violatedAnchors(constraints, solved, furniture) }
}
