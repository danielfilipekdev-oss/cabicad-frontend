import { describe, expect, it } from 'vitest'
import { DEFAULT_BOARD_PARAMS, boardBounds, type Board, type BoardParams } from '../boards/board.ts'
import type { Furniture } from '../furniture/furniture.ts'
import {
  anchorRange,
  boardLocks,
  createAnchor,
  rederiveOffsets,
  setTwoSided,
  twoSidedProblem,
  violatedAnchors,
  type AnchorConstraint,
} from './constraints.ts'
import { solveLayout } from './solver.ts'
import { boardHinges, hingeProblem, otherHinge } from './hinges.ts'

const F: Furniture = { width: 800, height: 720, depth: 560 }

function board(id: string, p: Partial<BoardParams>, x: number, y: number, z: number): Board {
  return { ...DEFAULT_BOARD_PARAMS, thickness: 18, ...p, id, name: id, position: { x, y, z } }
}
const byId = (bs: Board[], id: string) => bs.find((b) => b.id === id)!
const xs = (b: Board) => [boardBounds(b).min[0], boardBounds(b).max[0]]

/** Two leaves made by hand (like the picture): each on its furniture wall, a joint between them. */
function leaves(): { boards: Board[]; constraints: AnchorConstraint[] } {
  const boards = [
    board('L', { orientation: 'vertical', width: 376, height: 720 }, 0, 0, 542),
    board('R', { orientation: 'vertical', width: 376, height: 720 }, 424, 0, 542),
  ]
  const constraints = [
    createAnchor(boards[0], 'left', { kind: 'furniture' }, 'left', boards, F),
    createAnchor(boards[1], 'right', { kind: 'furniture' }, 'right', boards, F),
    createAnchor(boards[0], 'right', { kind: 'board', id: 'R' }, 'left', boards, F),
  ]
  return { boards, constraints }
}

describe('two-sided joint (obustronne)', () => {
  it('a one-sided joint moves only one leaf – a two-sided one shares the change', () => {
    const { boards, constraints } = leaves()
    const mid = constraints[2]
    expect(mid.offset).toBe(48)
    // one-sided: a smaller gap only widens the left leaf
    let out = solveLayout(F, boards, constraints.map((c) => (c.id === mid.id ? { ...c, offset: 8 } : c)))
    expect(xs(byId(out.boards, 'L'))).toEqual([0, 416])
    expect(xs(byId(out.boards, 'R'))).toEqual([424, 800])
    // two-sided: both leaves give way by half
    const two = setTwoSided(constraints, mid.id, true, boards)
    expect(two[2]).toMatchObject({ twoSided: true, bias: 0.5, offset: 48 })
    out = solveLayout(F, boards, two.map((c) => (c.id === mid.id ? { ...c, offset: 8 } : c)))
    expect(out.violated).toEqual([])
    expect(xs(byId(out.boards, 'L'))).toEqual([0, 396])
    expect(xs(byId(out.boards, 'R'))).toEqual([404, 800])
    // and both follow the furniture
    const F1 = { ...F, width: 1000 }
    out = solveLayout(F1, out.boards, two.map((c) => (c.id === mid.id ? { ...c, offset: 8 } : c)))
    expect(xs(byId(out.boards, 'L'))).toEqual([0, 496])
    expect(xs(byId(out.boards, 'R'))).toEqual([504, 1000])
  })

  it('bias keeps an uneven split; editing a leaf re-derives gap and bias', () => {
    const { boards, constraints } = leaves()
    const mid = constraints[2]
    const two = setTwoSided(constraints, mid.id, true, boards).map((c) => (c.id === mid.id ? { ...c, bias: 0.25 } : c))
    let out = solveLayout(F, boards, two)
    expect(xs(byId(out.boards, 'L'))).toEqual([0, 176])
    expect(xs(byId(out.boards, 'R'))).toEqual([224, 800])
    // the right leaf's left face is held by the joint made on the left leaf
    expect(boardLocks(two, 'R').faces.has('left')).toBe(true)
    // the right leaf made wider by hand → the joint takes the new gap / split, nothing jumps back
    const prev = byId(out.boards, 'R')
    const wider: Board = { ...prev, width: prev.width + 24, position: { ...prev.position, x: prev.position.x - 24 } }
    const cs = rederiveOffsets(two, prev, wider, out.boards, F)
    const joint = cs.find((c) => c.id === mid.id)!
    expect(joint.offset).toBe(24)
    out = solveLayout(F, out.boards.map((b) => (b.id === 'R' ? wider : b)), cs)
    expect(violatedAnchors(cs, out.boards, F)).toEqual([])
    expect(xs(byId(out.boards, 'R'))).toEqual([200, 800])
    // range of the gap: 0 … span − 2 mm
    expect(anchorRange(joint, cs, out.boards, F)).toEqual({ min: 0, max: 798 })
  })

  it('only between two boards facing each other, not along a thickness', () => {
    const { boards } = leaves()
    expect(twoSidedProblem({ board: 'L', face: 'right', target: { kind: 'board', id: 'R' }, targetFace: 'left' }, boards)).toBeNull()
    expect(twoSidedProblem({ board: 'L', face: 'right', target: { kind: 'furniture' }, targetFace: 'right' }, boards)).toMatch(/dwie płyty/)
    expect(twoSidedProblem({ board: 'L', face: 'right', target: { kind: 'board', id: 'R' }, targetFace: 'right' }, boards)).toMatch(/zwrócone/)
    expect(twoSidedProblem({ board: 'L', face: 'front', target: { kind: 'board', id: 'R' }, targetFace: 'back' }, boards)).toMatch(/grubości/)
  })
})

describe('hinge mode of a joint (zawias) – any board', () => {
  it('an opening top: a hinge on its back joint turns it up around the back edge', () => {
    const top = board('top', { orientation: 'horizontal', width: 800, height: 560 }, 0, 702, 0)
    const back = board('back', { orientation: 'vertical', width: 800, height: 702 }, 0, 0, 0)
    const boards = [top, back]
    const hinge: AnchorConstraint = { ...createAnchor(top, 'back', { kind: 'furniture' }, 'back', boards, F), hinge: true }
    const h = boardHinges([hinge], boards, F).get('top')!
    expect(h.axis).toBe('x')
    expect(h.pivot).toEqual([0, 720, 0])
    // rotating around X by the angle lifts the front edge (+Z of the pivot) up (+Y)
    expect(-Math.sin(h.angle)).toBeGreaterThan(0)
  })

  it('a door made by hand: hinge on the left edge joined to a side, it swings out to the front', () => {
    const side = board('side', { orientation: 'side', width: 560, height: 720 }, 0, 0, 0)
    const door = board('door', { orientation: 'vertical', width: 400, height: 720 }, 0, 0, 560)
    const boards = [side, door]
    const c: AnchorConstraint = { ...createAnchor(door, 'left', { kind: 'board', id: 'side' }, 'left', boards, F), hinge: true }
    const h = boardHinges([c], boards, F).get('door')!
    expect(h).toMatchObject({ axis: 'y', pivot: [0, 0, 578] })
    expect(h.angle).toBeLessThan(0) // around Y, the right edge comes forward
  })

  it('not on a flat side, not to a parallel board', () => {
    const a = board('a', { orientation: 'vertical', width: 400, height: 720 }, 0, 0, 500)
    const b = board('b', { orientation: 'vertical', width: 400, height: 720 }, 400, 0, 500)
    expect(hingeProblem({ board: 'a', face: 'front', target: { kind: 'furniture' } }, [a, b])).toMatch(/krawędzi/)
    expect(hingeProblem({ board: 'a', face: 'right', target: { kind: 'board', id: 'b' } }, [a, b])).toMatch(/prostopadłą/)
    expect(hingeProblem({ board: 'a', face: 'left', target: { kind: 'furniture' } }, [a, b])).toBeNull()
  })

  it('one hinge per board – a second one is blocked', () => {
    const door = board('door', { orientation: 'vertical', width: 400, height: 720 }, 0, 0, 542)
    const left: AnchorConstraint = { ...createAnchor(door, 'left', { kind: 'furniture' }, 'left', [door], F), hinge: true }
    const right = createAnchor(door, 'right', { kind: 'furniture' }, 'right', [door], F)
    expect(otherHinge(right, [left, right])?.id).toBe(left.id)
    expect(otherHinge(left, [left, right])).toBeNull()
  })
})
