import { describe, expect, it } from 'vitest'
import { DEFAULT_BOARD_PARAMS, boardSizeMm, type Board, type BoardParams } from '../boards/board.ts'
import type { Furniture } from '../furniture/furniture.ts'
import {
  attachAllContacts,
  attachToContacts,
  boardsFollowingFurniture,
  canConnectHandles,
  connectHandles,
  connectionProblem,
  isHandleEnabled,
  createAnchor,
  createPullingAnchor,
  findContacts,
  rederiveOffsets,
  boardLocks,
  hasDependents,
  centeredOffset,
  centeredPairs,
  centeredRange,
  setCenteredOffset,
  setCenteredUnit,
  anchorRange,
  anchorRawOffset,
  offsetDirection,
  setAnchorUnit,
  faceAxis as faceAxisOf,
  isDimensionLocked,
  removeAnchor,
  removeAnchorsWithRestore,
  removeBoardConstraints,
  upsertAnchor,
  violatedAnchors,
  type AnchorConstraint,
  type HandleRef,
} from './constraints.ts'
import { solveLayout } from './solver.ts'

const T = 18
const F0: Furniture = { width: 800, height: 720, depth: 560 }

function board(id: string, p: Partial<BoardParams>, x: number, y: number, z: number): Board {
  return { ...DEFAULT_BOARD_PARAMS, thickness: T, ...p, id, name: id, position: { x, y, z } }
}

/** Classic carcass: two sides, inset bottom and top, a shelf set back 20 mm from the front. */
function carcass(): Board[] {
  return [
    board('sideL', { orientation: 'side', width: 560, height: 720 }, 0, 0, 0),
    board('sideR', { orientation: 'side', width: 560, height: 720 }, 782, 0, 0),
    board('bottom', { orientation: 'horizontal', width: 764, height: 560 }, 18, 0, 0),
    board('top', { orientation: 'horizontal', width: 764, height: 560 }, 18, 702, 0),
    board('shelf', { orientation: 'horizontal', width: 764, height: 540 }, 18, 351, 0),
  ]
}

const byId = (bs: Board[], id: string) => bs.find((b) => b.id === id)!

describe('side orientation', () => {
  it('maps width to depth (Z) and thickness to X', () => {
    expect(boardSizeMm(board('s', { orientation: 'side', width: 560, height: 720 }, 0, 0, 0))).toEqual([18, 720, 560])
  })
})

describe('contacts', () => {
  it('finds furniture walls and touching boards', () => {
    const bs = carcass()
    const shelf = findContacts(byId(bs, 'shelf'), bs, F0).map((c) => `${c.face}->${c.target.kind === 'board' ? c.target.id : 'F'}.${c.targetFace}`)
    expect(shelf.sort()).toEqual(['back->F.back', 'left->sideL.right', 'right->sideR.left'].sort())
  })

  it('makes the shelf, bottom and top depend on the sides (edge meets surface)', () => {
    const cs = attachAllContacts([], carcass(), F0)
    const toSides = cs.filter((c) => c.target.kind === 'board' && c.target.id.startsWith('side'))
    expect(toSides.map((c) => c.board).sort()).toEqual(['bottom', 'bottom', 'shelf', 'shelf', 'top', 'top'])
    expect(violatedAnchors(cs, carcass(), F0)).toEqual([])
  })
})

describe('solveLayout – furniture resize', () => {
  it('without constraints returns the same boards', () => {
    const bs = carcass()
    expect(solveLayout(F0, bs, []).boards).toBe(bs)
  })

  it('carcass follows a bigger furniture', () => {
    const bs = carcass()
    const cs = attachAllContacts([], bs, F0)
    const F1: Furniture = { width: 1000, height: 900, depth: 600 }
    const { boards: out, violated } = solveLayout(F1, bs, cs)
    expect(violated).toEqual([])

    const sideR = byId(out, 'sideR')
    expect(sideR.position.x).toBe(982)
    expect(sideR.height).toBe(900)
    expect(sideR.width).toBe(600) // depth
    expect(sideR.thickness).toBe(18)

    expect(byId(out, 'bottom').width).toBe(964)
    expect(byId(out, 'bottom').height).toBe(600)
    expect(byId(out, 'top').position.y).toBe(882)
    expect(byId(out, 'top').width).toBe(964)

    const shelf = byId(out, 'shelf')
    expect(shelf.width).toBe(964) // stretched between the sides
    expect(shelf.height).toBe(540) // depth: only the back is anchored → keeps its depth
    expect(shelf.position.y).toBe(351) // free on Y → stays
  })

  it('carcass follows a smaller furniture and comes back', () => {
    const bs = carcass()
    const cs = attachAllContacts([], bs, F0)
    const small = solveLayout({ width: 600, height: 500, depth: 400 }, bs, cs)
    expect(small.violated).toEqual([])
    expect(byId(small.boards, 'shelf').width).toBe(564)
    expect(byId(small.boards, 'shelf').height).toBe(400) // does not fit – shrinks to the furniture
    const back = solveLayout(F0, small.boards, cs)
    expect(byId(back.boards, 'sideR').position.x).toBe(782)
    expect(byId(back.boards, 'bottom').width).toBe(764)
  })

  it('overlaid top: sides hang below it', () => {
    const bs = [
      board('top', { orientation: 'horizontal', width: 800, height: 560 }, 0, 702, 0),
      board('sideL', { orientation: 'side', width: 560, height: 702 }, 0, 0, 0),
      board('sideR', { orientation: 'side', width: 560, height: 702 }, 782, 0, 0),
    ]
    const cs = attachAllContacts([], bs, F0)
    // the side touches the top with its edge → the side depends on the top
    expect(cs.some((c) => c.board === 'sideL' && c.face === 'top' && c.target.kind === 'board' && c.target.id === 'top')).toBe(true)
    const { boards: out, violated } = solveLayout({ ...F0, height: 900 }, bs, cs)
    expect(violated).toEqual([])
    expect(byId(out, 'top').position.y).toBe(882)
    expect(byId(out, 'sideL').height).toBe(882)
  })

  it('reports an anchor that would push the board out of the furniture', () => {
    const bs = [board('a', { orientation: 'side', width: 560, height: 720 }, 0, 0, 0)]
    // left face 500 mm to the right of the right wall (positive = into the furniture, so −500 = outside)
    const cs: AnchorConstraint[] = [{ ...createAnchor(bs[0], 'left', { kind: 'furniture' }, 'right', bs, F0), offset: -500 }]
    const { boards: out, violated } = solveLayout(F0, bs, cs)
    expect(violated).toEqual([cs[0].id])
    expect(byId(out, 'a').position.x).toBe(782) // stopped at the wall
  })
})

describe('editing', () => {
  it('moving a side re-derives its own offset and the shelf follows', () => {
    const bs = carcass()
    let cs = attachAllContacts([], bs, F0)
    const prev = byId(bs, 'sideL')
    const moved = { ...prev, position: { ...prev.position, x: 50 } }
    cs = rederiveOffsets(cs, prev, moved, bs, F0)
    const edited = bs.map((b) => (b.id === moved.id ? moved : b))
    const { boards: out, violated } = solveLayout(F0, edited, cs)
    expect(violated).toEqual([])
    expect(byId(out, 'sideL').position.x).toBe(50)
    expect(byId(out, 'shelf').position.x).toBe(68)
    expect(byId(out, 'shelf').width).toBe(714)
    expect(cs.find((c) => c.board === 'sideL' && c.face === 'left')!.offset).toBe(50)
  })

  it('moving the shelf up keeps it between the sides', () => {
    const bs = carcass()
    let cs = attachAllContacts([], bs, F0)
    const prev = byId(bs, 'shelf')
    const moved = { ...prev, position: { ...prev.position, y: 400 } }
    cs = rederiveOffsets(cs, prev, moved, bs, F0)
    const { boards: out } = solveLayout(F0, bs.map((b) => (b.id === moved.id ? moved : b)), cs)
    expect(byId(out, 'shelf').position.y).toBe(400)
    expect(byId(out, 'shelf').width).toBe(764)
  })

  it('attach, upsert and remove', () => {
    const bs = carcass()
    let cs = attachToContacts(byId(bs, 'shelf'), [], bs, F0)
    expect(cs.length).toBe(3)
    // the panel adds the same pulling joint as a chain in the scene: offset 0 (replaces the old one)
    cs = upsertAnchor(cs, createPullingAnchor(byId(bs, 'shelf'), 'left', { kind: 'furniture' }, 'left', bs, F0))
    expect(cs.filter((c) => c.face === 'left').length).toBe(1)
    expect(cs.find((c) => c.face === 'left')!.offset).toBe(0)
    expect(byId(solveLayout(F0, bs, cs).boards, 'shelf').position.x).toBe(0)
    cs = removeAnchor(cs, cs[0].id)
    expect(cs.length).toBe(2)
    cs = removeBoardConstraints(cs, 'sideR')
    expect(cs.length).toBe(1)
  })

  it('knows which boards follow the furniture width', () => {
    const cs = attachAllContacts([], carcass(), F0)
    const following = boardsFollowingFurniture(cs, 0)
    expect([...following].sort()).toEqual(['bottom', 'shelf', 'sideR', 'top'])
  })
})

describe('handles', () => {
  const F = { kind: 'furniture' } as const
  const B = (id: string) => ({ kind: 'board', id }) as const

  it('connects only faces on the same axis, involving the selected board', () => {
    expect(canConnectHandles({ owner: B('shelf'), face: 'left' }, { owner: B('sideL'), face: 'right' }, 'shelf', [])).toBe(true)
    expect(canConnectHandles({ owner: B('shelf'), face: 'left' }, { owner: B('sideL'), face: 'top' }, 'shelf', [])).toBe(false)
    expect(canConnectHandles({ owner: B('shelf'), face: 'left' }, { owner: B('shelf'), face: 'right' }, 'shelf', [])).toBe(false)
    expect(canConnectHandles({ owner: B('top'), face: 'left' }, { owner: B('sideL'), face: 'right' }, 'shelf', [])).toBe(false)
    expect(canConnectHandles({ owner: F, face: 'left' }, { owner: F, face: 'right' }, 'shelf', [])).toBe(false)
    expect(canConnectHandles({ owner: F, face: 'back' }, { owner: B('shelf'), face: 'back' }, 'shelf', [])).toBe(true)
  })

  it('greys out only joints that already exist', () => {
    const bs = carcass()
    const cs = attachToContacts(byId(bs, 'shelf'), [], bs, F0)
    // shelf.left → sideL.right exists: the same joint, also drawn the other way round
    expect(canConnectHandles({ owner: B('sideL'), face: 'right' }, { owner: B('shelf'), face: 'left' }, 'shelf', cs)).toBe(false)
    // another face pair of the same two boards is allowed (the solver decides what it does)
    expect(canConnectHandles({ owner: B('shelf'), face: 'right' }, { owner: B('sideL'), face: 'left' }, 'shelf', cs)).toBe(true)
    // the same furniture anchor again → no, the other furniture wall → yes (replaces it)
    expect(canConnectHandles({ owner: B('shelf'), face: 'back' }, { owner: F, face: 'back' }, 'shelf', cs)).toBe(false)
    expect(canConnectHandles({ owner: B('shelf'), face: 'back' }, { owner: F, face: 'front' }, 'shelf', cs)).toBe(true)
    // Y is free
    expect(canConnectHandles({ owner: B('shelf'), face: 'bottom' }, { owner: B('bottom'), face: 'top' }, 'shelf', cs)).toBe(true)
  })

  it('names the reason a handle is greyed out', () => {
    const bs = carcass()
    const cs = attachToContacts(byId(bs, 'shelf'), [], bs, F0)
    const reason = (f: HandleRef, t: HandleRef) => connectionProblem(f, t, 'shelf', cs)
    expect(reason({ owner: B('shelf'), face: 'left' }, { owner: B('sideL'), face: 'top' })).toBe('inna oś niż uchwyt startowy')
    expect(reason({ owner: B('shelf'), face: 'left' }, { owner: B('shelf'), face: 'right' })).toBe('to ta sama płyta')
    expect(reason({ owner: B('shelf'), face: 'left' }, { owner: B('sideL'), face: 'right' })).toBe('takie wiązanie już istnieje')
    expect(reason({ owner: B('top'), face: 'left' }, { owner: B('sideL'), face: 'right' })).toBe('wiązanie musi dotyczyć zaznaczonej płyty')
    expect(reason({ owner: B('shelf'), face: 'right' }, { owner: B('sideL'), face: 'left' })).toBe(null)
  })

  it('enabled state follows the dragged handle', () => {
    const all = [
      { owner: B('shelf'), face: 'left' as const },
      { owner: B('sideL'), face: 'right' as const },
      { owner: B('sideL'), face: 'top' as const },
    ]
    expect(isHandleEnabled(all[2], all, 'shelf', [], null)).toBe(false) // no Y face on the shelf in the list
    expect(isHandleEnabled(all[1], all, 'shelf', [], all[0])).toBe(true)
    expect(isHandleEnabled(all[2], all, 'shelf', [], all[0])).toBe(false)
  })

  it('chain from the furniture makes the board dependent and pulls it to the wall', () => {
    const bs = carcass()
    const cs = connectHandles([], { owner: F, face: 'front' }, { owner: B('shelf'), face: 'front' }, bs, F0)
    expect(cs).toHaveLength(1)
    expect(cs[0]).toMatchObject({ board: 'shelf', face: 'front', target: { kind: 'furniture' }, targetFace: 'front', offset: 0 })
    const shelf = byId(solveLayout(F0, bs, cs).boards, 'shelf')
    expect(shelf.position.z).toBe(20) // moved forward to the front wall, keeps its depth
    expect(shelf.height).toBe(540)
  })

  it('chain pulls a parallel board to contact / to one plane, the offset can be overridden', () => {
    const bs = [
      board('a', { orientation: 'side', width: 560, height: 720 }, 100, 0, 0),
      board('b', { orientation: 'side', width: 560, height: 500 }, 300, 0, 0),
    ]
    // b.left → a.right: b slides to touch a
    let cs = connectHandles([], { owner: B('b'), face: 'left' }, { owner: B('a'), face: 'right' }, bs, F0)
    expect(byId(solveLayout(F0, bs, cs).boards, 'b').position.x).toBe(118)
    // b.top → a.top (same side): tops aligned in one plane
    cs = connectHandles(cs, { owner: B('b'), face: 'top' }, { owner: B('a'), face: 'top' }, bs, F0)
    const out = solveLayout(F0, bs, cs).boards
    expect(byId(out, 'b').position.y + byId(out, 'b').height).toBe(720)
    // offset overridden in the panel: 10 mm gap
    cs = cs.map((c) => (c.face === 'left' ? { ...c, offset: 10 } : c))
    expect(byId(solveLayout(F0, out, cs).boards, 'b').position.x).toBe(128)
  })
})

describe('removing joints', () => {
  const B = (id: string) => ({ kind: 'board', id }) as const

  it('puts the board back where it was before the chain pulled it', () => {
    const bs = [
      board('a', { orientation: 'side', width: 560, height: 720 }, 100, 0, 0),
      board('b', { orientation: 'side', width: 560, height: 500 }, 300, 0, 0),
    ]
    const cs = connectHandles([], { owner: B('b'), face: 'left' }, { owner: B('a'), face: 'right' }, bs, F0)
    const pulled = solveLayout(F0, bs, cs).boards
    expect(byId(pulled, 'b').position.x).toBe(118)
    const after = removeAnchorsWithRestore(cs, [cs[0].id], pulled)
    expect(after.constraints).toEqual([])
    expect(byId(after.boards, 'b').position.x).toBe(300)
  })

  it('unwinds a stretched shelf joint by joint', () => {
    const bs = carcass()
    const shelf0 = byId(bs, 'shelf')
    let cs = attachAllContacts([], bs, F0)
    let out = solveLayout({ ...F0, width: 1000 }, bs, cs).boards
    expect(byId(out, 'shelf').width).toBe(964)
    const shelfJoints = cs.filter((c) => c.board === 'shelf' && faceAxisOf(c.face) === 0).map((c) => c.id)
    const res = removeAnchorsWithRestore(cs, shelfJoints, out)
    expect(byId(res.boards, 'shelf').width).toBe(shelf0.width)
    expect(byId(res.boards, 'shelf').position.x).toBe(shelf0.position.x)
  })

  it('keeps the board in place while another joint still holds the axis', () => {
    const bs = carcass()
    const cs = attachToContacts(byId(bs, 'shelf'), [], bs, F0)
    const left = cs.find((c) => c.face === 'left')!
    const res = removeAnchorsWithRestore(cs, [left.id], bs)
    expect(byId(res.boards, 'shelf').position.x).toBe(18) // the right joint still holds X
  })
})

describe('boardLocks', () => {
  const B = (id: string) => ({ kind: 'board', id }) as const
  it('one joint fixes the position, two fix the size', () => {
    const bs = carcass()
    const shelf = byId(bs, 'shelf')
    const one = connectHandles([], { owner: B('shelf'), face: 'left' }, { owner: B('sideL'), face: 'right' }, bs, F0)
    let locks = boardLocks(one, 'shelf')
    expect(locks.position).toEqual([true, false, false])
    expect(locks.size).toEqual([false, false, false])
    expect(isDimensionLocked(locks, shelf, 'width')).toBe(false)
    const both = connectHandles(one, { owner: B('shelf'), face: 'right' }, { owner: B('sideR'), face: 'left' }, bs, F0)
    locks = boardLocks(both, 'shelf')
    expect(locks.size).toEqual([true, false, false])
    expect(isDimensionLocked(locks, shelf, 'width')).toBe(true)
    expect(isDimensionLocked(locks, shelf, 'height')).toBe(false) // depth (Z) free
  })

  it('locks the orientation of a board other boards hang on', () => {
    const bs = carcass()
    const cs = connectHandles([], { owner: B('shelf'), face: 'left' }, { owner: B('sideL'), face: 'right' }, bs, F0)
    expect(boardLocks(cs, 'sideL').orientation).toBe(true) // the shelf hangs on it
    expect(boardLocks(cs, 'shelf').orientation).toBe(false) // it only hangs on something itself
    expect(hasDependents(cs, 'sideR')).toBe(false)
  })
})

describe('centred board (two chains on the flat sides)', () => {
  const B = (id: string) => ({ kind: 'board', id }) as const

  /** Carcass sides + a vertical divider standing somewhere between them. */
  const withDivider = () => [
    board('sideL', { orientation: 'side', width: 560, height: 720 }, 0, 0, 0),
    board('sideR', { orientation: 'side', width: 560, height: 720 }, 782, 0, 0),
    board('divider', { orientation: 'side', width: 560, height: 720 }, 200, 0, 0),
  ]

  it('lands exactly in the middle between the two sides', () => {
    const bs = withDivider()
    let cs = connectHandles([], { owner: B('divider'), face: 'left' }, { owner: B('sideL'), face: 'right' }, bs, F0)
    cs = connectHandles(cs, { owner: B('divider'), face: 'right' }, { owner: B('sideR'), face: 'left' }, bs, F0)
    const { boards: out, violated } = solveLayout(F0, bs, cs)
    expect(violated).toEqual([]) // neither face touches its plane, but the pair is satisfied
    const d = byId(out, 'divider')
    expect(d.position.x).toBe(391) // (18 + 782) / 2 − 18 / 2
    expect(d.thickness).toBe(18)
  })

  it('the offset pushes it away from that centre (both anchors share one value)', () => {
    const bs = withDivider()
    let cs = connectHandles([], { owner: B('divider'), face: 'left' }, { owner: B('sideL'), face: 'right' }, bs, F0)
    cs = connectHandles(cs, { owner: B('divider'), face: 'right' }, { owner: B('sideR'), face: 'left' }, bs, F0)
    const pair = centeredPairs(cs, bs)[0]
    expect(pair.boardId).toBe('divider')
    expect(centeredOffset(pair)).toBe(0)
    cs = setCenteredOffset(cs, pair, 50)
    expect(centeredOffset(centeredPairs(cs, bs)[0])).toBe(50)
    const out = solveLayout(F0, bs, cs).boards
    expect(byId(out, 'divider').position.x).toBe(441)
    expect(violatedAnchors(cs, out, F0)).toEqual([])
  })

  it('follows a wider furniture and stays centred', () => {
    const bs = withDivider()
    let cs = attachAllContacts([], bs, F0) // sides stick to the furniture walls
    cs = connectHandles(cs, { owner: B('divider'), face: 'left' }, { owner: B('sideL'), face: 'right' }, bs, F0)
    cs = connectHandles(cs, { owner: B('divider'), face: 'right' }, { owner: B('sideR'), face: 'left' }, bs, F0)
    const out = solveLayout({ ...F0, width: 1200 }, bs, cs).boards
    expect(byId(out, 'sideR').position.x).toBe(1182)
    expect(byId(out, 'divider').position.x).toBe(591) // (18 + 1182) / 2 − 9
  })

  it('a shelf joined on two EDGES still stretches (only the flat sides centre)', () => {
    const bs = carcass()
    const cs = attachAllContacts([], bs, F0)
    expect(centeredPairs(cs, bs)).toEqual([])
    expect(byId(solveLayout({ ...F0, width: 1000 }, bs, cs).boards, 'shelf').width).toBe(964)
  })
})

describe('resizing a board other boards hang on', () => {
  const B = (id: string) => ({ kind: 'board', id }) as const
  const BIG: Furniture = { width: 900, height: 900, depth: 560 }
  /** Back panel (vertical) with a bottom hanging on it: left/right flush, its back on the panel's front. */
  const setup = () => {
    const bs = [
      board('back', { orientation: 'vertical', width: 600, height: 500 }, 0, 0, 0),
      board('bottom', { orientation: 'horizontal', width: 600, height: 400 }, 0, 0, 18),
    ]
    let cs = connectHandles([], { owner: B('bottom'), face: 'left' }, { owner: B('back'), face: 'left' }, bs, BIG)
    cs = connectHandles(cs, { owner: B('bottom'), face: 'right' }, { owner: B('back'), face: 'right' }, bs, BIG)
    cs = connectHandles(cs, { owner: B('bottom'), face: 'back' }, { owner: B('back'), face: 'front' }, bs, BIG)
    return { bs, cs }
  }

  it('the independent board keeps the new width and the hanging one follows', () => {
    const { bs, cs } = setup()
    const wider = bs.map((b) => (b.id === 'back' ? { ...b, width: 700 } : b))
    const out = solveLayout(BIG, wider, cs).boards
    expect(byId(out, 'back').width).toBe(700)
    expect(byId(out, 'bottom').width).toBe(700)
  })

  it('the same for the height (nothing is anchored on Y)', () => {
    const { bs, cs } = setup()
    const taller = bs.map((b) => (b.id === 'back' ? { ...b, height: 800 } : b))
    const out = solveLayout(BIG, taller, cs).boards
    expect(byId(out, 'back').height).toBe(800)
  })
})

describe('moving a board other boards hang on', () => {
  const B = (id: string) => ({ kind: 'board', id }) as const
  it('the bottom can be moved up in Y and the side follows', () => {
    const bs = [
      board('bottom', { orientation: 'horizontal', width: 600, height: 500 }, 0, 0, 0),
      board('sideL', { orientation: 'side', width: 500, height: 400 }, 0, 18, 0),
    ]
    const cs = connectHandles([], { owner: B('sideL'), face: 'bottom' }, { owner: B('bottom'), face: 'top' }, bs, F0)
    const moved = bs.map((b) => (b.id === 'bottom' ? { ...b, position: { ...b.position, y: 50 } } : b))
    const { boards: out, violated } = solveLayout(F0, moved, cs, 'bottom')
    expect(violated).toEqual([])
    expect(byId(out, 'bottom').position.y).toBe(50)
    expect(byId(out, 'sideL').position.y).toBe(68)
  })
})

describe('offsets: positive = away from the target, mm or %', () => {
  const B = (id: string) => ({ kind: 'board', id }) as const
  const F = { kind: 'furniture' } as const

  it('direction: into the furniture from its walls, into the board from a board face', () => {
    expect(offsetDirection({ face: 'left', target: F, targetFace: 'left' })).toBe(1)
    expect(offsetDirection({ face: 'right', target: F, targetFace: 'right' })).toBe(-1)
    expect(offsetDirection({ face: 'front', target: F, targetFace: 'front' })).toBe(-1)
    expect(offsetDirection({ face: 'top', target: F, targetFace: 'top' })).toBe(-1)
    expect(offsetDirection({ face: 'left', target: F, targetFace: 'right' })).toBe(-1)
    // prawa płyty → lewa sąsiada: away from it (−X); przednia → przednia boku: recessed (−Z)
    expect(offsetDirection({ face: 'right', target: B('x'), targetFace: 'left' })).toBe(-1)
    expect(offsetDirection({ face: 'front', target: B('x'), targetFace: 'front' })).toBe(-1)
    expect(offsetDirection({ face: 'left', target: B('x'), targetFace: 'right' })).toBe(1)
  })

  it('a positive offset on the right / top / front wall moves the board inside', () => {
    const bs = carcass()
    let cs = connectHandles([], { owner: B('shelf'), face: 'front' }, { owner: F, face: 'front' }, bs, F0)
    cs = cs.map((c) => ({ ...c, offset: 20 }))
    const shelf = byId(solveLayout(F0, bs, cs).boards, 'shelf')
    expect(shelf.position.z + shelf.height).toBe(540) // 20 mm behind the front wall
    expect(createAnchor(shelf, 'front', F, 'front', bs, F0).offset).toBe(20)
  })

  it('a positive offset recesses a board behind the face it is aligned with', () => {
    const bs = carcass()
    const cs = connectHandles([], { owner: B('shelf'), face: 'front' }, { owner: B('sideL'), face: 'front' }, bs, F0).map((c) => ({
      ...c,
      offset: 30,
    }))
    const shelf = byId(solveLayout(F0, bs, cs).boards, 'shelf')
    expect(shelf.position.z + shelf.height).toBe(530)
  })

  it('% of the free space: 0 % at the target, 50 % in the middle, 100 % at the far wall', () => {
    const bs = [board('shelf', { orientation: 'horizontal', width: 764, height: 540 }, 18, 100, 0)]
    const base = connectHandles([], { owner: B('shelf'), face: 'bottom' }, { owner: F, face: 'bottom' }, bs, F0)
    const at = (p: number) => byId(solveLayout(F0, bs, base.map((c) => ({ ...c, unit: '%' as const, offset: p }))).boards, 'shelf').position.y
    expect(at(0)).toBe(0)
    expect(at(50)).toBe(351) // (720 − 18) / 2
    expect(at(100)).toBe(702) // touching the top wall
    // it keeps its relative place when the furniture grows
    const cs = base.map((c) => ({ ...c, unit: '%' as const, offset: 50 }))
    expect(byId(solveLayout({ ...F0, height: 918 }, bs, cs).boards, 'shelf').position.y).toBe(450)
  })

  it('% from the far wall (top → top of the furniture)', () => {
    const bs = [board('shelf', { orientation: 'horizontal', width: 764, height: 540 }, 18, 100, 0)]
    const cs = connectHandles([], { owner: B('shelf'), face: 'top' }, { owner: F, face: 'top' }, bs, F0).map((c) => ({
      ...c,
      unit: '%' as const,
      offset: 25,
    }))
    const out = solveLayout(F0, bs, cs)
    expect(out.violated).toEqual([])
    expect(byId(out.boards, 'shelf').position.y).toBe(526.5) // 702 − 0.25 · 702
  })

  it('% on both faces of a stretched board – each from its own wall', () => {
    const bs = [board('back', { orientation: 'vertical', width: 800, height: 500 }, 0, 100, 0)]
    let cs = connectHandles([], { owner: B('back'), face: 'bottom' }, { owner: F, face: 'bottom' }, bs, F0)
    cs = connectHandles(cs, { owner: B('back'), face: 'top' }, { owner: F, face: 'top' }, bs, F0)
    cs = cs.map((c) => ({ ...c, unit: '%' as const, offset: 10 }))
    const out = solveLayout(F0, bs, cs)
    expect(out.violated).toEqual([])
    expect(byId(out.boards, 'back').position.y).toBe(72)
    expect(byId(out.boards, 'back').height).toBe(576)
  })

  it('switching the unit keeps the board where it is', () => {
    const bs = [board('shelf', { orientation: 'horizontal', width: 764, height: 540 }, 18, 100, 0)]
    let cs = connectHandles([], { owner: B('shelf'), face: 'bottom' }, { owner: F, face: 'bottom' }, bs, F0).map((c) => ({ ...c, offset: 351 }))
    cs = setAnchorUnit(cs, cs[0].id, '%', bs, F0)
    expect(cs[0]).toMatchObject({ unit: '%', offset: 50 })
    expect(anchorRawOffset(cs[0], cs, bs, F0)).toBe(351)
    cs = setAnchorUnit(cs, cs[0].id, 'mm', bs, F0)
    expect(cs[0]).toMatchObject({ unit: 'mm', offset: 351 })
  })

  it('the range keeps the board inside the furniture', () => {
    const bs = carcass()
    const shelf = byId(bs, 'shelf')
    // shelf front → furniture front: 0 … 20 mm (its depth is 540 of 560), −0 … it cannot stick out
    let cs = connectHandles([], { owner: B('shelf'), face: 'front' }, { owner: F, face: 'front' }, bs, F0)
    expect(anchorRange(cs[0], cs, bs, F0)).toEqual({ min: 0, max: 20 })
    // shelf bottom → top face of the bottom board: from −18 (down to the floor) to 684 (up to the top)
    cs = connectHandles([], { owner: B('shelf'), face: 'bottom' }, { owner: B('bottom'), face: 'top' }, bs, F0)
    expect(anchorRange(cs[0], cs, bs, F0)).toEqual({ min: -18, max: 684 })
    const pct = setAnchorUnit(cs, cs[0].id, '%', bs, F0)
    expect(anchorRange(pct[0], pct, bs, F0)!.max).toBe(100)
    expect(shelf.thickness).toBe(18)
  })

  it('stretched board: a face cannot pass the other one', () => {
    const bs = [board('back', { orientation: 'vertical', width: 800, height: 500 }, 0, 100, 0)]
    let cs = connectHandles([], { owner: B('back'), face: 'bottom' }, { owner: F, face: 'bottom' }, bs, F0)
    cs = connectHandles(cs, { owner: B('back'), face: 'top' }, { owner: F, face: 'top' }, bs, F0)
    const out = solveLayout(F0, bs, cs).boards // stretched 0 … 720
    expect(anchorRange(cs[0], cs, out, F0)).toEqual({ min: 0, max: 719 })
  })

  it('centred pair in %: position between the planes, switching units keeps the place', () => {
    const bs = [
      board('sideL', { orientation: 'side', width: 560, height: 720 }, 0, 0, 0),
      board('sideR', { orientation: 'side', width: 560, height: 720 }, 782, 0, 0),
      board('divider', { orientation: 'side', width: 560, height: 720 }, 200, 0, 0),
    ]
    let cs = connectHandles([], { owner: B('divider'), face: 'left' }, { owner: B('sideL'), face: 'right' }, bs, F0)
    cs = connectHandles(cs, { owner: B('divider'), face: 'right' }, { owner: B('sideR'), face: 'left' }, bs, F0)
    cs = setCenteredOffset(cs, centeredPairs(cs, bs)[0], 50) // 50 mm right of the middle
    expect(centeredRange(centeredPairs(cs, bs)[0], bs, F0)).toEqual({ min: -373, max: 373 })
    cs = setCenteredUnit(cs, centeredPairs(cs, bs)[0], '%', bs, F0)
    const pair = centeredPairs(cs, bs)[0]
    expect(centeredOffset(pair)).toBeCloseTo(56.702, 3) // 50 + 50 / 746 · 100
    expect(byId(solveLayout(F0, bs, cs).boards, 'divider').position.x).toBeCloseTo(441, 2)
    cs = setCenteredOffset(cs, pair, 0)
    const out = solveLayout(F0, bs, cs)
    expect(byId(out.boards, 'divider').position.x).toBe(18) // touching the left side
    expect(out.violated).toEqual([])
    cs = setCenteredOffset(cs, centeredPairs(cs, bs)[0], 100)
    expect(byId(solveLayout(F0, bs, cs).boards, 'divider').position.x).toBe(764)
  })
})
