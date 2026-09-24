import { describe, expect, it } from 'vitest'
import type { Furniture } from '../furniture/furniture.ts'
import { boardBounds, boundsOverlap, type Board } from '../boards/board.ts'
import { removeAnchorsWithRestore, violatedAnchors } from '../layout/constraints.ts'
import { solveLayout } from '../layout/solver.ts'
import { DEFAULT_FINISH } from '../boards/finish.ts'
import { CARCASS_ROLES, DEFAULT_CARCASS_RELATIONS, createCarcassBoard } from '../carcass/carcass.ts'
import {
  addDivider,
  addProblem,
  allowedKinds,
  applyStructure,
  clearSection,
  createRootSection,
  dividerFrontOffset,
  findSection,
  missingSectionAnchors,
  removeDividerFromTree,
  sectionAtPoint,
  sectionBoxes,
  sectionLabels,
  setSectionFrontOffset,
  type DividerKind,
  type Section,
  type StructureState,
  effectiveSectionFinish,
  setSectionFinish,
  dividersUsingSectionFinish,
  compartmentSizes,
  moveDivider,
  setCompartmentSize,
  setSectionLayout,
} from './sections.ts'

const F: Furniture = { width: 800, height: 720, depth: 560 }
const T = 18
const OPTS = { ...DEFAULT_FINISH, thickness: T }

/** Default carcass: top 0..800 at 702, sides 0..702, bottom between the sides, back 18..782 × 18..702. */
function carcassState(): StructureState {
  const boards = CARCASS_ROLES.map((r) => createCarcassBoard(r, { thickness: T }, F))
  const sections = createRootSection()
  return { ...applyStructure(F, boards, [], DEFAULT_CARCASS_RELATIONS, sections), sections }
}

function add(s: StructureState, sectionId: string, kind: DividerKind): StructureState & { added: Board } {
  const next = addDivider(s, sectionId, kind, OPTS, F)
  if (!next.added) throw new Error(`cannot add ${kind}`)
  const solved = applyStructure(F, next.boards, next.constraints, DEFAULT_CARCASS_RELATIONS, next.sections)
  return { ...solved, sections: next.sections, added: solved.boards.find((b) => b.id === next.added!.id)! }
}

const box = (b: Board) => {
  const { min, max } = boardBounds(b)
  return [...min, ...max]
}
const byId = (s: { boards: Board[] }, id: string) => s.boards.find((b) => b.id === id)!

function expectClean(s: StructureState) {
  expect(violatedAnchors(s.constraints, s.boards, F)).toEqual([])
  for (let i = 0; i < s.boards.length; i++)
    for (let j = i + 1; j < s.boards.length; j++) expect(boundsOverlap(boardBounds(s.boards[i]), boardBounds(s.boards[j]))).toBe(false)
}

describe('sections – tree', () => {
  it('the furniture starts as one section between the carcass boards', () => {
    const s = carcassState()
    const root = sectionBoxes(s.sections, s.boards, F).get('root')!
    expect(root).toEqual({ min: [18, 18, 18], max: [782, 702, 560] })
  })

  it('without a carcass the root section is the whole furniture', () => {
    const boxes = sectionBoxes(createRootSection(), [], F)
    expect(boxes.get('root')).toEqual({ min: [0, 0, 0], max: [800, 720, 560] })
  })

  it('a shelf splits the root into two sections; one more shelf → three, equally high', () => {
    let s = add(carcassState(), 'root', 'shelf')
    expect(s.sections.children).toHaveLength(2)
    // middle of 18..702, recessed 5 mm from the front, between the sides, from the back
    expect(box(s.added)).toEqual([18, 351, 18, 782, 369, 555])
    expectClean(s)
    s = add(s, 'root', 'shelf')
    expect(s.sections.children).toHaveLength(3)
    const [a, b] = s.sections.dividers.map((id) => byId(s, id))
    // 684 mm of room, 2 × 18 shelves → 3 × 216 mm
    expect(a.position.y).toBe(234)
    expect(b.position.y).toBe(468)
    const heights = s.sections.children.map((c) => {
      const bx = sectionBoxes(s.sections, s.boards, F).get(c.id)!
      return bx.max[1] - bx.min[1]
    })
    expect(heights).toEqual([216, 216, 216])
    expectClean(s)
  })

  it('a section between shelves takes only partitions and vice versa; the root takes both', () => {
    let s = carcassState()
    expect(allowedKinds(s.sections, 'root')).toEqual(['shelf', 'partition'])
    s = add(s, 'root', 'shelf')
    expect(allowedKinds(s.sections, 'root')).toEqual(['shelf'])
    const child = s.sections.children[1].id
    expect(allowedKinds(s.sections, child)).toEqual(['partition'])
    expect(addProblem(s.sections, child, 'shelf')).toMatch(/tylko przedziałami/)
    expect(addDivider(s, child, 'shelf', OPTS, F).added).toBeNull()
    s = add(s, child, 'partition')
    const grand = findSection(s.sections, child)!.children[0].id
    expect(allowedKinds(s.sections, grand)).toEqual(['shelf'])
  })

  it('nested: a partition in the upper section stands between the shelf and the top', () => {
    let s = add(carcassState(), 'root', 'shelf')
    const upper = s.sections.children[1].id
    s = add(s, upper, 'partition')
    expect(box(s.added)).toEqual([391, 369, 18, 409, 702, 555])
    // a shelf in the right part of the upper section
    const right = findSection(s.sections, upper)!.children[1].id
    s = add(s, right, 'shelf')
    expect(box(s.added)).toEqual([409, 526.5, 18, 782, 544.5, 555])
    expectClean(s)
    expect(sectionLabels(s.sections).get(right)).toBe('Sekcja 2.2')
  })

  it('picks the section under a point at a given depth', () => {
    let s = add(carcassState(), 'root', 'shelf')
    s = add(s, s.sections.children[1].id, 'partition')
    const boxes = sectionBoxes(s.sections, s.boards, F)
    expect(sectionAtPoint(s.sections, boxes, 100, 100, 0).id).toBe('root')
    expect(sectionAtPoint(s.sections, boxes, 100, 100, 1).id).toBe(s.sections.children[0].id)
    expect(sectionAtPoint(s.sections, boxes, 600, 600, 2).id).toBe(s.sections.children[1].children[1].id)
    // the lower section is a leaf – depth 2 there gives the deepest one
    expect(sectionAtPoint(s.sections, boxes, 100, 100, 2).id).toBe(s.sections.children[0].id)
  })
})

describe('sections – on top of the core', () => {
  it('follows the furniture size', () => {
    let s = add(carcassState(), 'root', 'shelf')
    s = add(s, s.sections.children[1].id, 'partition')
    const F1: Furniture = { width: 1000, height: 900, depth: 600 }
    const out = solveLayout(F1, s.boards, s.constraints)
    expect(out.violated).toEqual([])
    const [shelf] = s.sections.dividers
    expect(box(out.boards.find((b) => b.id === shelf)!)).toEqual([18, 441, 18, 982, 459, 595])
  })

  it('follows a carcass change (top between the sides → the section grows)', () => {
    const s = add(carcassState(), 'root', 'shelf')
    const shelf = s.added.id
    // removing the top: the root section now reaches the furniture top
    const top = s.boards.find((b) => b.role === 'top')!
    const ids = s.constraints.filter((c) => c.board === top.id || (c.target.kind === 'board' && c.target.id === top.id)).map((c) => c.id)
    const r = removeAnchorsWithRestore(s.constraints, ids, s.boards)
    const out = applyStructure(F, r.boards.filter((b) => b.id !== top.id), r.constraints, DEFAULT_CARCASS_RELATIONS, s.sections)
    expect(violatedAnchors(out.constraints, out.boards, F)).toEqual([])
    expect(byId(out, shelf).position.y).toBe(360) // middle of 18..720 minus half the thickness
  })

  it('the default setback is the front joint offset – changed per board it stays', () => {
    let s = add(carcassState(), 'root', 'shelf')
    s = add(s, 'root', 'shelf')
    const [a, b] = s.sections.dividers
    // board b overridden by hand to 20 mm
    let cs = s.constraints.map((c) => (c.board === b && c.face === 'front' ? { ...c, offset: 20 } : c))
    expect(dividerFrontOffset(cs, s.sections, a)).toMatchObject({ offset: 5, overridden: false })
    expect(dividerFrontOffset(cs, s.sections, b)).toMatchObject({ offset: 20, overridden: true })
    const changed = setSectionFrontOffset(s.sections, cs, 'root', 10)
    cs = changed.constraints
    const out = applyStructure(F, s.boards, cs, DEFAULT_CARCASS_RELATIONS, changed.sections)
    expect(boardBounds(byId(out, a)).max[2]).toBe(550)
    expect(boardBounds(byId(out, b)).max[2]).toBe(540)
    // the sub-sections inherited the old default → they follow
    expect(changed.sections.children.every((c) => c.frontOffset === 10)).toBe(true)
  })

  it('a changed position of a shelf (centred pair, %) survives a re-sync', () => {
    const s = add(carcassState(), 'root', 'shelf')
    const cs = s.constraints.map((c) => (c.board === s.added.id && (c.face === 'bottom' || c.face === 'top') ? { ...c, unit: '%' as const, offset: 25 } : c))
    const out = applyStructure(F, s.boards, cs, DEFAULT_CARCASS_RELATIONS, s.sections)
    expect(violatedAnchors(out.constraints, out.boards, F)).toEqual([])
    expect(byId(out, s.added.id).position.y).toBe(18 + 0.25 * (684 - 18))
  })

  it('restores the joints after "Usuń wiązania"', () => {
    const s = add(carcassState(), 'root', 'partition')
    const cleared = removeAnchorsWithRestore(s.constraints, s.constraints.map((c) => c.id), s.boards)
    expect(missingSectionAnchors(cleared.constraints, cleared.boards, s.sections)).toBe(6)
    const out = applyStructure(F, cleared.boards, cleared.constraints, DEFAULT_CARCASS_RELATIONS, s.sections)
    expect(missingSectionAnchors(out.constraints, out.boards, s.sections)).toBe(0)
  })
})

describe('sections – removing', () => {
  function tree(): StructureState {
    let s = add(carcassState(), 'root', 'shelf')
    s = add(s, 'root', 'shelf') // 3 sections
    s = add(s, s.sections.children[2].id, 'partition') // upper one split
    return s
  }

  it('removing a shelf merges its two sections and keeps the split one', () => {
    const s = tree()
    const [, upperShelf] = s.sections.dividers
    const splitChild = s.sections.children[2]
    const r = removeDividerFromTree(s.sections, upperShelf)
    expect(r.removed).toEqual([upperShelf])
    expect(r.sections.children.map((c) => c.id)).toEqual([s.sections.children[0].id, splitChild.id])
    const boards = s.boards.filter((b) => !r.removed.includes(b.id))
    const out = applyStructure(F, boards, s.constraints.filter((c) => !r.removed.includes(c.board)), DEFAULT_CARCASS_RELATIONS, r.sections)
    expect(violatedAnchors(out.constraints, out.boards, F)).toEqual([])
    // the partition now reaches down to the remaining shelf
    const partition = findSection(r.sections, splitChild.id)!.dividers[0]
    expect(boardBounds(byId(out, partition)).min[1]).toBe(boardBounds(byId(out, s.sections.dividers[0])).max[1])
  })

  it('removing the last shelf: the root takes over the partitions of the kept section', () => {
    let s = add(carcassState(), 'root', 'shelf')
    s = add(s, s.sections.children[0].id, 'partition')
    const r = removeDividerFromTree(s.sections, s.sections.dividers[0])
    expect(r.sections.split).toBe('partition')
    expect(r.sections.dividers).toHaveLength(1)
    expect(r.removed).toHaveLength(1)
  })

  it('removing the last divider of a nested section drops the kept sub-split if its kind is not allowed', () => {
    let s = add(carcassState(), 'root', 'shelf')
    const upper = s.sections.children[1].id
    s = add(s, upper, 'partition')
    const left = findSection(s.sections, upper)!.children[0].id
    s = add(s, left, 'shelf')
    const partition = findSection(s.sections, upper)!.dividers[0]
    const r = removeDividerFromTree(s.sections, partition)
    // the upper section (between shelves) cannot take the shelves of its old sub-section → they go too
    expect(findSection(r.sections, upper)!.split).toBeNull()
    expect(r.removed).toHaveLength(2)
  })

  it('clearing a section removes its whole subtree', () => {
    const s = tree()
    const r = clearSection(s.sections, 'root')
    expect(r.removed).toHaveLength(3)
    expect(r.sections).toEqual({ ...s.sections, split: null, dividers: [], children: [] } satisfies Section)
  })
})

describe('sections – finish', () => {
  const brown = { materialId: 'egger-h1145-st10', thickness: 18, edgeBanding: { common: { typeId: 'brown', thickness: 1 }, overrides: {} } }
  const green = { materialId: 'kronospan-k520-su', thickness: 16, edgeBanding: { common: null, overrides: {} } }

  it('new dividers take the section finish, inherited down the tree, else the default', () => {
    const base = carcassState()
    const s1 = add({ ...base, sections: setSectionFinish(base.sections, 'root', brown) }, 'root', 'shelf')
    expect([s1.added.materialId, s1.added.edgeBanding.common?.typeId]).toEqual(['egger-h1145-st10', 'brown'])
    const upper = s1.sections.children[1].id
    expect(effectiveSectionFinish(s1.sections, upper)?.from.id).toBe('root')
    const s2 = add({ ...s1, sections: setSectionFinish(s1.sections, upper, green) }, upper, 'partition')
    expect([s2.added.materialId, s2.added.thickness]).toEqual(['kronospan-k520-su', 16])
    expect(s2.added.edgeBanding.common).toBeNull()
    // removed override → inherited again; no override anywhere → the panel default
    expect(effectiveSectionFinish(setSectionFinish(s2.sections, upper, null), upper)?.finish).toEqual(brown)
    expect(effectiveSectionFinish(createRootSection(), 'root')).toBeNull()
    expect(add(carcassState(), 'root', 'shelf').added.materialId).toBe(DEFAULT_FINISH.materialId)
  })

  it('lists the dividers that use a section finish (not those under an own override)', () => {
    let s: StructureState = add(carcassState(), 'root', 'shelf')
    const upper = s.sections.children[1].id
    const lower = s.sections.children[0].id
    s = add(s, upper, 'partition')
    s = add(s, lower, 'partition')
    const sections = setSectionFinish(s.sections, lower, green)
    const ids = dividersUsingSectionFinish(sections, 'root')
    expect(ids).toEqual([s.sections.dividers[0], findSection(sections, upper)!.dividers[0]])
  })
})

describe('sections – layout (equal / manual, dragging)', () => {
  const T2 = 18
  function threeShelves(): StructureState {
    let s: StructureState = add(carcassState(), 'root', 'shelf')
    s = add(s, 'root', 'shelf')
    s = add(s, 'root', 'shelf')
    return s
  }
  const solve = (s: StructureState, r: { sections: Section; constraints: StructureState['constraints'] }, f = F): StructureState => ({
    ...applyStructure(f, s.boards, r.constraints, DEFAULT_CARCASS_RELATIONS, r.sections),
    sections: r.sections,
  })
  const sizes = (s: StructureState, id = 'root', f = F) => compartmentSizes(s.sections, id, s.boards, f)

  it('equal: 3 shelves in 684 mm → 4 × 157,5 mm', () => {
    expect(sizes(threeShelves())).toEqual([157.5, 157.5, 157.5, 157.5])
  })

  it('switching to manual keeps the shelves where they are (pairs in %)', () => {
    const s0 = threeShelves()
    const s = solve(s0, setSectionLayout(s0, 'root', 'manual', F))
    expect(s.sections.layout).toBe('manual')
    expect(sizes(s)).toEqual([157.5, 157.5, 157.5, 157.5])
    expectClean(s)
    const pairs = s.constraints.filter((c) => s.sections.dividers.includes(c.board) && (c.face === 'bottom' || c.face === 'top'))
    expect(pairs).toHaveLength(6)
    expect(pairs.every((c) => c.unit === '%' && c.offset === 50)).toBe(true)
    // back to equal
    const eq = solve(s, setSectionLayout(s, 'root', 'equal', F))
    expect(sizes(eq)).toEqual([157.5, 157.5, 157.5, 157.5])
    expect(eq.constraints.filter((c) => c.unit === '%')).toHaveLength(0)
    expectClean(eq)
  })

  it('manual sizes keep their proportions when the furniture grows / shrinks', () => {
    const s0 = threeShelves()
    const s = solve(s0, setCompartmentSize(s0, 'root', 0, 100, F)) // [100, 157.5, 157.5, 215] = 630
    const round1 = (xs: number[]) => xs.map((x) => Math.round(x * 10) / 10)
    for (const height of [900, 600, 720]) {
      const F1: Furniture = { ...F, height }
      const out = solveLayout(F1, s.boards, s.constraints)
      expect(out.violated).toEqual([])
      const free = height - 36 - 3 * 18 // between the bottom and the top, minus 3 shelves
      const k = free / 630
      expect(round1(compartmentSizes(s.sections, 'root', out.boards, F1))).toEqual(round1([100 * k, 157.5 * k, 157.5 * k, 215 * k]))
    }
  })

  it('equal sections stay equal when the furniture changes (nested too)', () => {
    let s = threeShelves()
    const c = s.sections.children[1].id
    s = add(s, c, 'partition')
    s = add(s, c, 'partition')
    const F1: Furniture = { width: 1000, height: 900, depth: 600 }
    const out = solveLayout(F1, s.boards, s.constraints)
    expect(compartmentSizes(s.sections, 'root', out.boards, F1)).toEqual([202.5, 202.5, 202.5, 202.5])
    const inner = compartmentSizes(s.sections, c, out.boards, F1)
    expect(Math.max(...inner) - Math.min(...inner)).toBeLessThan(0.01)
  })

  it('dragging a shelf moves only it – the neighbouring sub-sections change', () => {
    const s0 = threeShelves()
    const middle = s0.sections.dividers[1]
    const lo = boardBounds(byId(s0, middle)).min[1]
    const s = solve(s0, moveDivider(s0, middle, lo + 40, F))
    expect(sizes(s)).toEqual([157.5, 197.5, 117.5, 157.5])
    expectClean(s)
    // limited to the two sub-sections around it
    const far = solve(s, moveDivider(s, middle, 10000, F))
    expect(sizes(far)).toEqual([157.5, 315, 0, 157.5])
  })

  it('a sub-section size set in the panel moves the dividers after it; the last one takes the rest', () => {
    const s0 = threeShelves()
    const s = solve(s0, setCompartmentSize(s0, 'root', 0, 100, F))
    expect(sizes(s)).toEqual([100, 157.5, 157.5, 215])
    const capped = solve(s, setCompartmentSize(s, 'root', 1, 9999, F))
    expect(sizes(capped)).toEqual([100, 372.5, 157.5, 0])
  })

  it('manual: a new shelf halves the last sub-section, removing one keeps the others in place', () => {
    const s0 = threeShelves()
    let s = solve(s0, setCompartmentSize(s0, 'root', 0, 100, F)) // [100, 157.5, 157.5, 215]
    const r = addDivider(s, 'root', 'shelf', { ...DEFAULT_FINISH, thickness: T2 }, F)
    s = { ...applyStructure(F, r.boards, r.constraints, DEFAULT_CARCASS_RELATIONS, r.sections), sections: r.sections }
    expect(sizes(s)).toEqual([100, 157.5, 157.5, 98.5, 98.5])
    expectClean(s)
    const second = s.sections.dividers[1]
    const rm = removeDividerFromTree(s.sections, second)
    const out = applyStructure(F, s.boards.filter((b) => b.id !== second), s.constraints.filter((c) => c.board !== second && !(c.target.kind === 'board' && c.target.id === second)), DEFAULT_CARCASS_RELATIONS, rm.sections)
    expect(compartmentSizes(rm.sections, 'root', out.boards, F)).toEqual([100, 333, 98.5, 98.5])
  })
})
