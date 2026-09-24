import { describe, expect, it } from 'vitest'
import type { Furniture } from '../furniture/furniture.ts'
import { CARCASS_ROLES, DEFAULT_CARCASS_RELATIONS, applyCarcass, createCarcassBoard, findRoleBoard, setCovers } from '../carcass/carcass.ts'
import { removeAnchorsWithRestore } from './constraints.ts'
import { hiddenBands, restoreHiddenBands, withoutHiddenBands } from './edgeContacts.ts'
import type { EdgeBanding } from '../boards/edgeBanding.ts'

const F: Furniture = { width: 800, height: 720, depth: 560 }
const BANDED: EdgeBanding = { common: { typeId: 'brown', thickness: 1 }, overrides: {} }

function carcass(relations = DEFAULT_CARCASS_RELATIONS) {
  const boards = CARCASS_ROLES.map((r) => createCarcassBoard(r, { thickness: 18, edgeBanding: BANDED }, F))
  return applyCarcass(F, boards, [], relations)
}

const edgesOf = (s: ReturnType<typeof carcass>, role: Parameters<typeof findRoleBoard>[1]) =>
  (hiddenBands(s.boards).get(findRoleBoard(s.boards, role)!.id) ?? []).map((h) => h.edge).sort()

describe('bands of edges joined to another board', () => {
  it('default carcass: the edges butting against other boards lose the band', () => {
    const s = carcass()
    expect(edgesOf(s, 'top')).toEqual([]) // it covers the others with its surface
    expect(edgesOf(s, 'left')).toEqual(['A']) // top edge under the top
    expect(edgesOf(s, 'right')).toEqual(['A'])
    expect(edgesOf(s, 'bottom')).toEqual(['B', 'D']) // between the sides
    expect(edgesOf(s, 'back')).toEqual(['A', 'B', 'C', 'D']) // inside the carcass
  })

  it('follows the relations: top between the sides → the top loses the side bands, the sides keep the top one', () => {
    const s = carcass(setCovers(setCovers(DEFAULT_CARCASS_RELATIONS, 'left', 'top'), 'right', 'top'))
    expect(edgesOf(s, 'top')).toEqual(['B', 'D'])
    expect(edgesOf(s, 'left')).toEqual([])
  })

  it('an edge without a band is not reported; a board moved away gets its band back', () => {
    const s = carcass()
    const left = findRoleBoard(s.boards, 'left')!
    const noTopBand = s.boards.map((b) => (b.id === left.id ? { ...b, edgeBanding: { ...BANDED, overrides: { A: null } } } : b))
    expect(hiddenBands(noTopBand).get(left.id)).toBeUndefined()
    const lowered = s.boards.map((b) => (b.id === left.id ? { ...b, height: b.height - 10 } : b))
    expect(hiddenBands(lowered).get(left.id)).toBeUndefined()
  })

  it('counts contacts without a joint too (e.g. after "Usuń wiązania")', () => {
    const s = carcass()
    const cleared = removeAnchorsWithRestore(s.constraints, s.constraints.map((c) => c.id), s.boards)
    const back = findRoleBoard(cleared.boards, 'back')!
    expect((hiddenBands(cleared.boards).get(back.id) ?? []).map((h) => h.edge).sort()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('a banding edited from the shown one gets the hidden edges back from the configuration', () => {
    const configured: EdgeBanding = { common: BANDED.common, overrides: { B: { typeId: 'green', thickness: 2 } } }
    const hidden = [
      { edge: 'A' as const, face: 'top' as const, by: 'x' },
      { edge: 'B' as const, face: 'right' as const, by: 'x' },
    ]
    const shown = withoutHiddenBands(configured, hidden)
    const edited = { ...shown, overrides: { ...shown.overrides, C: null } } // e.g. the user removed the C band
    expect(restoreHiddenBands(edited, configured, hidden).overrides).toEqual({ B: { typeId: 'green', thickness: 2 }, C: null })
  })

  it('leaves the configuration alone – only the shown banding drops the edge', () => {
    const s = carcass()
    const back = findRoleBoard(s.boards, 'back')!
    const shown = withoutHiddenBands(back.edgeBanding, hiddenBands(s.boards).get(back.id))
    expect(shown.overrides).toEqual({ A: null, B: null, C: null, D: null })
    expect(back.edgeBanding).toEqual(BANDED)
  })
})
