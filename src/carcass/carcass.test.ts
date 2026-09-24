import { describe, expect, it } from 'vitest'
import type { Furniture } from '../furniture/furniture.ts'
import type { Board } from '../boards/board.ts'
import { boardBounds, boundsOverlap } from '../boards/board.ts'
import { removeAnchorsWithRestore, upsertAnchor, createPullingAnchor, violatedAnchors, type AnchorConstraint } from '../layout/constraints.ts'
import { solveLayout } from '../layout/solver.ts'
import {
  CARCASS_ROLES,
  DEFAULT_CARCASS_RELATIONS,
  addCarcassBoard,
  applyCarcass,
  covers,
  findRoleBoard,
  missingCarcassAnchors,
  setCovers,
  type CarcassRelations,
  type CarcassRole,
  type CarcassState,
} from './carcass.ts'

const F: Furniture = { width: 800, height: 720, depth: 560 }
const T = 18

function build(roles: CarcassRole[], relations: CarcassRelations = DEFAULT_CARCASS_RELATIONS, f: Furniture = F): CarcassState {
  let s: CarcassState = { boards: [], constraints: [] }
  for (const r of roles) s = addCarcassBoard(f, s.boards, s.constraints, relations, r, { thickness: T })
  return s
}

const role = (s: { boards: Board[] }, r: CarcassRole) => findRoleBoard(s.boards, r)!
const box = (b: Board) => {
  const { min, max } = boardBounds(b)
  return [...min, ...max]
}

function expectNoCollisions(boards: Board[]) {
  for (let i = 0; i < boards.length; i++)
    for (let j = i + 1; j < boards.length; j++) expect(boundsOverlap(boardBounds(boards[i]), boardBounds(boards[j]))).toBe(false)
}

describe('carcass – defaults', () => {
  it('builds the default carcass in any order with the relations from the spec', () => {
    const orders: CarcassRole[][] = [
      ['top', 'bottom', 'left', 'right', 'back'],
      ['back', 'right', 'left', 'bottom', 'top'],
      ['left', 'back', 'top', 'right', 'bottom'],
    ]
    for (const order of orders) {
      const s = build(order)
      expect(violatedAnchors(s.constraints, s.boards, F)).toEqual([])
      // dach – przykrywa boki i plecy: full width and depth at the top
      expect(box(role(s, 'top'))).toEqual([0, 702, 0, 800, 720, 560])
      // boki – pod dachem, przykrywają podłogę i plecy: from the floor to the top, full depth
      expect(box(role(s, 'left'))).toEqual([0, 0, 0, 18, 702, 560])
      expect(box(role(s, 'right'))).toEqual([782, 0, 0, 800, 702, 560])
      // podłoga – między bokami, przykrywa plecy
      expect(box(role(s, 'bottom'))).toEqual([18, 0, 0, 782, 18, 560])
      // plecy – między bokami, pod dachem, nad podłogą
      expect(box(role(s, 'back'))).toEqual([18, 18, 0, 782, 702, 18])
      expectNoCollisions(s.boards)
    }
  })

  it('a role is unique – a second top is not added', () => {
    const s = build(['top'])
    const again = addCarcassBoard(F, s.boards, s.constraints, DEFAULT_CARCASS_RELATIONS, 'top', { thickness: 25 })
    expect(again.boards).toHaveLength(1)
    expect(again).toEqual(s)
  })

  it('a lone board fills its wall', () => {
    const s = build(['back'])
    expect(box(role(s, 'back'))).toEqual([0, 0, 0, 800, 720, 18])
    expect(s.constraints.every((c) => c.preset)).toBe(true)
  })

  it('names the boards after their role', () => {
    const s = build(CARCASS_ROLES)
    expect(s.boards.map((b) => b.name).sort()).toEqual(['Dach', 'Lewy bok', 'Plecy', 'Podłoga', 'Prawy bok'])
  })
})

describe('carcass – relations', () => {
  it('top between the sides, sides full height', () => {
    let rel = setCovers(DEFAULT_CARCASS_RELATIONS, 'left', 'top')
    rel = setCovers(rel, 'right', 'top')
    const s = build(CARCASS_ROLES, rel)
    expect(box(role(s, 'top'))).toEqual([18, 702, 0, 782, 720, 560])
    expect(box(role(s, 'left'))).toEqual([0, 0, 0, 18, 720, 560])
    expectNoCollisions(s.boards)
  })

  it('bottom under the sides (sides stand on it)', () => {
    let rel = setCovers(DEFAULT_CARCASS_RELATIONS, 'bottom', 'left')
    rel = setCovers(rel, 'bottom', 'right')
    const s = build(CARCASS_ROLES, rel)
    expect(box(role(s, 'bottom'))).toEqual([0, 0, 0, 800, 18, 560])
    expect(box(role(s, 'left'))).toEqual([0, 18, 0, 18, 702, 560])
    expectNoCollisions(s.boards)
  })

  it('back overlaid on everything – the others stand in front of it', () => {
    let rel = DEFAULT_CARCASS_RELATIONS
    for (const r of ['left', 'right', 'top', 'bottom'] as CarcassRole[]) rel = setCovers(rel, 'back', r)
    const s = build(CARCASS_ROLES, rel)
    expect(box(role(s, 'back'))).toEqual([0, 0, 0, 800, 720, 18])
    expect(box(role(s, 'left'))).toEqual([0, 0, 18, 18, 702, 560])
    expect(box(role(s, 'top'))).toEqual([0, 702, 18, 800, 720, 560])
    expect(box(role(s, 'bottom'))).toEqual([18, 0, 18, 782, 18, 560])
    expectNoCollisions(s.boards)
  })

  it('changing a relation later re-places both boards', () => {
    const s = build(CARCASS_ROLES)
    const rel = setCovers(DEFAULT_CARCASS_RELATIONS, 'left', 'top')
    expect(covers(rel, 'left', 'top')).toBe(true)
    const next = applyCarcass(F, s.boards, s.constraints, rel)
    expect(box(role(next, 'left'))).toEqual([0, 0, 0, 18, 720, 560])
    expect(box(role(next, 'top'))).toEqual([18, 702, 0, 800, 720, 560])
    expect(violatedAnchors(next.constraints, next.boards, F)).toEqual([])
    expectNoCollisions(next.boards)
  })

  it('every combination of the 8 relations is collision free and satisfied', () => {
    const pairs = Object.keys(DEFAULT_CARCASS_RELATIONS) as (keyof CarcassRelations)[]
    for (let mask = 0; mask < 1 << pairs.length; mask++) {
      const rel = { ...DEFAULT_CARCASS_RELATIONS }
      pairs.forEach((p, i) => {
        const [a, b] = p.split('-') as [CarcassRole, CarcassRole]
        rel[p] = mask & (1 << i) ? a : b
      })
      const s = build(CARCASS_ROLES, rel)
      expect(violatedAnchors(s.constraints, s.boards, F)).toEqual([])
      expectNoCollisions(s.boards)
    }
  })
})

describe('carcass – on top of the core', () => {
  it('follows the furniture size through the solver', () => {
    const s = build(CARCASS_ROLES)
    const F1: Furniture = { width: 1000, height: 900, depth: 600 }
    const out = solveLayout(F1, s.boards, s.constraints)
    expect(out.violated).toEqual([])
    expect(box(role(out, 'top'))).toEqual([0, 882, 0, 1000, 900, 600])
    expect(box(role(out, 'right'))).toEqual([982, 0, 0, 1000, 882, 600])
    expect(box(role(out, 'back'))).toEqual([18, 18, 0, 982, 882, 18])
  })

  it('a thicker side moves the boards between the sides', () => {
    const s = build(CARCASS_ROLES)
    const left = role(s, 'left')
    const boards = s.boards.map((b) => (b.id === left.id ? { ...b, thickness: 25 } : b))
    const out = solveLayout(F, boards, s.constraints, left.id)
    expect(out.violated).toEqual([])
    expect(box(role(out, 'bottom'))).toEqual([25, 0, 0, 782, 18, 560])
    expect(box(role(out, 'back'))).toEqual([25, 18, 0, 782, 702, 18])
  })

  it('keeps an offset changed by the user when the relations are synced again', () => {
    const s = build(CARCASS_ROLES)
    const back = role(s, 'back')
    // recess the back 10 mm from the back wall
    const cs = s.constraints.map((c) => (c.board === back.id && c.face === 'back' ? { ...c, offset: 10 } : c))
    const next = applyCarcass(F, s.boards, cs, DEFAULT_CARCASS_RELATIONS)
    expect(role(next, 'back').position.z).toBe(10)
    const again = applyCarcass(F, next.boards, next.constraints, setCovers(DEFAULT_CARCASS_RELATIONS, 'left', 'top'))
    expect(role(again, 'back').position.z).toBe(10)
  })

  it('a joint made by hand on a carcass face wins over the carcass joint', () => {
    const s = build(['left', 'top'])
    const top = role(s, 'top')
    // top front face pulled to the furniture front by hand, then offset 20 → top set back
    const manual: AnchorConstraint = { ...createPullingAnchor(top, 'front', { kind: 'furniture' }, 'front', s.boards, F), offset: 20 }
    const cs = upsertAnchor(s.constraints, manual)
    const next = applyCarcass(F, s.boards, cs, DEFAULT_CARCASS_RELATIONS)
    expect(next.constraints.find((c) => c.board === top.id && c.face === 'front')!.id).toBe(manual.id)
    expect(boardBounds(role(next, 'top')).max[2]).toBe(540)
  })

  it('removing a carcass board gives its place back to the neighbours', () => {
    const s = build(CARCASS_ROLES)
    const top = role(s, 'top')
    const ids = s.constraints.filter((c) => c.board === top.id || (c.target.kind === 'board' && c.target.id === top.id)).map((c) => c.id)
    const removed = removeAnchorsWithRestore(s.constraints, ids, s.boards)
    const next = applyCarcass(F, removed.boards.filter((b) => b.id !== top.id), removed.constraints, DEFAULT_CARCASS_RELATIONS)
    expect(box(role(next, 'left'))).toEqual([0, 0, 0, 18, 720, 560])
    expect(box(role(next, 'back'))).toEqual([18, 18, 0, 782, 720, 18])
    // and it can be added again
    const back = addCarcassBoard(F, next.boards, next.constraints, DEFAULT_CARCASS_RELATIONS, 'top', { thickness: T })
    expect(box(role(back, 'left'))).toEqual([0, 0, 0, 18, 702, 560])
  })

  it('reports and restores joints removed with "Usuń wiązania"', () => {
    const s = build(CARCASS_ROLES)
    const cleared = removeAnchorsWithRestore(s.constraints, s.constraints.map((c) => c.id), s.boards)
    expect(missingCarcassAnchors(cleared.constraints, cleared.boards, DEFAULT_CARCASS_RELATIONS)).toBe(s.constraints.length)
    const restored = applyCarcass(F, cleared.boards, cleared.constraints, DEFAULT_CARCASS_RELATIONS)
    expect(missingCarcassAnchors(restored.constraints, restored.boards, DEFAULT_CARCASS_RELATIONS)).toBe(0)
  })

  it('free boards and their joints are left alone', () => {
    const s = build(['left', 'right'])
    const shelf: Board = {
      ...role(s, 'left'),
      id: 'shelf',
      name: 'Płyta 1',
      role: undefined,
      orientation: 'horizontal',
      width: 764,
      height: 540,
      position: { x: 18, y: 300, z: 0 },
    }
    const boards = [...s.boards, shelf]
    const cs = [...s.constraints, { ...createPullingAnchor(shelf, 'left', { kind: 'board', id: role(s, 'left').id }, 'right', boards, F) }]
    const next = applyCarcass(F, boards, cs, DEFAULT_CARCASS_RELATIONS)
    expect(next.constraints.filter((c) => c.board === 'shelf')).toHaveLength(1)
    expect(next.boards.find((b) => b.id === 'shelf')!.position).toEqual({ x: 18, y: 300, z: 0 })
  })
})
