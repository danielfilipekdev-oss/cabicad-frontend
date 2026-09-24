import type { Furniture } from './furniture/furniture.ts'
import type { Board } from './boards/board.ts'
import type { AnchorConstraint } from './layout/constraints.ts'
import { solveLayout } from './layout/solver.ts'
import { syncCarcassAnchors, type CarcassRelations } from './carcass/carcass.ts'
import { maintainAutoSections, syncSectionAnchors, type Section } from './sections/sections.ts'
import { applyRecess, pruneFronts, recessByBoard, syncFrontAnchors, type Front } from './fronts/fronts.ts'

/**
 * Everything generated on top of the core, in order: the carcass joints, the shelf / partition joints
 * (their frames depend on the carcass), the front joints (their frames depend on both), the set-back of
 * the carcass / shelves behind the fronts – then the layout is solved. After that the AUTOMATIC dividers
 * (`maintainAutoSections`) follow the solved sizes of their sections: when some are added / removed, the
 * whole thing runs again (fronts whose sections disappeared go away).
 */
export function applyStructure(
  furniture: Furniture,
  boards: Board[],
  constraints: AnchorConstraint[],
  carcass: CarcassRelations,
  sections: Section,
  fronts: Front[] = [],
  pinnedId?: string,
): { boards: Board[]; constraints: AnchorConstraint[]; sections: Section; fronts: Front[] } {
  let bs = boards
  let cs0 = constraints
  let secs = sections
  let frs = fronts
  for (let round = 0; ; round++) {
    const r = layoutOnce(furniture, bs, cs0, carcass, secs, frs, pinnedId)
    const auto = maintainAutoSections({ sections: secs, boards: r.boards, constraints: r.constraints }, furniture)
    secs = auto.sections
    if (!auto.changed || round >= 8) return { boards: r.boards, constraints: r.constraints, sections: secs, fronts: frs }
    const p = pruneStructure(secs, frs, auto.boards, auto.constraints)
    frs = p.fronts
    bs = p.boards
    cs0 = p.constraints
  }
}

function layoutOnce(
  furniture: Furniture,
  boards: Board[],
  constraints: AnchorConstraint[],
  carcass: CarcassRelations,
  sections: Section,
  fronts: Front[],
  pinnedId?: string,
): { boards: Board[]; constraints: AnchorConstraint[] } {
  let cs = syncCarcassAnchors(constraints, boards, furniture, carcass)
  cs = syncSectionAnchors(cs, boards, sections, furniture)
  const base = cs
  const withFronts = (bs: Board[]) => applyRecess(syncFrontAnchors(base, bs, sections, fronts, furniture), recessByBoard(sections, bs, fronts))
  cs = withFronts(boards)
  let solved = solveLayout(furniture, boards, cs, pinnedId).boards
  // the limits of the fronts (walls of the furniture, extended neighbours) depend on where the boards
  // are – checked again on the solved layout (e.g. after the furniture was resized)
  if (fronts.length) {
    const again = withFronts(solved)
    if (anchorsKey(again) !== anchorsKey(cs)) {
      cs = again
      solved = solveLayout(furniture, solved, cs, pinnedId).boards
    }
  }
  return { constraints: cs, boards: solved }
}

const anchorsKey = (cs: AnchorConstraint[]) =>
  JSON.stringify(cs.map((c) => [c.board, c.face, c.target, c.targetFace, c.target2, c.offset]))

/** Fronts whose sections are gone are removed (their boards and joints too). */
export function pruneStructure(
  sections: Section,
  fronts: Front[],
  boards: Board[],
  constraints: AnchorConstraint[],
): { fronts: Front[]; boards: Board[]; constraints: AnchorConstraint[] } {
  const { fronts: kept, removedBoards } = pruneFronts(sections, fronts)
  if (!removedBoards.length) return { fronts, boards, constraints }
  const gone = new Set(removedBoards)
  return {
    fronts: kept,
    boards: boards.filter((b) => !gone.has(b.id)),
    constraints: constraints.filter((c) => !gone.has(c.board) && !(c.target.kind === 'board' && gone.has(c.target.id))),
  }
}
