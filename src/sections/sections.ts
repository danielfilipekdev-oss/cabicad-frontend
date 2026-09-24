import { furnitureSize, type Furniture } from '../furniture/furniture.ts'
import {
  DEFAULT_BOARD_PARAMS,
  fitParamsToFurniture,
  type Board,
  type BoardOrientation,
  type BoardParams,
} from '../boards/board.ts'
import {
  AXIS_FACES,
  boardFaceValue,
  newConstraintId,
  oppositeFace,
  targetFaceValue,
  type AnchorConstraint,
  type AnchorTarget,
  type Axis,
  type Face,
} from '../layout/constraints.ts'
import { solveLayout } from '../layout/solver.ts'
import { withFinish, type BoardDefaults, type BoardFinish } from '../boards/finish.ts'
import { findRoleBoard, syncCarcassAnchors, type CarcassRelations, type CarcassRole } from '../carcass/carcass.ts'

/**
 * Shelves and partitions (półki i przedziały) – the second beginner-friendly layer on top of the core
 * boards + layout constraints (like the carcass, see `carcass/carcass.ts`).
 *
 * The inside of the furniture is a tree of SECTIONS (sekcje):
 *  - at first the whole furniture is ONE section (the root) – the space between the carcass boards
 *    (or the furniture walls where a carcass board is missing), from the back (plecy) to the front,
 *  - adding shelves (horizontal boards) or partitions (vertical boards) to a section splits it: N
 *    dividers → N + 1 child sections, each the space between two neighbouring dividers (or a divider and
 *    the edge of the parent section),
 *  - all dividers of one section are of the same kind, and a child section can only be split by the
 *    OTHER kind (a section between two shelves gets partitions, a section between two partitions gets
 *    shelves); the root can take either.
 *
 * No geometry of its own: a divider is an ordinary `Board` (`divider` set) placed only by ordinary joints
 * marked `preset` (see `sectionAnchorSpecs`), so the solver keeps the layout when the furniture or a
 * carcass board changes:
 *  - across the split axis (its thickness) the divider is joined on BOTH flat sides – to the previous
 *    divider / the section edge and to the next one – which the core treats as a centred board (see
 *    `centeredPairs`): every divider sits in the middle between its neighbours, so all the sub-sections
 *    of a section are equally big; the position can be changed per board in its joints (mm / %),
 *  - along the other two axes it is stretched between the section edges – except the front, which is
 *    joined to the front of the furniture with the section's default setback (`frontOffset`, 5 mm):
 *    the divider stands back from the front of the section. The setback is an ordinary joint offset, so
 *    it can be overridden per board in its joints ("Szczegóły").
 */
export type DividerKind = 'shelf' | 'partition'

export const DIVIDER_LABELS: Record<DividerKind, string> = { shelf: 'Półka', partition: 'Przedział' }
/** Plural (for "podzielona …: 2"). */
export const DIVIDER_PLURAL: Record<DividerKind, string> = { shelf: 'półkami', partition: 'przedziałami' }

export const DIVIDER_ORIENTATION: Record<DividerKind, BoardOrientation> = { shelf: 'horizontal', partition: 'side' }

/** Axis a divider splits its section along (= its thickness axis): shelves Y, partitions X. */
export const SPLIT_AXIS: Record<DividerKind, Axis> = { shelf: 1, partition: 0 }

export const otherKind = (k: DividerKind): DividerKind => (k === 'shelf' ? 'partition' : 'shelf')

/** Default setback [mm] of the dividers from the front of the section. */
export const DEFAULT_FRONT_OFFSET = 5
export const DEFAULT_DIVIDER_THICKNESS = 18

export interface Section {
  id: string
  /** Kind of the dividers splitting this section; null = not split (a leaf). */
  split: DividerKind | null
  /** Divider boards in order along the split axis (bottom → top / left → right). */
  dividers: string[]
  /** Sub-sections, `dividers.length + 1` of them (none for a leaf), in the same order. */
  children: Section[]
  /** Default setback [mm] of the dividers of this section from its front. */
  frontOffset: number
  /**
   * Board (model + thickness + grain) + edge banding of the new dividers of this section and of its sub-sections (unless they have
   * their own) – overrides the panel default; undefined = inherited (see `effectiveSectionFinish`).
   */
  finish?: BoardFinish
  /**
   * How the dividers are spread across the section (see `SectionLayout`); undefined = 'equal'.
   */
  layout?: SectionLayout
  /**
   * Automatic dividers (dodawanie automatyczne) – when set, the layout is 'auto' (see `AutoFill`).
   */
  auto?: AutoFill
}

/**
 * Automatic shelves / partitions of a section: every divider RESERVES `pitch` mm of the section – the
 * first one starts `pitch` from the bottom / left of the section, the next one `pitch` from the start of
 * the previous one, and so on as long as the whole divider fits (e.g. pitch 500: a 500 mm section – none,
 * 700 mm – one at 500, 1200 mm – at 500 and 1000). The dividers are ordinary ones: they can be added,
 * removed and moved (sizes in the panel / dragging) – but when the section GROWS, new ones are added
 * every `pitch` above the last one, and a divider that the top / right of a shrinking section runs into
 * is removed (`maintainAutoSections`, run by `applyStructure` after every layout).
 */
export interface AutoFill {
  kind: DividerKind
  /** Space [mm] one divider reserves (its thickness + the compartment below it). */
  pitch: number
  /** Thickness and finish of the added boards (taken when the option is switched on). */
  thickness: number
  finish: BoardFinish
  /** Size [mm] of the section at the last fill – new dividers are added only when it grows past it. */
  size: number
}

export const AUTO_PITCH_DEFAULT = 500
export const AUTO_PITCH_LIMITS = { min: 50, max: 5000 }

/**
 * Layout of the dividers of a section:
 *  - 'equal'  – every divider is centred between its neighbours (a centred pair of joints), so all the
 *               sub-sections are equally big, whatever the size of the section,
 *  - 'manual' – the same pair of joints, but in PERCENT: each divider sits at p % of the free space
 *               between its neighbours (p = size below / (size below + size above)), so the sizes of the
 *               sub-sections keep their PROPORTIONS when the furniture (or a carcass board) changes. The
 *               sizes are set in the panel or by dragging a divider in the scene.
 */
export type SectionLayout = 'equal' | 'manual' | 'auto'

/**
 *  - 'auto'   – automatic dividers (`AutoFill`): each divider hangs on the one below / left of it (or on
 *               the section edge) by ONE joint with the clear size of the compartment below it in mm, so
 *               the compartments keep their sizes and the last one takes the rest.
 */
export const sectionLayout = (s: Section): SectionLayout => (s.auto ? 'auto' : (s.layout ?? 'equal'))

export const ROOT_SECTION_ID = 'root'

export const createRootSection = (): Section => ({
  id: ROOT_SECTION_ID,
  split: null,
  dividers: [],
  children: [],
  frontOffset: DEFAULT_FRONT_OFFSET,
})

const roundMm = (v: number) => Number(v.toFixed(3)) || 0

let counter = 0
const newId = (prefix: string) => {
  counter += 1
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${prefix}-${Date.now()}-${counter}`
}

const leaf = (frontOffset: number): Section => ({ id: newId('section'), split: null, dividers: [], children: [], frontOffset })

// ---- tree helpers ----------------------------------------------------------------------------------

export function findSection(root: Section, id: string | null): Section | null {
  if (id === null) return null
  if (root.id === id) return root
  for (const c of root.children) {
    const f = findSection(c, id)
    if (f) return f
  }
  return null
}

/** Sections from the root down to `id` (empty when not found). */
export function sectionPath(root: Section, id: string): Section[] {
  if (root.id === id) return [root]
  for (const c of root.children) {
    const p = sectionPath(c, id)
    if (p.length) return [root, ...p]
  }
  return []
}

export const parentSection = (root: Section, id: string): Section | null => {
  const p = sectionPath(root, id)
  return p.length > 1 ? p[p.length - 2] : null
}

export function allSections(root: Section): Section[] {
  return [root, ...root.children.flatMap(allSections)]
}

/** All divider boards of the section and of its sub-sections. */
export function subtreeDividers(s: Section): string[] {
  return [...s.dividers, ...s.children.flatMap(subtreeDividers)]
}

/** Section a divider board belongs to (the one it splits). */
export function sectionOfDivider(root: Section, boardId: string): Section | null {
  return allSections(root).find((s) => s.dividers.includes(boardId)) ?? null
}

/** Replaces the section with the given id (immutably). */
function replaceSection(root: Section, id: string, fn: (s: Section) => Section): Section {
  if (root.id === id) return fn(root)
  return { ...root, children: root.children.map((c) => replaceSection(c, id, fn)) }
}

/**
 * Kinds of dividers that can be added to a section: the kind it is already split with, otherwise the
 * opposite of the parent's kind (between shelves → partitions, between partitions → shelves); the root
 * takes both.
 */
export function allowedKinds(root: Section, id: string): DividerKind[] {
  const s = findSection(root, id)
  if (!s) return []
  if (s.split) return [s.split]
  const parent = parentSection(root, id)
  return parent?.split ? [otherKind(parent.split)] : ['shelf', 'partition']
}

/** Why a kind cannot be added (for the tooltip), or null. */
export function addProblem(root: Section, id: string, kind: DividerKind): string | null {
  if (allowedKinds(root, id).includes(kind)) return null
  const s = findSection(root, id)
  if (s?.split) return `Ta sekcja jest już podzielona ${DIVIDER_PLURAL[s.split]} – można dodać tylko kolejne.`
  const parent = parentSection(root, id)
  return parent?.split === 'shelf'
    ? 'Sekcja między półkami – można ją podzielić tylko przedziałami.'
    : 'Sekcja między przedziałami – można ją podzielić tylko półkami.'
}

/**
 * Labels of all sections: the root = "Cały mebel", the others "Sekcja 2.1" – the index of the section
 * in its parent (1 = the bottom one between shelves / the left one between partitions), dot-separated
 * down the tree.
 */
export function sectionLabels(root: Section): Map<string, string> {
  const labels = new Map<string, string>([[root.id, 'Cały mebel']])
  const walk = (s: Section, path: string) =>
    s.children.forEach((c, i) => {
      const p = path ? `${path}.${i + 1}` : `${i + 1}`
      labels.set(c.id, `Sekcja ${p}`)
      walk(c, p)
    })
  walk(root, '')
  return labels
}

// ---- frames: the planes bounding every section --------------------------------------------------------

/** A plane bounding a section: a furniture wall or a face of a board. */
export interface PlaneRef {
  target: AnchorTarget
  /** Face of the board (or the furniture wall with that name). */
  face: Face
}

/** Per axis [min plane, max plane]. */
export type SectionFrame = [[PlaneRef, PlaneRef], [PlaneRef, PlaneRef], [PlaneRef, PlaneRef]]

const wall = (face: Face): PlaneRef => ({ target: { kind: 'furniture' }, face })
const boardPlane = (id: string, face: Face): PlaneRef => ({ target: { kind: 'board', id }, face })

/**
 * The root section: between the inner faces of the carcass boards present (sides, bottom, top, back),
 * the furniture walls where a carcass board is missing; the front is always the front of the furniture.
 */
export function rootFrame(boards: Board[]): SectionFrame {
  const inner = (role: CarcassRole, face: Face): PlaneRef => {
    const b = findRoleBoard(boards, role)
    return b ? boardPlane(b.id, oppositeFace(face)) : wall(face)
  }
  return [
    [inner('left', 'left'), inner('right', 'right')],
    [inner('bottom', 'bottom'), inner('top', 'top')],
    [inner('back', 'back'), wall('front')],
  ]
}

/** Frames of the sub-sections: the parent frame, cut along the split axis by the dividers. */
function childFrames(s: Section, frame: SectionFrame): SectionFrame[] {
  if (!s.split) return []
  const axis = SPLIT_AXIS[s.split]
  const [lo, hi] = AXIS_FACES[axis]
  const n = s.dividers.length
  return s.children.map((_, k) => {
    const f = frame.map((p) => [...p]) as SectionFrame
    f[axis] = [k === 0 ? frame[axis][0] : boardPlane(s.dividers[k - 1], hi), k === n ? frame[axis][1] : boardPlane(s.dividers[k], lo)]
    return f
  })
}

/** Frame of every section of the tree. */
export function sectionFrames(root: Section, boards: Board[]): Map<string, SectionFrame> {
  const frames = new Map<string, SectionFrame>()
  const walk = (s: Section, f: SectionFrame) => {
    frames.set(s.id, f)
    childFrames(s, f).forEach((cf, i) => walk(s.children[i], cf))
  }
  walk(root, rootFrame(boards))
  return frames
}

/** Box of a section in the current geometry [mm], or null when a bounding board is missing. */
export interface SectionBox {
  min: [number, number, number]
  max: [number, number, number]
}

export function frameBox(frame: SectionFrame, boards: Board[], furniture: Furniture): SectionBox | null {
  const v = frame.map(([a, b]) => [
    targetFaceValue(a.target, a.face, boards, furniture),
    targetFaceValue(b.target, b.face, boards, furniture),
  ])
  if (v.some(([a, b]) => a === null || b === null)) return null
  return { min: v.map(([a]) => a!) as [number, number, number], max: v.map(([, b]) => b!) as [number, number, number] }
}

export function sectionBoxes(root: Section, boards: Board[], furniture: Furniture): Map<string, SectionBox> {
  const boxes = new Map<string, SectionBox>()
  for (const [id, frame] of sectionFrames(root, boards)) {
    const box = frameBox(frame, boards, furniture)
    if (box) boxes.set(id, box)
  }
  return boxes
}

/**
 * The section clicked at the front of the furniture: the one containing the point (x, y) at `depth` of
 * the tree (0 = root) – or the deepest one on the way if the tree is shallower there.
 */
export function sectionAtPoint(root: Section, boxes: Map<string, SectionBox>, x: number, y: number, depth: number): Section {
  let s = root
  for (let d = 0; d < depth; d++) {
    const next = s.children.find((c) => {
      const b = boxes.get(c.id)
      return b && x >= b.min[0] && x <= b.max[0] && y >= b.min[1] && y <= b.max[1]
    })
    if (!next) break
    s = next
  }
  return s
}

// ---- joints of the dividers ------------------------------------------------------------------------

export interface SectionAnchorSpec {
  board: string
  face: Face
  target: AnchorTarget
  targetFace: Face
  /** Offset of a new joint (mm): the section setback for the front face, 0 otherwise. */
  offset: number
}

const spec = (board: string, face: Face, plane: PlaneRef, offset = 0): SectionAnchorSpec => ({
  board,
  face,
  target: plane.target,
  targetFace: plane.face,
  offset,
})

/** Joints that place all the dividers of the tree (see the module comment). */
export function sectionAnchorSpecs(root: Section, boards: Board[]): SectionAnchorSpec[] {
  const specs: SectionAnchorSpec[] = []
  const exists = (id: string) => boards.some((b) => b.id === id)

  const walk = (s: Section, frame: SectionFrame) => {
    if (s.split) {
      const axis = SPLIT_AXIS[s.split]
      const [lo, hi] = AXIS_FACES[axis]
      const other = (axis === 0 ? 1 : 0) as Axis
      const n = s.dividers.length
      s.dividers.forEach((id, i) => {
        if (!exists(id)) return
        // across the split axis: between the previous and the next divider – a centred pair (equal
        // layout: in the middle, manual: at a % of the free space between them – see `SectionLayout`);
        // auto layout: only on the previous one (the compartment below keeps its size in mm)
        specs.push(spec(id, lo, i === 0 ? frame[axis][0] : boardPlane(s.dividers[i - 1], hi)))
        if (sectionLayout(s) !== 'auto') specs.push(spec(id, hi, i === n - 1 ? frame[axis][1] : boardPlane(s.dividers[i + 1], lo)))
        // stretched across the section
        specs.push(spec(id, AXIS_FACES[other][0], frame[other][0]))
        specs.push(spec(id, AXIS_FACES[other][1], frame[other][1]))
        // depth: from the back of the section to its front, set back by the section default
        specs.push(spec(id, 'back', frame[2][0]))
        specs.push(spec(id, 'front', frame[2][1], s.frontOffset))
      })
    }
    childFrames(s, frame).forEach((cf, i) => walk(s.children[i], cf))
  }
  walk(root, rootFrame(boards))
  return specs
}

const sameTarget = (a: AnchorTarget, b: AnchorTarget) =>
  a.kind === b.kind && (a.kind === 'furniture' || a.id === (b as { id: string }).id)

const matches = (c: AnchorConstraint, s: SectionAnchorSpec) =>
  c.board === s.board && c.face === s.face && c.targetFace === s.targetFace && sameTarget(c.target, s.target)

/**
 * Brings the divider joints in line with the section tree (like `syncCarcassAnchors`): wanted joints are
 * kept with their offsets (a setback / position changed per board stays), faces joined by hand are left
 * alone, the others are removed / added. Joints of other boards are never touched.
 */
export function syncSectionAnchors(
  constraints: AnchorConstraint[],
  boards: Board[],
  root: Section,
  furniture?: Furniture,
): AnchorConstraint[] {
  const specs = sectionAnchorSpecs(root, boards)
  const dividerIds = new Set(boards.filter((b) => b.divider).map((b) => b.id))
  const result = constraints.filter((c) => !c.preset || !dividerIds.has(c.board) || specs.some((s) => matches(c, s)))
  // dividers of auto sections: a new joint keeps the divider where it is (the compartment below in mm)
  const autoLo = new Map<string, Face>()
  for (const sec of allSections(root)) if (sec.split && sectionLayout(sec) === 'auto') for (const d of sec.dividers) autoLo.set(d, AXIS_FACES[SPLIT_AXIS[sec.split]][0])
  for (const s of specs) {
    if (result.some((c) => c.board === s.board && c.face === s.face)) continue
    let offset = s.offset
    const board = boards.find((b) => b.id === s.board)
    if (furniture && board && autoLo.get(s.board) === s.face) {
      const plane = targetFaceValue(s.target, s.targetFace, boards, furniture)
      if (plane !== null) offset = Math.max(0, roundMm(boardFaceValue(board, s.face) - plane))
    }
    result.push({
      id: newConstraintId(),
      board: s.board,
      face: s.face,
      target: s.target,
      targetFace: s.targetFace,
      offset,
      preset: true,
    })
  }
  return furniture ? repairManualPairs(result, boards, root, furniture) : result
}

/** Number of divider joints missing (e.g. removed by hand). */
export function missingSectionAnchors(constraints: AnchorConstraint[], boards: Board[], root: Section): number {
  return sectionAnchorSpecs(root, boards).filter((s) => !constraints.some((c) => c.board === s.board && c.face === s.face)).length
}

/**
 * Setback of a divider from the front of its section as it is now, and whether it differs from the
 * section default (changed per board in its joints).
 */
export function dividerFrontOffset(
  constraints: AnchorConstraint[],
  section: Section,
  boardId: string,
): { offset: number | null; unit: string; overridden: boolean } {
  const c = constraints.find((o) => o.board === boardId && o.face === 'front')
  if (!c) return { offset: null, unit: 'mm', overridden: true }
  const unit = c.unit ?? 'mm'
  const generated = c.preset && c.target.kind === 'furniture' && c.targetFace === 'front'
  // the part set back by the fronts (`recess`) is not the section's setback
  const own = Number((c.offset - (c.recess ?? 0)).toFixed(3))
  return { offset: own, unit, overridden: !generated || unit !== 'mm' || own !== section.frontOffset }
}

// ---- editing the tree ------------------------------------------------------------------------------

export interface StructureState {
  boards: Board[]
  constraints: AnchorConstraint[]
  sections: Section
}

function nextDividerName(kind: DividerKind, boards: Board[]): string {
  const re = new RegExp(`^${DIVIDER_LABELS[kind]} (\\d+)$`)
  const max = boards.reduce((m, b) => {
    const n = re.exec(b.name)
    return n ? Math.max(m, Number(n[1])) : m
  }, 0)
  return `${DIVIDER_LABELS[kind]} ${max + 1}`
}

/** A new divider board roughly in the middle of the section – its exact place comes from its joints. */
export function createDividerBoard(
  kind: DividerKind,
  options: BoardDefaults,
  box: SectionBox | null,
  furniture: Furniture,
  boards: Board[],
): Board {
  const thickness = options.thickness
  const F = furnitureSize(furniture)
  const b = box ?? { min: [0, 0, 0] as [number, number, number], max: F }
  const size = [0, 1, 2].map((i) => Math.max(1, b.max[i] - b.min[i]))
  const orientation = DIVIDER_ORIENTATION[kind]
  const base: BoardParams = {
    ...DEFAULT_BOARD_PARAMS,
    orientation,
    thickness,
    // shelf: width along X, height = depth (Z); partition: width = depth (Z), height along Y
    width: kind === 'shelf' ? size[0] : size[2],
    height: kind === 'shelf' ? size[2] : size[1],
  }
  const params = fitParamsToFurniture(base, furniture)
  const axis = SPLIT_AXIS[kind]
  const center = (i: number) => Math.max(0, Math.min(F[i] - (i === axis ? thickness : 0), (b.min[i] + b.max[i] - (i === axis ? thickness : 0)) / 2))
  const position = {
    x: kind === 'partition' ? center(0) : b.min[0],
    y: kind === 'shelf' ? center(1) : b.min[1],
    z: b.min[2],
  }
  return withFinish({ ...params, id: newId('divider'), name: nextDividerName(kind, boards), divider: kind, position }, options)
}

/**
 * Adds one divider of `kind` to the section (only if allowed – see `allowedKinds`): a leaf gets its first
 * divider and two sub-sections, a split section one more divider at the end (top / right) and one more
 * sub-section. The new sub-sections take the section's default setback. The board gets the thickness of
 * `defaults` and the finish of the section (its own / inherited override – `effectiveSectionFinish`),
 * else the finish of `defaults`. Returns the new board too.
 */
export function addDivider(
  state: StructureState,
  sectionId: string,
  kind: DividerKind,
  options: BoardDefaults,
  furniture: Furniture,
): StructureState & { added: Board | null } {
  const s = findSection(state.sections, sectionId)
  if (!s || !allowedKinds(state.sections, sectionId).includes(kind)) return { ...state, added: null }
  const boxes = sectionBoxes(state.sections, state.boards, furniture)
  // manual layout: the new divider goes into the middle of the last sub-section (the others stay)
  const lastChild = s.children[s.children.length - 1]
  const box = (s.split && sectionLayout(s) !== 'equal' && lastChild ? boxes.get(lastChild.id) : boxes.get(sectionId)) ?? null
  const finish = effectiveSectionFinish(state.sections, sectionId)?.finish ?? options
  const board = createDividerBoard(kind, { ...options, materialId: finish.materialId, thickness: finish.thickness, edgeBanding: finish.edgeBanding, grain: finish.grain }, box, furniture, state.boards)
  const sections = replaceSection(state.sections, sectionId, (sec) => ({
    ...sec,
    split: kind,
    dividers: [...sec.dividers, board.id],
    children: sec.children.length ? [...sec.children, leaf(sec.frontOffset)] : [leaf(sec.frontOffset), leaf(sec.frontOffset)],
  }))
  return { boards: [...state.boards, board], constraints: state.constraints, sections, added: board }
}

/**
 * Removes a divider from the tree. The two sub-sections around it merge into one: the one that is split
 * further is kept (it now spans both), the other one's dividers are removed too (if both are split, the
 * upper / right one goes). When the last divider goes, the section becomes a leaf – or takes over the
 * kept sub-section's dividers, if that kind is allowed there (otherwise they are removed as well).
 * Returns the new tree and ALL divider boards to remove (the given one included).
 */
export function removeDividerFromTree(root: Section, boardId: string): { sections: Section; removed: string[] } {
  const s = sectionOfDivider(root, boardId)
  if (!s) return { sections: root, removed: [] }
  const i = s.dividers.indexOf(boardId)
  const a = s.children[i]
  const b = s.children[i + 1]
  const [keep, drop] = a.split || !b.split ? [a, b] : [b, a]
  const removed = [boardId, ...subtreeDividers(drop)]
  const dividers = s.dividers.filter((id) => id !== boardId)
  const children = s.children.filter((c) => c !== drop)
  let next: Section
  if (dividers.length > 0) {
    next = { ...s, dividers, children }
  } else {
    const parent = parentSection(root, s.id)
    const allowed = !parent?.split || (keep.split && keep.split !== parent.split)
    if (keep.split && allowed) {
      next = { ...s, split: keep.split, dividers: keep.dividers, children: keep.children }
    } else {
      removed.push(...subtreeDividers(keep))
      next = { ...s, split: null, dividers: [], children: [] }
    }
  }
  return { sections: replaceSection(root, s.id, () => next), removed }
}

// ---- finish (board model + edge banding) --------------------------------------------------------------

/**
 * Finish of the new dividers of a section: its own override, else the nearest ancestor's, else null
 * (= the panel default). Returns the section it comes from too.
 */
export function effectiveSectionFinish(root: Section, id: string): { finish: BoardFinish; from: Section } | null {
  const path = sectionPath(root, id)
  for (let i = path.length - 1; i >= 0; i--) {
    const f = path[i].finish
    if (f) return { finish: f, from: path[i] }
  }
  return null
}

/** Sets (or with null removes) the finish override of a section. */
export function setSectionFinish(root: Section, id: string, finish: BoardFinish | null): Section {
  return replaceSection(root, id, (s) => {
    const next = { ...s }
    if (finish) next.finish = finish
    else delete next.finish
    return next
  })
}

/**
 * Dividers that take their finish from this section: its own and those of the sub-sections that do not
 * have an override of their own (the walk stops at a sub-section with its own finish).
 */
export function dividersUsingSectionFinish(root: Section, id: string): string[] {
  const s = findSection(root, id)
  if (!s) return []
  const walk = (sec: Section): string[] => [...sec.dividers, ...sec.children.filter((c) => !c.finish).flatMap(walk)]
  return walk(s)
}

/** Removes all dividers of the section and its sub-sections – the section becomes a leaf again. */
export function clearSection(root: Section, id: string): { sections: Section; removed: string[] } {
  const s = findSection(root, id)
  if (!s) return { sections: root, removed: [] }
  return {
    sections: replaceSection(root, id, (sec) => ({ ...sec, split: null, dividers: [], children: [] })),
    removed: subtreeDividers(s),
  }
}

/** Drops dividers whose board no longer exists (defensive – every removal goes through the tree). */
export function pruneSections(root: Section, boards: Board[]): Section {
  let sections = root
  for (const id of allSections(root).flatMap((s) => s.dividers)) {
    if (!boards.some((b) => b.id === id)) sections = removeDividerFromTree(sections, id).sections
  }
  return sections
}

/**
 * New default setback of a section. It is passed on to the sub-sections that still had the old value
 * (they inherited it), and every divider front joint of those sections that still had the old default
 * is moved to the new one – a setback changed per board keeps its value.
 */
export function setSectionFrontOffset(
  root: Section,
  constraints: AnchorConstraint[],
  id: string,
  value: number,
): { sections: Section; constraints: AnchorConstraint[] } {
  const s = findSection(root, id)
  if (!s) return { sections: root, constraints }
  const old = s.frontOffset
  const changed = new Set<string>()
  const update = (sec: Section, top: boolean): Section => {
    if (!top && sec.frontOffset !== old) return sec
    for (const d of sec.dividers) changed.add(d)
    return { ...sec, frontOffset: value, children: sec.children.map((c) => update(c, false)) }
  }
  const sections = replaceSection(root, id, (sec) => update(sec, true))
  const cs = constraints.map((c) =>
    changed.has(c.board) && c.preset && c.face === 'front' && (c.unit ?? 'mm') === 'mm' && Number((c.offset - (c.recess ?? 0)).toFixed(3)) === old
      ? { ...c, offset: value + (c.recess ?? 0) }
      : c,
  )
  return { sections, constraints: cs }
}

// ---- layout of the dividers (equal / manual, dragging) ---------------------------------------------------

/**
 * Sizes [mm] of the sub-sections of a split section along its split axis (the clear space between the
 * neighbouring dividers / the section edges), bottom → top / left → right, from the current geometry.
 */
export function compartmentSizes(root: Section, id: string, boards: Board[], furniture: Furniture): number[] {
  const s = findSection(root, id)
  if (!s?.split) return []
  const boxes = sectionBoxes(root, boards, furniture)
  const axis = SPLIT_AXIS[s.split]
  return s.children.map((c) => {
    const b = boxes.get(c.id)
    return b ? roundMm(b.max[axis] - b.min[axis]) : 0
  })
}

type LayoutState = Pick<StructureState, 'sections' | 'constraints' | 'boards'>
type LayoutResult = { sections: Section; constraints: AnchorConstraint[] }

const roundPct = (v: number) => Number(v.toFixed(6)) || 0

/** p [%] of a divider between its neighbours from the sizes of the sub-sections below / above it. */
const pairPercent = (below: number, above: number) => (below + above > 0 ? roundPct((below / (below + above)) * 100) : 50)

/**
 * Sets the pair joints (both faces across the split axis) of every divider of a section: 'equal' → 0 mm
 * (centred), 'manual' → the % that reproduces the given sub-section sizes (see `SectionLayout`). Only
 * generated joints are changed; `only` limits it to some dividers.
 */
function setPairOffsets(
  constraints: AnchorConstraint[],
  s: Section,
  layout: SectionLayout,
  sizes: number[],
  only?: Set<string>,
): AnchorConstraint[] {
  const [lo, hi] = AXIS_FACES[SPLIT_AXIS[s.split!]]
  const pct = new Map(s.dividers.map((d, i) => [d, pairPercent(sizes[i] ?? 0, sizes[i + 1] ?? 0)]))
  return constraints.map((c) => {
    if (!c.preset || (c.face !== lo && c.face !== hi) || !pct.has(c.board) || (only && !only.has(c.board))) return c
    return layout === 'manual' ? { ...c, unit: '%' as const, offset: pct.get(c.board)! } : { ...c, unit: undefined, offset: 0 }
  })
}

/**
 * After a structural change (a divider added / removed) some pair joints of a MANUAL section are new
 * (0 mm = centred) next to % ones. Such dividers get their % from the current geometry, so nothing moves.
 */
function repairManualPairs(constraints: AnchorConstraint[], boards: Board[], root: Section, furniture: Furniture): AnchorConstraint[] {
  let cs = constraints
  for (const s of allSections(root)) {
    if (!s.split || sectionLayout(s) !== 'manual') continue
    const [lo, hi] = AXIS_FACES[SPLIT_AXIS[s.split]]
    const broken = new Set(
      s.dividers.filter((d) => {
        const pair = cs.filter((c) => c.board === d && c.preset && (c.face === lo || c.face === hi))
        return pair.length === 2 && pair.some((c) => c.unit !== '%')
      }),
    )
    if (broken.size) cs = setPairOffsets(cs, s, 'manual', compartmentSizes(root, s.id, boards, furniture), broken)
  }
  return cs
}

/**
 * Switches the layout of a section. To 'manual' the dividers stay where they are (their pair joints get
 * the % of the current sizes); to 'equal' they are centred again. Run `applyStructure` afterwards.
 */
export function setSectionLayout(state: LayoutState, id: string, layout: SectionLayout, furniture: Furniture): LayoutResult {
  const s = findSection(state.sections, id)
  if (!s?.split || sectionLayout(s) === layout || layout === 'auto') return { sections: state.sections, constraints: state.constraints }
  return {
    // equal / manual switch the automatic dividers off (the dividers stay)
    sections: replaceSection(state.sections, id, (sec) => ({ ...sec, layout, auto: undefined })),
    constraints: setPairOffsets(state.constraints, s, layout, compartmentSizes(state.sections, id, state.boards, furniture)),
  }
}

/**
 * Joints across the split axis of an AUTO section: the one on the previous divider / section edge gets
 * the clear size of the compartment below (`gaps[i]` mm, the % unit dropped).
 */
function setGapOffsets(constraints: AnchorConstraint[], s: Section, gaps: number[]): AnchorConstraint[] {
  const lo = AXIS_FACES[SPLIT_AXIS[s.split!]][0]
  const gap = new Map(s.dividers.map((d, i) => [d, roundMm(Math.max(0, gaps[i] ?? 0))]))
  return constraints.map((c) => (c.preset && c.face === lo && gap.has(c.board) ? { ...c, unit: undefined, offset: gap.get(c.board)! } : c))
}

/** Manual layout with the given sub-section sizes (their proportions are then kept); an auto section stays auto (mm). */
function withSizes(state: LayoutState, s: Section, sizes: number[]): LayoutResult {
  if (sectionLayout(s) === 'auto') return { sections: state.sections, constraints: setGapOffsets(state.constraints, s, sizes) }
  return {
    sections: replaceSection(state.sections, s.id, (sec) => ({ ...sec, layout: 'manual' })),
    constraints: setPairOffsets(state.constraints, s, 'manual', sizes),
  }
}

// ---- automatic dividers ------------------------------------------------------------------------------

/**
 * Switches the automatic dividers of a section on (or changes their pitch) / off:
 *  - on: the dividers the section already has are spread every `pitch` (first `pitch` from the start,
 *    then `pitch` from the start of the previous one), the missing ones are added and the ones that do
 *    not fit are removed by `maintainAutoSections` (run by `applyStructure`),
 *  - off: the dividers stay where they are, the layout becomes manual (their proportions are kept).
 * The kind must be allowed in the section (the one it is split with).
 */
export function setSectionAuto(
  state: LayoutState,
  id: string,
  auto: Omit<AutoFill, 'size'> | null,
  furniture: Furniture,
): LayoutResult {
  const s = findSection(state.sections, id)
  if (!s) return { sections: state.sections, constraints: state.constraints }
  if (!auto) {
    if (!s.auto) return { sections: state.sections, constraints: state.constraints }
    const sizes = compartmentSizes(state.sections, id, state.boards, furniture)
    return {
      sections: replaceSection(state.sections, id, (sec) => ({ ...sec, auto: undefined, layout: 'manual' })),
      constraints: s.split ? setPairOffsets(state.constraints, s, 'manual', sizes) : state.constraints,
    }
  }
  if (!allowedKinds(state.sections, id).includes(auto.kind)) return { sections: state.sections, constraints: state.constraints }
  const sections = replaceSection(state.sections, id, (sec) => ({ ...sec, auto: { ...auto, size: 0 } }))
  if (!s.split) return { sections, constraints: state.constraints }
  // the pattern: compartment below the first divider = pitch, below the others = pitch − previous thickness
  const thick = (d: string) => state.boards.find((b) => b.id === d)?.thickness ?? auto.thickness
  const gaps = s.dividers.map((_, i) => (i === 0 ? auto.pitch : auto.pitch - thick(s.dividers[i - 1])))
  return { sections, constraints: setGapOffsets(state.constraints, s, gaps) }
}

/**
 * Dividers that go away by themselves when the furniture shrinks along `axis`: those of the auto sections
 * split along that axis (with everything inside their sub-sections) – they do not limit the minimum
 * size of the furniture.
 */
export function autoRemovableDividers(root: Section, axis: Axis): Set<string> {
  const ids = new Set<string>()
  for (const s of allSections(root)) {
    if (!s.auto || !s.split || SPLIT_AXIS[s.split] !== axis) continue
    for (const id of subtreeDividers(s)) ids.add(id)
  }
  return ids
}

/**
 * Keeps the automatic dividers of every auto section in line with its CURRENT size (the boards must be
 * solved): dividers the top / right edge of the section runs into are removed (with what they bound),
 * and when the section grew past the size of the last fill, new dividers are added every `pitch` above
 * the last one as long as they fit. `changed` = boards were added / removed (solve again).
 */
export function maintainAutoSections(
  state: StructureState,
  furniture: Furniture,
): StructureState & { changed: boolean; removed: string[] } {
  let { sections, boards, constraints } = state
  const removed: string[] = []
  let changed = false
  const EPS = 0.01
  for (const start of allSections(state.sections)) {
    const s0 = findSection(sections, start.id)
    if (!s0?.auto) continue
    const auto = s0.auto
    if (s0.split && s0.split !== auto.kind) continue
    if (!allowedKinds(sections, s0.id).includes(auto.kind)) continue
    const box = sectionBoxes(sections, boards, furniture).get(s0.id)
    if (!box) continue
    const axis = SPLIT_AXIS[auto.kind]
    const [lo, hi] = AXIS_FACES[axis]
    const min = box.min[axis]
    const max = box.max[axis]
    // 1) the edge of the section runs into a divider → it goes (from the top / right)
    for (;;) {
      const s = findSection(sections, s0.id)!
      const last = s.dividers[s.dividers.length - 1]
      const b = last ? boards.find((o) => o.id === last) : undefined
      if (!b || boardFaceValue(b, hi) <= max + EPS) break
      const r = removeDividerFromTree(sections, last)
      sections = r.sections
      const gone = new Set(r.removed)
      removed.push(...r.removed)
      boards = boards.filter((o) => !gone.has(o.id))
      constraints = constraints.filter((c) => !gone.has(c.board) && !(c.target.kind === 'board' && gone.has(c.target.id)))
      changed = true
    }
    // 2) the section grew → new dividers every `pitch` above the last one, as long as they fit
    const size = roundMm(max - min)
    if (size > auto.size + EPS) {
      for (;;) {
        const s = findSection(sections, s0.id)!
        const last = s.dividers[s.dividers.length - 1]
        const lb = last ? boards.find((o) => o.id === last) : undefined
        const at = lb ? boardFaceValue(lb, lo) + auto.pitch : min + auto.pitch
        if (at + auto.thickness > max + EPS) break
        const board = createDividerBoard(
          auto.kind,
          { ...auto.finish, thickness: auto.thickness },
          box,
          furniture,
          boards,
        )
        const key = axis === 0 ? 'x' : 'y'
        const placed = { ...board, position: { ...board.position, [key]: roundMm(at) } }
        boards = [...boards, placed]
        sections = replaceSection(sections, s.id, (sec) => ({
          ...sec,
          split: auto.kind,
          dividers: [...sec.dividers, placed.id],
          children: sec.children.length ? [...sec.children, leaf(sec.frontOffset)] : [leaf(sec.frontOffset), leaf(sec.frontOffset)],
        }))
        changed = true
      }
    }
    if (size !== auto.size) sections = replaceSection(sections, s0.id, (sec) => (sec.auto ? { ...sec, auto: { ...sec.auto, size } } : sec))
  }
  return { sections, boards, constraints, changed, removed }
}

/**
 * Sets the size of sub-section `index` (not the last one – it takes the rest): the divider above / right
 * of it moves, the sub-sections after it keep their sizes. Switches the section to 'manual'. The value
 * is limited to 0 … its size + the size of the last sub-section.
 */
export function setCompartmentSize(state: LayoutState, id: string, index: number, value: number, furniture: Furniture): LayoutResult {
  const s = findSection(state.sections, id)
  if (!s?.split || index < 0 || index >= s.dividers.length) return { sections: state.sections, constraints: state.constraints }
  const sizes = compartmentSizes(state.sections, id, state.boards, furniture)
  const last = sizes.length - 1
  const v = Math.max(0, Math.min(value, sizes[index] + sizes[last]))
  const next = [...sizes]
  next[last] = roundMm(sizes[last] - (v - sizes[index]))
  next[index] = v
  return withSizes(state, s, next)
}

/**
 * Drags a divider so that its lower / left face is at `lo` [mm, along the split axis]: the sub-section
 * below grows / shrinks and the one above shrinks / grows – the other dividers stay. Switches the section
 * to 'manual'. Limited to the two sub-sections.
 */
export function moveDivider(state: LayoutState, boardId: string, lo: number, furniture: Furniture): LayoutResult {
  const s = sectionOfDivider(state.sections, boardId)
  const board = state.boards.find((b) => b.id === boardId)
  if (!s?.split || !board) return { sections: state.sections, constraints: state.constraints }
  const i = s.dividers.indexOf(boardId)
  const sizes = compartmentSizes(state.sections, s.id, state.boards, furniture)
  const current = boardFaceValue(board, AXIS_FACES[SPLIT_AXIS[s.split]][0])
  const delta = Math.max(-sizes[i], Math.min(sizes[i + 1], lo - current))
  const next = [...sizes]
  next[i] = roundMm(sizes[i] + delta)
  next[i + 1] = roundMm(sizes[i + 1] - delta)
  return withSizes(state, s, next)
}

// ---- everything together ---------------------------------------------------------------------------

/**
 * Regenerates the generated joints (carcass, then shelves / partitions – their frames depend on the
 * carcass) and solves the layout.
 */
export function applyStructure(
  furniture: Furniture,
  boards: Board[],
  constraints: AnchorConstraint[],
  carcass: CarcassRelations,
  sections: Section,
  pinnedId?: string,
): { boards: Board[]; constraints: AnchorConstraint[] } {
  let cs = syncCarcassAnchors(constraints, boards, furniture, carcass)
  cs = syncSectionAnchors(cs, boards, sections, furniture)
  return { constraints: cs, boards: solveLayout(furniture, boards, cs, pinnedId).boards }
}
