import { describe, expect, it } from 'vitest'
import type { Furniture } from '../furniture/furniture.ts'
import { boardBounds, boundsOverlap, type Board } from '../boards/board.ts'
import { DEFAULT_FINISH } from '../boards/finish.ts'
import { violatedAnchors } from '../layout/constraints.ts'
import { solveLayout } from '../layout/solver.ts'
import { CARCASS_ROLES, DEFAULT_CARCASS_RELATIONS, createCarcassBoard, findRoleBoard } from '../carcass/carcass.ts'
import { addDivider, createRootSection, dividerFrontOffset, removeDividerFromTree, type Section } from '../sections/sections.ts'
import { applyStructure, pruneStructure } from '../structure.ts'
import { boardHinges } from '../layout/hinges.ts'
import {
  addFrontProblem,
  coversOf,
  createFront,
  ctrlPickSection,
  selectionCovers,
  frontOverlaps,
  type Front,
  type FrontOptions,
} from './fronts.ts'

const F: Furniture = { width: 800, height: 720, depth: 560 }
const OPTS: FrontOptions = { mount: 'overlay', opening: 'rtl', gapH: 2, gapV: 2, thickness: 18, finish: DEFAULT_FINISH }

interface State {
  boards: Board[]
  constraints: ReturnType<typeof applyStructure>['constraints']
  sections: Section
  fronts: Front[]
}

const solve = (s: State, f: Furniture = F): State => ({ ...s, ...applyStructure(f, s.boards, s.constraints, DEFAULT_CARCASS_RELATIONS, s.sections, s.fronts) })

function carcass(): State {
  const boards = CARCASS_ROLES.map((r) => createCarcassBoard(r, { thickness: 18 }, F))
  return solve({ boards, constraints: [], sections: createRootSection(), fronts: [] })
}
function shelf(s: State, id = 'root'): State {
  const r = addDivider(s, id, 'shelf', { ...DEFAULT_FINISH, thickness: 18 }, F)
  return solve({ ...s, boards: r.boards, constraints: r.constraints, sections: r.sections })
}
function front(s: State, covers: string[], o: Partial<FrontOptions> = {}): State {
  const r = createFront(s.sections, s.boards, F, covers, { ...OPTS, ...o })!
  return solve({ ...s, boards: [...s.boards, ...r.boards], fronts: [...s.fronts, r.front] })
}
const box = (b: Board) => {
  const { min, max } = boardBounds(b)
  return [...min, ...max]
}
const byId = (s: State, id: string) => s.boards.find((b) => b.id === id)!
const leaves = (s: State, i = s.fronts.length - 1) => s.fronts[i].boards.map((id) => byId(s, id))
function expectClean(s: State) {
  expect(violatedAnchors(s.constraints, s.boards, F)).toEqual([])
  for (let i = 0; i < s.boards.length; i++)
    for (let j = i + 1; j < s.boards.length; j++) expect(boundsOverlap(boardBounds(s.boards[i]), boardBounds(s.boards[j]))).toBe(false)
}

describe('fronts – mounting', () => {
  it('overlay front covers the carcass edges; the carcass and the shelves step back by its thickness', () => {
    let s = shelf(carcass())
    s = front(s, ['root'])
    const [door] = leaves(s)
    // covers the sides / top / bottom fully, 1 mm (half of the 2 mm gap) on every side, at the front of the furniture
    expect(box(door)).toEqual([1, 1, 542, 799, 719, 560])
    expect(boardBounds(findRoleBoard(s.boards, 'left')!).max[2]).toBe(542)
    expect(boardBounds(findRoleBoard(s.boards, 'top')!).max[2]).toBe(542)
    expect(boardBounds(byId(s, s.sections.dividers[0])).max[2]).toBe(537) // 5 mm behind the carcass front
    expectClean(s)
  })

  it('inset front sits in the opening flush with the carcass; the shelves behind it step back', () => {
    let s = shelf(carcass())
    s = front(s, ['root'], { mount: 'inset' })
    const [door] = leaves(s)
    expect(box(door)).toEqual([19, 19, 542, 781, 701, 560])
    expect(boardBounds(findRoleBoard(s.boards, 'left')!).max[2]).toBe(560)
    expect(boardBounds(byId(s, s.sections.dividers[0])).max[2]).toBe(537)
    expectClean(s)
  })

  it('double front – two leaves meeting in the middle with the gap between them', () => {
    const s = front(carcass(), ['root'], { opening: 'double' })
    const [l, r] = leaves(s)
    expect(box(l)).toEqual([1, 1, 542, 399, 719, 560])
    expect(box(r)).toEqual([401, 1, 542, 799, 719, 560])
    expectClean(s)
    // it scales with the furniture
    const F1: Furniture = { width: 1000, height: 900, depth: 600 }
    const out = solveLayout(F1, s.boards, s.constraints)
    expect(out.violated).toEqual([])
    expect(box(out.boards.find((b) => b.id === l.id)!)).toEqual([1, 1, 582, 499, 899, 600])
    expect(box(out.boards.find((b) => b.id === r.id)!)).toEqual([501, 1, 582, 999, 899, 600])
  })

  it('fronts of neighbouring sections share the shelf: each covers half of it (overlay)', () => {
    let s = shelf(carcass())
    const [lower, upper] = s.sections.children.map((c) => c.id)
    s = front(s, [lower])
    s = front(s, [upper], { opening: 'up' })
    const [a] = leaves(s, 0)
    const [b] = leaves(s, 1)
    // shelf at 351..369 → lower up to 360 − 1, upper from 360 + 1 (2 mm between the fronts)
    expect(box(a)).toEqual([1, 1, 542, 799, 359, 560])
    expect(box(b)).toEqual([1, 361, 542, 799, 719, 560])
    // the shelf is between the fronts, not behind them → only the carcass set-back + 5 mm
    expect(boardBounds(byId(s, s.sections.dividers[0])).max[2]).toBe(537)
    expectClean(s)
  })
})

describe('fronts – mounting gap', () => {
  it('horizontal and vertical gaps are separate, each split half / half on the two sides', () => {
    const s = front(carcass(), ['root'], { opening: 'double', gapH: 4, gapV: 6 })
    const [l, r] = leaves(s)
    // 2 mm left / right and between the leaves 4 mm; 3 mm at the top / bottom
    expect(box(l)).toEqual([2, 3, 542, 398, 717, 560])
    expect(box(r)).toEqual([402, 3, 542, 798, 717, 560])
    expectClean(s)
  })

  it('negative gap – the front grows over the whole shelf, never outside the furniture', () => {
    let s = shelf(carcass())
    const [lower, upper] = s.sections.children.map((c) => c.id)
    s = front(s, [lower], { gapV: -18 })
    s = front(s, [upper], { opening: 'up' })
    const [a] = leaves(s, 0)
    const [b] = leaves(s, 1)
    // shelf 351..369: the lower front covers all of it; at the bottom it stops at the furniture (not −8)
    expect(box(a)).toEqual([1, 0, 542, 799, 369, 560])
    // the upper neighbour is pushed back: still its 2 mm from the lower front
    expect(box(b)).toEqual([1, 371, 542, 799, 719, 560])
    expect(frontOverlaps(s.fronts, s.boards).size).toBe(0)
    expectClean(s)
    // after resizing the furniture the limits still hold
    const F1: Furniture = { width: 900, height: 820, depth: 560 }
    const r = applyStructure(F1, s.boards, s.constraints, DEFAULT_CARCASS_RELATIONS, s.sections, s.fronts)
    const ra = r.boards.find((o) => o.id === a.id)!
    const rb = r.boards.find((o) => o.id === b.id)!
    expect(boardBounds(ra).min[1]).toBe(0)
    expect(boardBounds(rb).max).toEqual([899, 819, 560])
    expect(boardBounds(rb).min[1] - boardBounds(ra).max[1]).toBeCloseTo(2)
  })

  it('negative gap on the carcass edges ends at the furniture walls; inset fronts ignore it', () => {
    const s = front(carcass(), ['root'], { gapH: -10, gapV: -6 })
    expect(box(leaves(s)[0])).toEqual([0, 0, 542, 800, 720, 560])
    expectClean(s)
    const i = front(carcass(), ['root'], { mount: 'inset', gapH: -10, gapV: -6 })
    expect(box(leaves(i)[0])).toEqual([18, 18, 542, 782, 702, 560])
    expectClean(i)
  })

  it('negative gap of a double front – the leaves touch in the middle, never overlap', () => {
    const s = front(carcass(), ['root'], { opening: 'double', gapH: -4 })
    const [l, r] = leaves(s)
    expect(box(l)).toEqual([0, 1, 542, 400, 719, 560])
    expect(box(r)).toEqual([400, 1, 542, 800, 719, 560])
    expectClean(s)
  })

  it('both neighbours extended over the same shelf → reported as overlapping', () => {
    let s = shelf(carcass())
    const [lower, upper] = s.sections.children.map((c) => c.id)
    s = front(s, [lower], { gapV: -10 })
    s = front(s, [upper], { gapV: -10 })
    const o = frontOverlaps(s.fronts, s.boards)
    expect(o.get(s.fronts[0].id)).toEqual(['Front 2'])
    expect(o.get(s.fronts[1].id)).toEqual(['Front 1'])
  })
})

describe('fronts – sections', () => {
  it('fronts never overlap – also with fronts of parent / child sections', () => {
    let s = shelf(shelf(carcass()))
    const [c0, c1, c2] = s.sections.children.map((c) => c.id)
    expect(addFrontProblem(s.sections, s.fronts, ['root'], s.boards)).toBeNull()
    s = front(s, [c0, c1]) // a range of two sub-sections
    expect(addFrontProblem(s.sections, s.fronts, [c1], s.boards)).toMatch(/Nachodzi/)
    expect(addFrontProblem(s.sections, s.fronts, ['root'], s.boards)).toMatch(/Nachodzi/)
    expect(addFrontProblem(s.sections, s.fronts, [c2], s.boards)).toBeNull()
    expect(coversOf(s.sections, 0, 2)).toEqual(['root'])
    expect(coversOf(s.sections, 1, 2)).toEqual([c1, c2])
  })

  it('a front over a range covers the shelf between the sections – that shelf steps back', () => {
    let s = shelf(shelf(carcass()))
    const [c0, c1] = s.sections.children.map((c) => c.id)
    s = front(s, [c0, c1], { mount: 'inset' })
    const [lowShelf, highShelf] = s.sections.dividers
    expect(boardBounds(byId(s, lowShelf)).max[2]).toBe(537) // behind the inset front: 560 − 18 − 5
    expect(boardBounds(byId(s, highShelf)).max[2]).toBe(555) // bounds the front – only its own 5 mm
    expectClean(s)
  })

  it('a front loses its sections → it is removed with its boards', () => {
    let s = shelf(carcass())
    const upper = s.sections.children[1].id
    s = front(s, [upper])
    const merged = removeDividerFromTree(s.sections, s.sections.dividers[0])
    const kept = merged.sections // the lower one is kept (both empty) → the upper front's section is gone
    const p = pruneStructure(kept, s.fronts, s.boards, s.constraints)
    expect(p.fronts).toHaveLength(0)
    expect(p.boards.some((b) => b.front)).toBe(false)
  })

  it('a setback of a shelf changed by the user is kept when fronts come and go', () => {
    let s = shelf(carcass())
    const d = s.sections.dividers[0]
    s = solve({ ...s, constraints: s.constraints.map((c) => (c.board === d && c.face === 'front' ? { ...c, offset: 20 } : c)) })
    s = front(s, ['root'])
    expect(boardBounds(byId(s, d)).max[2]).toBe(560 - 18 - 20)
    expect(dividerFrontOffset(s.constraints, s.sections, d)).toMatchObject({ offset: 20, overridden: true })
    const p = pruneStructure(createRootSection(), s.fronts, s.boards, s.constraints) // all fronts gone
    const out = solve({ ...s, ...p, sections: s.sections, fronts: [] })
    expect(boardBounds(byId(out, d)).max[2]).toBe(540)
  })
})

describe('fronts – hinges', () => {
  it('marks the hinge joints and turns the leaves out of the furniture', () => {
    const s = front(carcass(), ['root'], { opening: 'double' })
    const [l, r] = s.fronts[0].boards
    const hingeFaces = s.constraints.filter((c) => c.hinge).map((c) => `${c.board === l ? 'L' : 'R'}.${c.face}`)
    expect(hingeFaces.sort()).toEqual(['L.left', 'R.right'])
    const h = boardHinges(s.constraints, s.boards, F)
    expect(h.get(l)).toMatchObject({ axis: 'y', pivot: [1, 1, 560] })
    expect(h.get(l)!.angle).toBeLessThan(0)
    expect(h.get(r)!.angle).toBeGreaterThan(0)
    const flap = front(carcass(), ['root'], { opening: 'down' })
    const fh = boardHinges(flap.constraints, flap.boards, F).get(flap.fronts[0].boards[0])!
    expect(fh.axis).toBe('x')
    expect(fh.angle).toBeGreaterThan(0)
  })

  it('a front is an ordinary board: every joint targets a board, the leaves share one two-sided joint', () => {
    const s = front(carcass(), ['root'], { opening: 'double' })
    const [l, r] = s.fronts[0].boards
    const own = s.constraints.filter((c) => c.board === l || c.board === r)
    // depth: on the front edge of the carcass side (not glued to the furniture front)
    expect(own.filter((c) => c.target.kind === 'furniture')).toEqual([])
    const depth = own.find((c) => c.board === l && c.face === 'back')!
    expect(depth.target).toEqual({ kind: 'board', id: findRoleBoard(s.boards, 'left')!.id })
    // the leaves: ONE two-sided joint L.right ↔ P.left, the right leaf has no joint of its own on the left
    const mid = own.filter((c) => c.twoSided)
    expect(mid).toHaveLength(1)
    expect(mid[0]).toMatchObject({ board: l, face: 'right', target: { kind: 'board', id: r }, targetFace: 'left', offset: 2 })
    expect(own.some((c) => c.board === r && c.face === 'left')).toBe(false)
    // a bigger gap between the leaves (typed in the joint) → both leaves give way by half
    const cs = s.constraints.map((c) => (c.id === mid[0].id ? { ...c, offset: 10 } : c))
    const out = solveLayout(F, s.boards, cs)
    expect(out.violated).toEqual([])
    expect(box(out.boards.find((b) => b.id === l)!)).toEqual([1, 1, 542, 395, 719, 560])
    expect(box(out.boards.find((b) => b.id === r)!)).toEqual([405, 1, 542, 799, 719, 560])
  })
})

describe('fronts – Ctrl + click selection in the scene', () => {
  it('builds a continuous run of neighbouring sub-sections', () => {
    const s = shelf(shelf(shelf(carcass())))
    const root = s.sections
    const [c0, c1, c2, c3] = root.children.map((c) => c.id)
    // a plain selection of one sub-section, Ctrl + the next one → a run of two
    let sel = ctrlPickSection(root, { id: c1, range: null }, c2)
    expect(sel).toEqual({ id: 'root', range: { section: 'root', from: 1, to: 2 } })
    expect(selectionCovers(root, sel)).toEqual([c1, c2])
    // a sub-section further away → the ones between are taken too
    sel = ctrlPickSection(root, { id: c1, range: null }, c3)
    expect(selectionCovers(root, sel)).toEqual([c1, c2, c3])
    // an end of the run taken off; one in the middle ignored
    expect(selectionCovers(root, ctrlPickSection(root, sel, c3))).toEqual([c1, c2])
    expect(ctrlPickSection(root, sel, c2)).toEqual(sel)
    // all of them → the whole section; one left → that sub-section
    expect(ctrlPickSection(root, sel, c0)).toEqual({ id: 'root', range: null })
    expect(ctrlPickSection(root, { id: 'root', range: { section: 'root', from: 1, to: 2 } }, c2)).toEqual({ id: c1, range: null })
    // nothing picked yet in the selected section → starts with the clicked one
    expect(ctrlPickSection(root, { id: 'root', range: null }, c2)).toEqual({ id: c2, range: null })
    // a front made from the run covers exactly those sub-sections
    const withFront = front(s, selectionCovers(root, sel))
    expect(withFront.fronts[0].covers).toEqual([c1, c2, c3])
    expectClean(withFront)
  })
})
