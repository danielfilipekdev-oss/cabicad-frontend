import { furnitureSize, type Furniture } from '../furniture/furniture.ts'
import {
  DEFAULT_BOARD_PARAMS,
  fitParamsToFurniture,
  type Board,
  type BoardOrientation,
  type GrainDirection,
  type BoardParams,
} from '../boards/board.ts'
import {
  FACES,
  createPullingAnchor,
  faceAxis,
  oppositeFace,
  type AnchorConstraint,
  type AnchorTarget,
  type Face,
} from '../layout/constraints.ts'
import { solveLayout } from '../layout/solver.ts'
import type { EdgeBanding } from '../boards/edgeBanding.ts'

/**
 * Predefined carcass boards (płyty korpusu) – a beginner-friendly layer ON TOP of the core board +
 * layout-constraint system. Nothing here has its own geometry code: a carcass board is an ordinary
 * `Board` (with a `role`) and its place in the furniture is expressed only with ordinary anchors
 * (`AnchorConstraint`, marked `preset`), which the Cassowary solver (`solver.ts`) turns into positions
 * and sizes – so the carcass follows the furniture size, a changed thickness etc. exactly like boards
 * joined by hand, and every joint can still be edited in the panel.
 *
 * Roles: dach (top), podłoga (bottom), lewy / prawy bok (sides), plecy (back) – at most one board each.
 *
 * Relations: every pair of neighbouring carcass boards meets at a corner, and one of the two COVERS the
 * other (przykrywa – runs through to the furniture wall, the other one butts against its inner face):
 *   dach nałożony na boki  = top covers the sides   (the sides stand under the top),
 *   dach między bokami     = the sides cover the top (the sides run to the full height),
 *   plecy między bokami    = the sides cover the back, plecy nałożone = the back covers the sides, …
 * The relation of a pair is stored ONCE (`CarcassRelations`), so "dach między bokami" and "bok przykrywa
 * dach" are the same setting seen from the two boards.
 *
 * Joints (see `presetAnchorSpecs`), for every carcass board and every face except the inner face of its
 * thickness (that one follows from the thickness):
 *   - the neighbour in the direction of the face exists and covers the board → the face is glued to the
 *     neighbour's inner face (offset 0),
 *   - otherwise → the face is glued to the furniture wall (the front face always).
 * So every carcass board is fully determined: it lies against its own wall and stretches between the
 * walls / neighbours on the two other axes.
 */
export type CarcassRole = 'top' | 'bottom' | 'left' | 'right' | 'back'

export const CARCASS_ROLES: CarcassRole[] = ['top', 'bottom', 'left', 'right', 'back']

export const CARCASS_LABELS: Record<CarcassRole, string> = {
  top: 'Dach',
  bottom: 'Podłoga',
  left: 'Lewy bok',
  right: 'Prawy bok',
  back: 'Plecy',
}

/** Name of the role in the genitive / accusative-like form used in sentences ("… przykrywa dach"). */
const ROLE_OBJECT: Record<CarcassRole, string> = {
  top: 'dach',
  bottom: 'podłogę',
  left: 'lewy bok',
  right: 'prawy bok',
  back: 'plecy',
}

export const CARCASS_ORIENTATION: Record<CarcassRole, BoardOrientation> = {
  top: 'horizontal',
  bottom: 'horizontal',
  left: 'side',
  right: 'side',
  back: 'vertical',
}

/** Furniture wall the board lies against = its outer face (on its thickness axis). */
export const CARCASS_WALL: Record<CarcassRole, Face> = {
  top: 'top',
  bottom: 'bottom',
  left: 'left',
  right: 'right',
  back: 'back',
}

/** Carcass role lying at the furniture wall `face` (front → none – there is no front board). */
export function roleAtFace(face: Face): CarcassRole | null {
  return CARCASS_ROLES.find((r) => CARCASS_WALL[r] === face) ?? null
}

/** Pairs of carcass boards that meet at a corner (the top and the bottom / the two sides never do). */
export type CarcassPair =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'back-left'
  | 'back-right'
  | 'back-top'
  | 'back-bottom'

export const CARCASS_PAIRS: CarcassPair[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'back-left',
  'back-right',
  'back-top',
  'back-bottom',
]

/** For every pair: the role that COVERS the other one (runs through to the wall). */
export type CarcassRelations = Record<CarcassPair, CarcassRole>

/**
 * Defaults:
 *  - dach    – przykrywa boki, przykrywa plecy,
 *  - podłoga – między bokami, przykrywa plecy,
 *  - plecy   – między bokami, pod dachem, nad podłogą,
 *  - boki    – przykrywają podłogę, pod dachem, przykrywają plecy.
 */
export const DEFAULT_CARCASS_RELATIONS: CarcassRelations = {
  'top-left': 'top',
  'top-right': 'top',
  'bottom-left': 'left',
  'bottom-right': 'right',
  'back-left': 'left',
  'back-right': 'right',
  'back-top': 'top',
  'back-bottom': 'bottom',
}

/** The pair of the two roles, or null when they never meet. */
export function pairOf(a: CarcassRole, b: CarcassRole): CarcassPair | null {
  return CARCASS_PAIRS.find((p) => p === `${a}-${b}` || p === `${b}-${a}`) ?? null
}

/** Does `a` cover `b`? (false when they are not neighbours) */
export function covers(relations: CarcassRelations, a: CarcassRole, b: CarcassRole): boolean {
  const pair = pairOf(a, b)
  return pair !== null && relations[pair] === a
}

/** Sets `a` to cover `b` (no change when they are not neighbours). */
export function setCovers(relations: CarcassRelations, a: CarcassRole, b: CarcassRole): CarcassRelations {
  const pair = pairOf(a, b)
  return pair ? { ...relations, [pair]: a } : relations
}

/** Neighbours of a role in the order shown in the panel. */
export function carcassNeighbors(role: CarcassRole): CarcassRole[] {
  return CARCASS_ROLES.filter((r) => r !== role && pairOf(role, r) !== null)
}

/**
 * Labels of the two options of a relation seen from `role` towards `neighbor`:
 * [role covers neighbour, neighbour covers role]. Written for a beginner – where the boards end up.
 */
const RELATION_LABELS: Partial<Record<`${CarcassRole}-${CarcassRole}`, [string, string]>> = {
  'top-left': ['Nałożony na lewy bok', 'Między bokami'],
  'top-right': ['Nałożony na prawy bok', 'Między bokami'],
  'bottom-left': ['Pod lewym bokiem', 'Między bokami'],
  'bottom-right': ['Pod prawym bokiem', 'Między bokami'],
  'top-back': ['Przykrywa plecy (plecy pod dachem)', 'Plecy na całą wysokość (dach przed plecami)'],
  'bottom-back': ['Przykrywa plecy (plecy nad podłogą)', 'Plecy do samego dołu (podłoga przed plecami)'],
  'back-left': ['Nałożone na lewy bok (od tyłu)', 'Między bokami'],
  'back-right': ['Nałożone na prawy bok (od tyłu)', 'Między bokami'],
  'back-top': ['Przykrywają dach (do samej góry)', 'Pod dachem'],
  'back-bottom': ['Przykrywają podłogę (do samego dołu)', 'Nad podłogą'],
  'left-top': ['Przykrywa dach (dach między bokami)', 'Pod dachem'],
  'right-top': ['Przykrywa dach (dach między bokami)', 'Pod dachem'],
  'left-bottom': ['Przykrywa podłogę (podłoga między bokami)', 'Stoi na podłodze'],
  'right-bottom': ['Przykrywa podłogę (podłoga między bokami)', 'Stoi na podłodze'],
  'left-back': ['Przykrywa plecy (plecy między bokami)', 'Plecy nałożone na bok'],
  'right-back': ['Przykrywa plecy (plecy między bokami)', 'Plecy nałożone na bok'],
}

export function relationLabels(role: CarcassRole, neighbor: CarcassRole): [string, string] {
  return (
    RELATION_LABELS[`${role}-${neighbor}`] ?? [
      `Przykrywa ${ROLE_OBJECT[neighbor]}`,
      `${CARCASS_LABELS[neighbor]} przykrywa ${ROLE_OBJECT[role]}`,
    ]
  )
}

/** Short summary of a pair for lists, e.g. "dach przykrywa lewy bok". */
export function relationSummary(relations: CarcassRelations, pair: CarcassPair): string {
  const [a, b] = pair.split('-') as [CarcassRole, CarcassRole]
  const winner = relations[pair]
  const loser = winner === a ? b : a
  return `${CARCASS_LABELS[winner].toLowerCase()} przykrywa ${ROLE_OBJECT[loser]}`
}

export const findRoleBoard = (boards: Board[], role: CarcassRole): Board | undefined => boards.find((b) => b.role === role)

// ---- joints ------------------------------------------------------------------------------------------

/** A joint a carcass board should have (without offset – carcass joints pull the board, offset 0). */
export interface PresetAnchorSpec {
  board: string
  face: Face
  target: AnchorTarget
  targetFace: Face
}

const sameTarget = (a: AnchorTarget, b: AnchorTarget) =>
  a.kind === b.kind && (a.kind === 'furniture' || a.id === (b as { id: string }).id)

const matchesSpec = (c: AnchorConstraint, s: PresetAnchorSpec) =>
  c.board === s.board && c.face === s.face && c.targetFace === s.targetFace && sameTarget(c.target, s.target)

/** Joints that place all carcass boards according to the relations (see the module comment). */
export function presetAnchorSpecs(boards: Board[], relations: CarcassRelations): PresetAnchorSpec[] {
  const specs: PresetAnchorSpec[] = []
  for (const b of boards) {
    const role = b.role
    if (!role) continue
    const wall = CARCASS_WALL[role]
    const thicknessAxis = faceAxis(wall)
    for (const face of FACES) {
      // the inner face of the thickness follows from the thickness itself
      if (faceAxis(face) === thicknessAxis && face !== wall) continue
      const neighborRole = roleAtFace(face)
      const neighbor =
        neighborRole && neighborRole !== role && covers(relations, neighborRole, role)
          ? findRoleBoard(boards, neighborRole)
          : undefined
      specs.push(
        neighbor
          ? { board: b.id, face, target: { kind: 'board', id: neighbor.id }, targetFace: oppositeFace(face) }
          : { board: b.id, face, target: { kind: 'furniture' }, targetFace: face },
      )
    }
  }
  return specs
}

/**
 * Brings the carcass joints in line with the carcass boards present and their relations:
 *  - a carcass joint that is still wanted is kept as it is (with the offset the user may have changed),
 *  - a face the user joined by hand (a non-preset joint, e.g. a chain in the scene) is left alone,
 *  - carcass joints no longer wanted are removed, missing ones are added (pulling – offset 0).
 * Joints of free boards are never touched.
 */
export function syncCarcassAnchors(
  constraints: AnchorConstraint[],
  boards: Board[],
  furniture: Furniture,
  relations: CarcassRelations,
): AnchorConstraint[] {
  const specs = presetAnchorSpecs(boards, relations)
  // only the generated joints of CARCASS boards are managed here (shelves / partitions have their own)
  const carcassIds = new Set(boards.filter((b) => b.role).map((b) => b.id))
  const result = constraints.filter((c) => !c.preset || !carcassIds.has(c.board) || specs.some((s) => matchesSpec(c, s)))
  for (const s of specs) {
    if (result.some((c) => c.board === s.board && c.face === s.face)) continue
    const board = boards.find((b) => b.id === s.board)!
    const anchor = createPullingAnchor(board, s.face, s.target, s.targetFace, boards, furniture)
    // no "restore" snapshot: the board was only just placed by these joints – removing one leaves it be
    result.push({ ...anchor, restore: undefined, preset: true })
  }
  return result
}

/** Number of carcass joints missing (e.g. removed by hand) – faces joined by hand count as present. */
export function missingCarcassAnchors(constraints: AnchorConstraint[], boards: Board[], relations: CarcassRelations): number {
  return presetAnchorSpecs(boards, relations).filter(
    (s) => !constraints.some((c) => c.board === s.board && c.face === s.face),
  ).length
}

/** Carcass joints that were replaced by a joint made by hand (the face keeps the user's joint). */
export function overriddenCarcassFaces(constraints: AnchorConstraint[], boards: Board[], relations: CarcassRelations): PresetAnchorSpec[] {
  return presetAnchorSpecs(boards, relations).filter((s) =>
    constraints.some((c) => c.board === s.board && c.face === s.face && !c.preset && !matchesSpec(c, s)),
  )
}

// ---- boards ------------------------------------------------------------------------------------------

export interface CarcassBoardOptions {
  /** Grubość [mm] */
  thickness: number
  /** Model płyty – id from the board catalog (default: the default raw chipboard). */
  materialId?: string
  /** Obrzeże ABS (default: none). */
  edgeBanding?: EdgeBanding
  /** Kierunek usłojenia of a board model with a grain (default A–C). */
  grain?: GrainDirection
}

export const DEFAULT_CARCASS_THICKNESS = 18

let counter = 0
function newBoardId(): string {
  counter += 1
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `carcass-${Date.now()}-${counter}`
}

/**
 * A new carcass board, roughly at its wall and as big as the furniture on the two other axes – its exact
 * place and size come from the carcass joints when the layout is solved (`applyCarcass`).
 */
export function createCarcassBoard(role: CarcassRole, options: CarcassBoardOptions, furniture: Furniture): Board {
  const [W, H, D] = furnitureSize(furniture)
  const orientation = CARCASS_ORIENTATION[role]
  const base: BoardParams = {
    ...DEFAULT_BOARD_PARAMS,
    orientation,
    thickness: options.thickness,
    materialId: options.materialId ?? DEFAULT_BOARD_PARAMS.materialId,
    edgeBanding: options.edgeBanding ?? DEFAULT_BOARD_PARAMS.edgeBanding,
    grain: options.grain ?? DEFAULT_BOARD_PARAMS.grain,
    width: orientation === 'side' ? D : W,
    height: orientation === 'horizontal' ? D : H,
  }
  const params = fitParamsToFurniture(base, furniture)
  const t = params.thickness
  const position = {
    x: role === 'right' ? W - t : 0,
    y: role === 'top' ? H - t : 0,
    z: 0,
  }
  return { ...params, id: newBoardId(), name: CARCASS_LABELS[role], role, position }
}

export interface CarcassState {
  boards: Board[]
  constraints: AnchorConstraint[]
}

/** Syncs the carcass joints and solves the layout – the carcass boards take their places. */
export function applyCarcass(
  furniture: Furniture,
  boards: Board[],
  constraints: AnchorConstraint[],
  relations: CarcassRelations,
  pinnedId?: string,
): CarcassState {
  const cs = syncCarcassAnchors(constraints, boards, furniture, relations)
  return { constraints: cs, boards: solveLayout(furniture, boards, cs, pinnedId).boards }
}

/**
 * Adds a carcass board of the given role – unless the furniture already has one (a role is unique, e.g.
 * there is only one top). The neighbours covered by it shrink / move to make room for it.
 */
export function addCarcassBoard(
  furniture: Furniture,
  boards: Board[],
  constraints: AnchorConstraint[],
  relations: CarcassRelations,
  role: CarcassRole,
  options: CarcassBoardOptions,
): CarcassState {
  if (findRoleBoard(boards, role)) return { boards, constraints }
  return applyCarcass(furniture, [...boards, createCarcassBoard(role, options, furniture)], constraints, relations)
}
