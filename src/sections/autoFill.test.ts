import { describe, expect, it } from 'vitest'
import type { Furniture } from '../furniture/furniture.ts'
import { boardBounds, type Board } from '../boards/board.ts'
import { DEFAULT_FINISH } from '../boards/finish.ts'
import { violatedAnchors, type AnchorConstraint } from '../layout/constraints.ts'
import { CARCASS_ROLES, DEFAULT_CARCASS_RELATIONS, createCarcassBoard } from '../carcass/carcass.ts'
import { applyStructure } from '../structure.ts'
import { addDivider, createRootSection, removeDividerFromTree, setCompartmentSize, setSectionAuto, type Section } from './sections.ts'

interface State {
  furniture: Furniture
  boards: Board[]
  constraints: AnchorConstraint[]
  sections: Section
}

// carcass 18 mm: the root section is 36 mm lower than the furniture (bottom + top) → clear height = H − 36
const furniture = (clear: number): Furniture => ({ width: 800, height: clear + 36, depth: 560 })

const solve = (s: State): State => ({
  ...s,
  ...applyStructure(s.furniture, s.boards, s.constraints, DEFAULT_CARCASS_RELATIONS, s.sections),
})

function carcass(clear: number): State {
  const f = furniture(clear)
  const boards = CARCASS_ROLES.map((r) => createCarcassBoard(r, { thickness: 18 }, f))
  return solve({ furniture: f, boards, constraints: [], sections: createRootSection() })
}

const AUTO = { kind: 'shelf' as const, pitch: 500, thickness: 18, finish: DEFAULT_FINISH }

function withAuto(s: State, pitch = 500): State {
  return solve({ ...s, ...setSectionAuto(s, 'root', { ...AUTO, pitch }, s.furniture) })
}
const resize = (s: State, clear: number): State => solve({ ...s, furniture: furniture(clear) })

/** Lower faces of the shelves, measured from the bottom of the section (the top of the floor = 18). */
const shelves = (s: State) => s.sections.dividers.map((id) => boardBounds(s.boards.find((b) => b.id === id)!).min[1] - 18)

describe('automatic shelves (every pitch)', () => {
  it('a section of 500 – none, 700 – one at 500, 1200 – at 500 and 1000', () => {
    expect(shelves(withAuto(carcass(500)))).toEqual([])
    expect(shelves(withAuto(carcass(700)))).toEqual([500])
    const s = withAuto(carcass(1200))
    expect(shelves(s)).toEqual([500, 1000])
    expect(violatedAnchors(s.constraints, s.boards, s.furniture)).toEqual([])
    // the shelf must fit whole: 1017 → only one (1000 + 18 > 1017), 1018 → two
    expect(shelves(withAuto(carcass(1017)))).toEqual([500])
    expect(shelves(withAuto(carcass(1018)))).toEqual([500, 1000])
  })

  it('growing adds shelves every pitch, shrinking removes the one the top runs into', () => {
    let s = withAuto(carcass(700))
    s = resize(s, 1600)
    expect(shelves(s)).toEqual([500, 1000, 1500])
    s = resize(s, 1100)
    expect(shelves(s)).toEqual([500, 1000]) // 1500 + 18 > 1100 → gone, the others keep their mm
    s = resize(s, 1017)
    expect(shelves(s)).toEqual([500])
    expect(s.sections.children).toHaveLength(2)
    s = resize(s, 400)
    expect(shelves(s)).toEqual([])
    expect(s.sections.split).toBeNull()
    expect(s.sections.auto?.kind).toBe('shelf') // still on: it comes back when the section grows
    s = resize(s, 1200)
    expect(shelves(s)).toEqual([500, 1000])
  })

  it('shelves can still be moved, added and removed – growing continues from the last one', () => {
    let s = withAuto(carcass(1200))
    // the first compartment made 300 mm – the second shelf keeps its compartment (482 mm) and follows
    s = solve({ ...s, ...setCompartmentSize(s, 'root', 0, 300, s.furniture) })
    expect(shelves(s)).toEqual([300, 800])
    expect(s.sections.auto).toBeDefined()
    // a shelf removed by hand is not put back while the section keeps its size…
    const r = removeDividerFromTree(s.sections, s.sections.dividers[1])
    s = solve({ ...s, sections: r.sections, boards: s.boards.filter((b) => !r.removed.includes(b.id)), constraints: s.constraints.filter((c) => !r.removed.includes(c.board)) })
    expect(shelves(s)).toEqual([300])
    // …a shelf added by hand stays too
    const a = addDivider(s, 'root', 'shelf', { ...DEFAULT_FINISH, thickness: 18 }, s.furniture)
    s = solve({ ...s, boards: a.boards, constraints: a.constraints, sections: a.sections })
    expect(shelves(s)).toHaveLength(2)
    const handMade = shelves(s)[1]
    // growing: new shelves every 500 from the start of the last one
    s = resize(s, handMade + 1100)
    expect(shelves(s)).toEqual([300, handMade, handMade + 500, handMade + 1000])
  })

  it('switching it off keeps the shelves (manual layout, proportions)', () => {
    let s = withAuto(carcass(1200))
    s = solve({ ...s, ...setSectionAuto(s, 'root', null, s.furniture) })
    expect(s.sections.auto).toBeUndefined()
    expect(s.sections.layout).toBe('manual')
    expect(shelves(s)).toEqual([500, 1000])
    s = resize(s, 2400)
    expect(shelves(s)).toHaveLength(2) // nothing added any more
  })
})
