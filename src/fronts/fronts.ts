import type { Furniture } from '../furniture/furniture.ts'
import { DEFAULT_BOARD_PARAMS, boardBounds, boundsOverlap, fitParamsToFurniture, type Board } from '../boards/board.ts'
import { withFinish, type BoardFinish } from '../boards/finish.ts'
import {
  newConstraintId,
  oppositeFace,
  targetFaceValue,
  type AnchorConstraint,
  type AnchorTarget,
  type Face,
} from '../layout/constraints.ts'
import {
  allSections,
  findSection,
  frameBox,
  parentSection,
  sectionFrames,
  subtreeDividers,
  type PlaneRef,
  type Section,
  type SectionBox,
  type SectionFrame,
} from '../sections/sections.ts'

/**
 * Fronts (fronty) – doors / flaps closing the sections of the furniture, the third layer on top of the
 * core boards + joints (after the carcass and the shelves / partitions).
 *
 * A front COVERS a section of the section tree: the whole section, or a run of neighbouring sub-sections
 * of a split section (`covers` – ids of the covered sections). Fronts never overlap: two fronts conflict
 * when a section covered by one is the same as, inside or around a section covered by the other (so a big
 * front on a parent section blocks fronts in its sub-sections and the other way round).
 *
 * Mounting:
 *  - 'overlay' (nakładany) – in front of the carcass, covering the edges of the boards around the
 *    opening: the full thickness of a carcass board, half of a shelf / partition (the neighbouring front
 *    covers the other half). The whole carcass (and everything in it) is set back by the front thickness,
 *    so the front stays inside the furniture,
 *  - 'inset' (wpuszczany) – inside the opening, flush with the front of the carcass; the shelves /
 *    partitions behind it are set back by its thickness.
 * Both keep a mounting gap (luz montażowy), split into the HORIZONTAL gap (luz w poziomie – between the
 * front and its left / right neighbours) and the VERTICAL gap (luz w pionie – above / below). The value is
 * the whole gap between two neighbouring elements (default 2 mm), so each front edge takes a half of it
 * (1 mm) – two neighbouring fronts end up 2 mm apart, the leaves of a double front too. A NEGATIVE gap
 * makes an overlay front bigger (e.g. −18 → it covers the whole 18 mm shelf instead of a half); it never
 * leaves the furniture and a neighbour on the other side of that shelf keeps its gap from it.
 *
 * No geometry of its own: a front is 1 board (2 for a double front – two leaves) of 'vertical'
 * orientation, placed by generated joints (`preset`, see `frontAnchorSpecs`):
 *  - each edge → the plane bounding the covered area (a carcass board / shelf / partition face or a
 *    furniture wall) with the offset = gap/2 − covered edge (so + half the gap into the opening, − the cover),
 *  - the leaves of a double front meet in the middle of the opening: joints to the MIDDLE between the two
 *    side planes (`target2` – the core extension) ± half the horizontal gap,
 *  - the front face → the front of the furniture (offset = the carcass set-back for an inset front),
 *  - the joint on the hinge side is marked as a HINGE (`hinge`) – the front turns around that edge when
 *    it is opened (render only, `leafHinges`).
 * The set-back of the carcass and of the shelves (`recessByBoard`) is added to their front joints as a
 * separate part of the offset (`AnchorConstraint.recess`), so their own setbacks are kept.
 */

export type FrontMount = 'overlay' | 'inset'
/**
 * How the front opens – named by the way its FREE edge moves (like a flap "z góry na dół" – hinges at the
 * bottom):
 *  - 'ltr' z lewej do prawej – hinges on the right, 'rtl' z prawej do lewej – hinges on the left,
 *  - 'double' – two leaves, hinges on both outer sides,
 *  - 'down' z góry na dół – hinges at the bottom (a flap falling down), 'up' z dołu na górę – hinges at the top.
 */
export type FrontOpening = 'ltr' | 'rtl' | 'double' | 'down' | 'up'

export const MOUNT_LABELS: Record<FrontMount, string> = {
  overlay: 'Nakładany (na boki)',
  inset: 'Wpuszczany (między płyty)',
}

export const OPENING_LABELS: Record<FrontOpening, string> = {
  ltr: 'Z lewej do prawej (zawiasy po prawej)',
  rtl: 'Z prawej do lewej (zawiasy po lewej)',
  double: 'Podwójny – dwa skrzydła na zewnątrz',
  down: 'Z góry na dół (zawiasy na dole)',
  up: 'Z dołu na górę (zawiasy u góry)',
}

export const DEFAULT_FRONT_GAP = 2
export const DEFAULT_FRONT_THICKNESS = 18
/** A negative gap makes the front bigger (e.g. covering the whole shelf) – never outside the furniture. */
export const FRONT_GAP_LIMITS = { min: -60, max: 20 }

export interface Front {
  id: string
  /** Covered sections: [a section] or neighbouring sub-sections of one split section (in order). */
  covers: string[]
  mount: FrontMount
  opening: FrontOpening
  /** Luz w poziomie [mm] – the whole horizontal gap (left / right, between the leaves); half of it per side. */
  gapH: number
  /** Luz w pionie [mm] – the whole vertical gap (top / bottom); half of it per side. */
  gapV: number
  /** Board(s) of the front: one, or two leaves (left, right) of a double front. */
  boards: string[]
}

export interface FrontOptions {
  mount: FrontMount
  opening: FrontOpening
  gapH: number
  gapV: number
  /** Thickness of the leaves [mm] – normally the thickness of the finish (the board model's variant). */
  thickness: number
  finish: BoardFinish
}

let counter = 0
const newId = (prefix: string) => {
  counter += 1
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${prefix}-${Date.now()}-${counter}`
}

// ---- coverage & overlaps ---------------------------------------------------------------------------

/**
 * What a front covers: `section` = the section whose area is covered (the covered one itself, or the
 * parent of the covered sub-sections) and the index range of its sub-sections (`from`–`to`), or null
 * (the whole section) – or null when `covers` is not valid any more.
 */
export function frontCoverage(root: Section, covers: string[]): { section: Section; range: [number, number] | null } | null {
  if (covers.length === 0) return null
  if (covers.length === 1) {
    const s = findSection(root, covers[0])
    if (s) return { section: s, range: null }
    return null
  }
  const parent = parentSection(root, covers[0])
  if (!parent) return null
  const idx = covers.map((id) => parent.children.findIndex((c) => c.id === id))
  if (idx.some((i) => i < 0)) return null
  for (let k = 1; k < idx.length; k++) if (idx[k] !== idx[k - 1] + 1) return null
  return { section: parent, range: [idx[0], idx[idx.length - 1]] }
}

/** Covers of sub-sections `from`–`to` of a section (normalised: all of them = the section itself). */
export function coversOf(section: Section, from?: number, to?: number): string[] {
  if (from === undefined || to === undefined || !section.children.length) return [section.id]
  const [a, b] = from <= to ? [from, to] : [to, from]
  if (a === 0 && b === section.children.length - 1) return [section.id]
  return section.children.slice(a, b + 1).map((c) => c.id)
}

/** Sub-sections `from`–`to` of `section` picked for a new front (null = the whole selected section). */
export interface FrontRange {
  section: string
  from: number
  to: number
}

/** Selection of the "Fronty" tool: the selected section and optionally a run of its sub-sections. */
export interface FrontSelection {
  id: string | null
  range: FrontRange | null
}

/** Section the selection is about and the sub-section range actually used (all when none / stale). */
export function selectionRange(root: Section, sel: FrontSelection): { section: Section; from: number; to: number } {
  const section = findSection(root, sel.id) ?? root
  const n = section.children.length
  if (!n) return { section, from: 0, to: 0 }
  const r = sel.range?.section === section.id ? sel.range : null
  const from = r ? Math.max(0, Math.min(r.from, r.to, n - 1)) : 0
  const to = r ? Math.min(Math.max(r.from, r.to), n - 1) : n - 1
  return { section, from, to }
}

/** Sections a new front would cover for the selection. */
export function selectionCovers(root: Section, sel: FrontSelection): string[] {
  const { section, from, to } = selectionRange(root, sel)
  return section.children.length ? coversOf(section, from, to) : [section.id]
}

/**
 * Ctrl + click on section `clicked` in the scene: adds it to (or takes it off) the run of neighbouring
 * sub-sections picked for a front. The run stays continuous (fronts cover neighbouring sub-sections):
 *  - a sub-section outside the run extends the run up to it (the ones between are taken too),
 *  - the first / last sub-section of the run is taken off, one in the middle is ignored,
 *  - a sub-section of another section starts a new run.
 * One sub-section left → it is simply the selected section; all of them → the whole parent section.
 */
export function ctrlPickSection(root: Section, sel: FrontSelection, clicked: string): FrontSelection {
  const parent = parentSection(root, clicked)
  if (!parent) return { id: clicked, range: null }
  const i = parent.children.findIndex((c) => c.id === clicked)
  const n = parent.children.length
  let run: [number, number] | null = null
  if (sel.id === parent.id) {
    const cur = selectionRange(root, sel)
    if (cur.from > 0 || cur.to < n - 1) run = [cur.from, cur.to]
  } else {
    const j = parent.children.findIndex((c) => c.id === sel.id)
    if (j >= 0) run = [j, j]
  }
  let next: [number, number] | null
  if (!run) next = [i, i]
  else if (i < run[0]) next = [i, run[1]]
  else if (i > run[1]) next = [run[0], i]
  else if (run[0] === run[1]) next = null // the only one taken off → nothing picked in the parent
  else if (i === run[0]) next = [run[0] + 1, run[1]]
  else if (i === run[1]) next = [run[0], run[1] - 1]
  else next = run
  if (!next) return { id: parent.id, range: null }
  if (next[0] === next[1]) return { id: parent.children[next[0]].id, range: null }
  if (next[0] === 0 && next[1] === n - 1) return { id: parent.id, range: null }
  return { id: parent.id, range: { section: parent.id, from: next[0], to: next[1] } }
}

const isInside = (root: Section, inner: string, outer: string) => {
  const o = findSection(root, outer)
  return !!o && allSections(o).some((s) => s.id === inner)
}

/** Do two coverages overlap (a covered section equal to, inside or around a covered section of the other)? */
export function coversConflict(root: Section, a: string[], b: string[]): boolean {
  return a.some((x) => b.some((y) => isInside(root, x, y) || isInside(root, y, x)))
}

/** Why a front cannot cover `covers` (overlap with another front), or null. */
export function addFrontProblem(root: Section, fronts: Front[], covers: string[], boards: Board[], ignore?: string): string | null {
  if (!frontCoverage(root, covers)) return 'Nieprawidłowy zakres sekcji.'
  const other = fronts.find((f) => f.id !== ignore && coversConflict(root, f.covers, covers))
  if (!other) return null
  const name = boards.find((b) => b.id === other.boards[0])?.name ?? 'inny front'
  return `Nachodzi na: ${name.replace(/ [LP]$/, '')} – fronty nie mogą się pokrywać (także w sekcjach nad- i podrzędnych).`
}

/** Frame (bounding planes) of the area a front covers. */
export function frontFrame(root: Section, boards: Board[], covers: string[]): SectionFrame | null {
  const cov = frontCoverage(root, covers)
  if (!cov) return null
  const frames = sectionFrames(root, boards)
  const frame = frames.get(cov.section.id)
  if (!frame) return null
  if (!cov.range || !cov.section.split) return frame
  const first = frames.get(cov.section.children[cov.range[0]].id)
  const last = frames.get(cov.section.children[cov.range[1]].id)
  if (!first || !last) return null
  const axis = cov.section.split === 'shelf' ? 1 : 0
  const f = frame.map((p) => [...p]) as SectionFrame
  f[axis] = [first[axis][0], last[axis][1]]
  return f
}

// ---- set-back of the carcass and of the shelves ----------------------------------------------------

/** How much the carcass is set back from the front of the furniture: the thickest overlay front. */
export function carcassSetback(fronts: Front[], boards: Board[]): number {
  let t = 0
  for (const f of fronts) {
    if (f.mount !== 'overlay') continue
    for (const id of f.boards) t = Math.max(t, boards.find((b) => b.id === id)?.thickness ?? 0)
  }
  return t
}

/** Dividers BEHIND a front (inside the covered area – not the ones bounding it). */
export function dividersBehind(root: Section, front: Front): string[] {
  const cov = frontCoverage(root, front.covers)
  if (!cov) return []
  if (!cov.range) return subtreeDividers(cov.section)
  const [a, b] = cov.range
  const s = cov.section
  return [...s.dividers.slice(a, b), ...s.children.slice(a, b + 1).flatMap(subtreeDividers)]
}

/**
 * Part of the front joint offset of every carcass board / shelf / partition that comes from the fronts:
 * the carcass set-back (overlay fronts) for all of them, + the thickness of an inset front for the
 * shelves / partitions behind it.
 */
export function recessByBoard(root: Section, boards: Board[], fronts: Front[]): Map<string, number> {
  const setback = carcassSetback(fronts, boards)
  const recess = new Map<string, number>()
  for (const b of boards) if ((b.role && b.role !== 'back') || b.divider) recess.set(b.id, setback)
  for (const f of fronts) {
    if (f.mount !== 'inset') continue
    const t = Math.max(0, ...f.boards.map((id) => boards.find((b) => b.id === id)?.thickness ?? 0))
    for (const d of dividersBehind(root, f)) recess.set(d, Math.max(recess.get(d) ?? 0, setback + t))
  }
  return recess
}

/**
 * Updates the front joints (front face → front wall of the furniture) of the carcass boards and the
 * dividers: offset = own setback + the recess from the fronts. The previous recess is taken off first,
 * so a setback changed by the user is kept.
 */
export function applyRecess(constraints: AnchorConstraint[], recess: Map<string, number>): AnchorConstraint[] {
  return constraints.map((c) => {
    if (!c.preset || c.face !== 'front' || c.target.kind !== 'furniture' || c.targetFace !== 'front' || c.target2) return c
    const r = recess.get(c.board) ?? 0
    const old = c.recess ?? 0
    if (r === old) return c
    return { ...c, offset: Number((c.offset - old + r).toFixed(3)), recess: r || undefined }
  })
}

// ---- joints of the fronts --------------------------------------------------------------------------

export interface FrontAnchorSpec {
  board: string
  face: Face
  target: AnchorTarget
  targetFace: Face
  offset: number
  hinge?: boolean
  twoSided?: boolean
  bias?: number
}

/** Hinge side of each leaf of a front. */
export function hingeFaces(front: Front): Face[] {
  switch (front.opening) {
    case 'ltr':
      return ['right']
    case 'rtl':
      return ['left']
    case 'down':
      return ['bottom']
    case 'up':
      return ['top']
    default:
      return ['left', 'right']
  }
}

/** How much of the board a plane belongs to an overlay front covers: carcass board – all, divider – half. */
function coverOf(plane: PlaneRef, boards: Board[], mount: FrontMount): number {
  if (mount !== 'overlay' || plane.target.kind !== 'board') return 0
  const id = plane.target.id
  const b = boards.find((o) => o.id === id)
  if (!b) return 0
  return b.divider ? b.thickness / 2 : b.thickness
}

/** Luz actually used by a front: an inset front sits between the boards – it cannot grow into them (≥ 0). */
export const effectiveGap = (f: Pick<Front, 'mount'>, gap: number) => (f.mount === 'inset' ? Math.max(0, gap) : gap)

interface EdgePlan {
  front: Front
  board: string
  face: Face
  plane: PlaneRef
  /** Whole gap of this edge (horizontal / vertical, after `effectiveGap`). */
  gap: number
  /** Offset from the plane into the opening (+) / over the covered board (−). */
  raw: number
  hinge: boolean
  box: SectionBox
}

const EPS = 1e-6

/**
 * Joint of a front across the depth – to a CARCASS board, like any other board (not to the furniture):
 * overlay → its back face on the front edge of the carcass (which is set back by the front thickness),
 * inset → flush with it. The board on the hinge side is preferred (a side / the top / the bottom), then
 * another carcass board around the opening, then any carcass board; the furniture front without one.
 */
function depthSpec(f: Front, id: string, planes: PlaneRef[], hinges: Face[], boards: Board[], setback: number): FrontAnchorSpec {
  const carcassOf = (p: PlaneRef) => {
    if (p.target.kind !== 'board') return null
    const bid = p.target.id
    const b = boards.find((o) => o.id === bid)
    return b?.role && b.role !== 'back' ? b : null
  }
  const [L, R, B, T] = planes
  const byFace: Partial<Record<Face, PlaneRef>> = { left: L, right: R, bottom: B, top: T }
  const ordered = [...hinges.map((h) => byFace[h]).filter((p): p is PlaneRef => !!p), ...planes]
  const ref = ordered.map(carcassOf).find((b) => !!b) ?? boards.find((b) => b.role && b.role !== 'back')
  if (!ref) return { board: id, face: 'front', target: { kind: 'furniture' }, targetFace: 'front', offset: f.mount === 'inset' ? setback : 0 }
  return f.mount === 'inset'
    ? { board: id, face: 'front', target: { kind: 'board', id: ref.id }, targetFace: 'front', offset: 0 }
    : { board: id, face: 'back', target: { kind: 'board', id: ref.id }, targetFace: 'front', offset: 0 }
}
const edgeAxis = (face: Face) => (face === 'left' || face === 'right' ? 0 : 1)
const isLowFace = (face: Face) => face === 'left' || face === 'bottom'

/**
 * Joints of the fronts. A negative gap makes the front bigger (e.g. an overlay front covering the whole
 * shelf instead of a half of it). Two limits:
 *  - a neighbouring front (the other side of the same shelf / partition) that is extended over the
 *    divider pushes this edge back, so the two fronts still keep this front's gap between them,
 *  - the front never leaves the furniture: an edge that would go past a wall is glued to that wall.
 * `furniture` / board positions are only needed for these limits (see the second pass in applyStructure).
 */
export function frontAnchorSpecs(root: Section, boards: Board[], fronts: Front[], furniture?: Furniture): FrontAnchorSpec[] {
  const specs: FrontAnchorSpec[] = []
  const setback = carcassSetback(fronts, boards)
  const edges: EdgePlan[] = []
  const middles: FrontAnchorSpec[] = []
  for (const f of fronts) {
    const frame = frontFrame(root, boards, f.covers)
    if (!frame || f.boards.some((id) => !boards.some((b) => b.id === id))) continue
    const box = furniture ? frameBox(frame, boards, furniture) : null
    const cover = (p: PlaneRef) => coverOf(p, boards, f.mount)
    const gapH = effectiveGap(f, f.gapH)
    const gapV = effectiveGap(f, f.gapV)
    const hinges = hingeFaces(f)
    const edge = (board: string, face: Face, plane: PlaneRef, hinge: boolean) => {
      const gap = edgeAxis(face) === 0 ? gapH : gapV
      edges.push({ front: f, board, face, plane, gap, raw: gap / 2 - cover(plane), hinge, box: box ?? { min: [0, 0, 0], max: [0, 0, 0] } })
    }
    const [L, R] = frame[0]
    const [B, T] = frame[1]
    f.boards.forEach((id, leaf) => {
      const double = f.boards.length === 2
      // across X: the whole opening, or one half of it (the leaves meet in the middle)
      if (!double) {
        edge(id, 'left', L, hinges.includes('left'))
        edge(id, 'right', R, hinges.includes('right'))
      } else if (leaf === 0) {
        // the leaves are joined to each other by ONE two-sided joint (like a chain in ConstraintLayout):
        // the gap between them = the horizontal gap and both leaves give way equally (bias 50 %) – the
        // leaves never overlap (a negative gap only makes the outer edges bigger)
        edge(id, 'left', L, true)
        middles.push({ board: id, face: 'right', target: { kind: 'board', id: f.boards[1] }, targetFace: 'left', offset: Math.max(0, gapH), twoSided: true, bias: 0.5 })
      } else {
        edge(id, 'right', R, true)
      }
      edge(id, 'bottom', B, hinges.includes('bottom'))
      edge(id, 'top', T, hinges.includes('top'))
      middles.push(depthSpec(f, id, [L, R, B, T], hinges, boards, setback))
    })
  }

  // a neighbour extended over the shared divider pushes this edge back (keeping this front's gap)
  if (furniture) {
    for (const e of edges) {
      if (e.gap < 0 || e.plane.target.kind !== 'board') continue
      const divider = boards.find((b) => b.id === (e.plane.target as { id: string }).id)
      if (!divider?.divider) continue
      const across = 1 - edgeAxis(e.face)
      let push = e.raw
      for (const o of edges) {
        if (o.front.id === e.front.id || o.gap >= 0 || o.front.mount !== 'overlay') continue
        if (o.plane.target.kind !== 'board' || o.plane.target.id !== divider.id || o.plane.face !== oppositeFace(e.plane.face)) continue
        if (Math.min(e.box.max[across], o.box.max[across]) - Math.max(e.box.min[across], o.box.min[across]) <= EPS) continue
        // o reaches −o.gap/2 past the middle of the divider; this edge keeps its whole gap from it
        push = Math.max(push, -o.gap / 2 + e.gap - divider.thickness / 2)
      }
      e.raw = push
    }
  }

  for (const e of edges) {
    let spec: FrontAnchorSpec = { board: e.board, face: e.face, target: e.plane.target, targetFace: e.plane.face, offset: Number(e.raw.toFixed(3)) }
    // never outside the furniture: past the wall → glued to the wall
    const v = furniture ? targetFaceValue(e.plane.target, e.plane.face, boards, furniture) : null
    if (furniture && v !== null && e.plane.target.kind === 'board') {
      const axis = edgeAxis(e.face)
      const size = axis === 0 ? furniture.width : furniture.height
      const at = isLowFace(e.face) ? v + e.raw : v - e.raw
      if (at < -EPS || at > size + EPS) spec = { board: e.board, face: e.face, target: { kind: 'furniture' }, targetFace: e.face, offset: 0 }
    }
    specs.push({ ...spec, hinge: e.hinge || undefined })
  }
  return [...specs, ...middles]
}

/**
 * Fronts overlapping other fronts (e.g. both neighbours extended over the same shelf with a negative
 * gap): front id → names of the fronts it collides with.
 */
export function frontOverlaps(fronts: Front[], boards: Board[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const leaves = (f: Front) => f.boards.map((id) => boards.find((b) => b.id === id)).filter((b): b is Board => !!b)
  for (const a of fronts)
    for (const b of fronts) {
      if (a.id === b.id) continue
      const hit = leaves(a).some((x) => leaves(b).some((y) => boundsOverlap(boardBounds(x), boardBounds(y))))
      if (!hit) continue
      const name = (leaves(b)[0]?.name ?? 'inny front').replace(/ [LP]$/, '')
      out.set(a.id, [...(out.get(a.id) ?? []), name])
    }
  return out
}

const sameTarget = (a: AnchorTarget | undefined, b: AnchorTarget | undefined) =>
  a === b || (!!a && !!b && a.kind === b.kind && (a.kind === 'furniture' || a.id === (b as { id: string }).id))

/**
 * Brings the joints of the front boards in line with the fronts: the joints are fully generated (their
 * offsets follow the gap / covers / set-back), a joint of the same faces keeps its id.
 */
export function syncFrontAnchors(
  constraints: AnchorConstraint[],
  boards: Board[],
  root: Section,
  fronts: Front[],
  furniture?: Furniture,
): AnchorConstraint[] {
  const specs = frontAnchorSpecs(root, boards, fronts, furniture)
  const frontBoards = new Set(boards.filter((b) => b.front).map((b) => b.id))
  const kept = constraints.filter((c) => !c.preset || !frontBoards.has(c.board))
  const generated = specs.map((s) => {
    const old = constraints.find(
      (c) =>
        c.preset &&
        c.board === s.board &&
        c.face === s.face &&
        c.targetFace === s.targetFace &&
        sameTarget(c.target, s.target),
    )
    return {
      ...(old ?? {}),
      id: old?.id ?? newConstraintId(),
      ...s,
      target2: undefined,
      targetFace2: undefined,
      hinge: s.hinge || undefined,
      twoSided: s.twoSided || undefined,
      bias: s.bias,
      unit: undefined,
      preset: true,
    } as AnchorConstraint
  })
  // a joint made by hand on a front face wins
  return [...kept, ...generated.filter((g) => !kept.some((c) => c.board === g.board && c.face === g.face))]
}

// ---- boards ------------------------------------------------------------------------------------------

function nextFrontNumber(boards: Board[]): number {
  return (
    boards.reduce((m, b) => {
      const n = /^Front (\d+)/.exec(b.name)
      return n ? Math.max(m, Number(n[1])) : m
    }, 0) + 1
  )
}

/** Creates a front (1 or 2 boards) covering `covers`; its exact geometry comes from the joints. */
export function createFront(
  root: Section,
  boards: Board[],
  furniture: Furniture,
  covers: string[],
  options: FrontOptions,
): { front: Front; boards: Board[] } | null {
  const frame = frontFrame(root, boards, covers)
  const box: SectionBox | null = frame ? frameBox(frame, boards, furniture) : null
  if (!box) return null
  const id = newId('front')
  const n = nextFrontNumber(boards)
  const double = options.opening === 'double'
  const w = Math.max(1, box.max[0] - box.min[0])
  const h = Math.max(1, box.max[1] - box.min[1])
  const leaves = (double ? [0, 1] : [0]).map((leaf) => {
    const params = fitParamsToFurniture(
      { ...DEFAULT_BOARD_PARAMS, orientation: 'vertical' as const, thickness: options.thickness, width: double ? w / 2 : w, height: h },
      furniture,
    )
    const board: Board = {
      ...params,
      id: newId('front-board'),
      name: double ? `Front ${n} ${leaf === 0 ? 'L' : 'P'}` : `Front ${n}`,
      front: id,
      position: { x: box.min[0] + (double && leaf === 1 ? w / 2 : 0), y: box.min[1], z: Math.max(0, furniture.depth - options.thickness) },
    }
    return withFinish(board, { ...options.finish, thickness: options.thickness })
  })
  return {
    front: { id, covers, mount: options.mount, opening: options.opening, gapH: options.gapH, gapV: options.gapV, boards: leaves.map((b) => b.id) },
    boards: leaves,
  }
}

/** Fronts whose covered sections are gone (a divider removed …) – removed with their boards. */
export function pruneFronts(root: Section, fronts: Front[]): { fronts: Front[]; removedBoards: string[] } {
  const keep: Front[] = []
  const removedBoards: string[] = []
  for (const f of fronts) {
    if (frontCoverage(root, f.covers)) keep.push(f)
    else removedBoards.push(...f.boards)
  }
  return { fronts: keep, removedBoards }
}
