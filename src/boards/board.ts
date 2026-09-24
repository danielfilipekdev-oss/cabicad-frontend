import { furnitureSize, type Furniture, type NumericLimits } from '../furniture/furniture.ts'
import { NO_EDGE_BANDING, type EdgeBanding } from './edgeBanding.ts'
import type { Cutout } from './cutouts.ts'
import type { Groove } from './grooves.ts'
import type { CarcassRole } from '../carcass/carcass.ts'
import type { DividerKind } from '../sections/sections.ts'
import { DEFAULT_BOARD_MODEL_ID } from './boardCatalog.ts'

export type { NumericLimits }

/**
 * Board (płyta) model.
 * The base unit of the whole application is the millimetre: board dimensions, positions and the
 * 3D scene itself (1 scene unit = 1 mm). Values may be fractional (precision 0.1 mm, see `DIMENSION_STEP`).
 * Boards live inside the furniture cuboid (see `furniture.ts`) and their positions are expressed in
 * the furniture coordinate system.
 */
/**
 *  - vertical   → front / back board: XY plane (width along X, height along Y, thickness along Z),
 *  - side       → side board (bok):   YZ plane (width = depth along Z, height along Y, thickness along X),
 *  - horizontal → lying board:        XZ plane (width along X, height = depth along Z, thickness along Y).
 */
export type BoardOrientation = 'vertical' | 'side' | 'horizontal'

/**
 * Grain direction (kierunek usłojenia), given by the two edges the grain runs BETWEEN (like the
 * direction of a groove, `grooves.ts`):
 *  - 'AC' – from edge A to edge C (across A and C = along the board HEIGHT; e.g. vertical on a side / front),
 *  - 'BD' – from edge B to edge D (across B and D = along the board WIDTH; e.g. horizontal on a back).
 * Matters only for a board model whose grain matters (`BoardModel.grainMatters`).
 */
export type GrainDirection = 'AC' | 'BD'

export const GRAIN_LABELS: Record<GrainDirection, string> = {
  AC: 'A–C (od A do C – wzdłuż wysokości)',
  BD: 'B–D (od B do D – wzdłuż szerokości)',
}

export const DEFAULT_GRAIN: GrainDirection = 'AC'

export interface BoardParams {
  /** Grubość [mm] */
  thickness: number
  /** Wysokość [mm] */
  height: number
  /** Szerokość [mm] */
  width: number
  /** Orientacja: pionowa wzdłuż szerokości (płaszczyzna XY), pionowa wzdłuż głębokości (YZ) lub pozioma (XZ) */
  orientation: BoardOrientation
  /**
   * Model płyty – id of the board model from the catalog (`boardCatalog.ts`, e.g. Egger H1145 ST10).
   * It sets the texture of the faces and the thickness variants (`thickness` is one of them, or any
   * value when the model has none). An unknown id is drawn as the default raw chipboard.
   */
  materialId: string
  /** Kierunek usłojenia (only for a board model whose grain matters). */
  grain: GrainDirection
  /**
   * Obrzeże ABS – common band + per-edge overrides (edges A–D, see `edgeBanding.ts`).
   * Width / height above are GROSS dimensions – they already include the band thickness.
   */
  edgeBanding: EdgeBanding
  /**
   * Wycięcia – corner cut-outs changing the rectangle into e.g. a trapezoid or an L (see `cutouts.ts`).
   * Width / height stay the gross bounding box of the board. The stored list may not fit the current
   * size (e.g. while a smaller width is being typed) – always use `boardCutouts()` for the valid ones.
   */
  cutouts: Cutout[]
  /**
   * Frezowania – grooves milled into the faces / bare edges of the board (see `grooves.ts`); use
   * `boardGrooves()` for the ones fitted to the current size.
   */
  grooves?: Groove[]
}

export type BoardDimension = 'thickness' | 'height' | 'width'

/**
 * Board position [mm] = the board's corner with the smallest X, Y and Z, measured from the furniture
 * origin – the left-top corner of the furniture's bottom plane (X → right, Y → up, Z → front).
 * Y = 0 means the board stands / lies on the bottom of the furniture.
 */
export interface BoardPosition {
  x: number
  y: number
  z: number
}

export interface Board extends BoardParams {
  id: string
  /** Display name, e.g. "Płyta 3" */
  name: string
  position: BoardPosition
  /**
   * Predefined carcass board (płyta korpusu – dach, podłoga, boki, plecy, see `carcass/carcass.ts`),
   * or undefined for a free board added by hand. At most one board per role.
   */
  role?: CarcassRole
  /**
   * Shelf (półka) or partition (przedział) dividing a section of the furniture (see
   * `sections/sections.ts`), or undefined. Its place comes from the section tree.
   */
  divider?: DividerKind
  /** Id of the front (door / flap, `fronts/fronts.ts`) this board is a leaf of, or undefined. */
  front?: string
}

export const DEFAULT_BOARD_PARAMS: BoardParams = {
  thickness: 18,
  height: 720,
  width: 600,
  orientation: 'vertical',
  materialId: DEFAULT_BOARD_MODEL_ID,
  grain: DEFAULT_GRAIN,
  edgeBanding: NO_EDGE_BANDING,
  cutouts: [],
}

export const ORIENTATION_LABELS: Record<BoardOrientation, string> = {
  vertical: 'Pionowa (wzdłuż szerokości)',
  side: 'Pionowa (wzdłuż głębokości)',
  horizontal: 'Pozioma',
}

/** Static limits of the board dimensions [mm] – nothing below 1 mm. The furniture narrows them further. */
export const BOARD_PARAM_LIMITS: Record<BoardDimension, NumericLimits> = {
  thickness: { min: 1, max: 200 },
  height: { min: 1, max: 5000 },
  width: { min: 1, max: 5000 },
}

/** Gap [mm] left between an automatically placed new board and the existing ones. */
export const AUTO_PLACEMENT_GAP = 20

/**
 * Size of the board box in millimetres [x, y, z].
 *  - vertical board   → lies in the XY plane: width along X, height along Y (up), thickness along Z
 *  - side board       → lies in the YZ plane: width along Z (depth), height along Y (up), thickness along X
 *  - horizontal board → lies in the XZ plane (on the floor): width along X, height along Z, thickness along Y
 */
export function boardSizeMm(b: BoardParams): [number, number, number] {
  switch (b.orientation) {
    case 'vertical':
      return [b.width, b.height, b.thickness]
    case 'side':
      return [b.thickness, b.height, b.width]
    default:
      return [b.width, b.thickness, b.height]
  }
}

/** Size of the board box in scene units [x, y, z] (scene unit = mm). */
export function boardBoxSize(b: BoardParams): [number, number, number] {
  return boardSizeMm(b)
}

/** Centre of the board box in scene units (mm), derived from its corner position. */
export function boardBoxCenter(b: Board): [number, number, number] {
  const [sx, sy, sz] = boardSizeMm(b)
  return [b.position.x + sx / 2, b.position.y + sy / 2, b.position.z + sz / 2]
}

/** Axis-aligned bounding box [mm]. */
export interface Bounds {
  min: [number, number, number]
  max: [number, number, number]
}

export function boundsAt(params: BoardParams, position: BoardPosition): Bounds {
  const [sx, sy, sz] = boardSizeMm(params)
  return {
    min: [position.x, position.y, position.z],
    max: [position.x + sx, position.y + sy, position.z + sz],
  }
}

export function boardBounds(b: Board): Bounds {
  return boundsAt(b, b.position)
}

/** True when two boxes overlap with a positive volume (boards that only touch do not collide). */
export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  const EPS = 1e-6
  for (let i = 0; i < 3; i++) {
    if (a.max[i] <= b.min[i] + EPS || b.max[i] <= a.min[i] + EPS) return false
  }
  return true
}

/** Boards (other than `board` itself) that collide with the given board. */
export function collidingBoards(board: Board, boards: Board[]): Board[] {
  const bb = boardBounds(board)
  return boards.filter((o) => o.id !== board.id && boundsOverlap(bb, boardBounds(o)))
}

const ORIGIN: BoardPosition = { x: 0, y: 0, z: 0 }
const AXES: (keyof BoardPosition)[] = ['x', 'y', 'z']
const clamp = (v: number, l: NumericLimits) => Math.min(l.max, Math.max(l.min, v))

/** Axis (0 = X, 1 = Y, 2 = Z) along which a board dimension lies – see `boardSizeMm`. */
export function dimensionAxis(orientation: BoardOrientation, key: BoardDimension): 0 | 1 | 2 {
  switch (orientation) {
    case 'vertical':
      return key === 'width' ? 0 : key === 'height' ? 1 : 2
    case 'side':
      return key === 'width' ? 2 : key === 'height' ? 1 : 0
    default:
      return key === 'width' ? 0 : key === 'height' ? 2 : 1
  }
}

/**
 * Limits of the board dimensions so that a board placed at `position` stays inside the furniture:
 * max = distance from the position to the furniture wall along the dimension's axis (and the static max).
 */
export function boardParamLimits(
  orientation: BoardOrientation,
  position: BoardPosition,
  furniture: Furniture,
): Record<BoardDimension, NumericLimits> {
  const fs = furnitureSize(furniture)
  const pos = [position.x, position.y, position.z]
  const limits = {} as Record<BoardDimension, NumericLimits>
  for (const key of Object.keys(BOARD_PARAM_LIMITS) as BoardDimension[]) {
    const axis = dimensionAxis(orientation, key)
    const { min, max } = BOARD_PARAM_LIMITS[key]
    limits[key] = { min, max: Math.max(min, Math.min(max, fs[axis] - pos[axis])) }
  }
  return limits
}

/** Limits of the board position: 0 … (furniture size − board size) on every axis. */
export function boardPositionLimits(params: BoardParams, furniture: Furniture): Record<keyof BoardPosition, NumericLimits> {
  const size = boardSizeMm(params)
  const fs = furnitureSize(furniture)
  const limits = {} as Record<keyof BoardPosition, NumericLimits>
  AXES.forEach((axis, i) => (limits[axis] = { min: 0, max: Math.max(0, fs[i] - size[i]) }))
  return limits
}

/** Shrinks the board dimensions (only if needed) so that the board fits into the furniture. */
export function fitParamsToFurniture<T extends BoardParams>(params: T, furniture: Furniture): T {
  const limits = boardParamLimits(params.orientation, ORIGIN, furniture)
  return {
    ...params,
    thickness: clamp(params.thickness, limits.thickness),
    height: clamp(params.height, limits.height),
    width: clamp(params.width, limits.width),
  }
}

/**
 * Makes a board fit inside the furniture (e.g. after its orientation was changed):
 * dimensions are shrunk only when they are bigger than the furniture, then the board is moved inside.
 */
export function fitBoardToFurniture(board: Board, furniture: Furniture): Board {
  const fitted = fitParamsToFurniture(board, furniture)
  const limits = boardPositionLimits(fitted, furniture)
  const position = { ...board.position }
  for (const axis of AXES) position[axis] = clamp(position[axis], limits[axis])
  return { ...fitted, position }
}

/** Largest extent [x, y, z] of all boards from the furniture origin – the furniture cannot be smaller. */
export function boardsExtent(boards: Board[]): [number, number, number] {
  const ext: [number, number, number] = [0, 0, 0]
  for (const b of boards) {
    const { max } = boardBounds(b)
    for (let i = 0; i < 3; i++) ext[i] = Math.max(ext[i], max[i])
  }
  return ext
}

/**
 * Finds a position inside the furniture for a new board so that it does not collide with the existing
 * boards. Candidates: the furniture origin / far walls and the places next to (and on top of) every
 * existing board, with a small gap. The lowest free candidate closest to the origin wins. If there is
 * no free place, the board goes to the origin (the collision is then shown in the list and in red).
 */
export function findFreePosition(params: BoardParams, existing: Board[], furniture: Furniture): BoardPosition {
  const [sx, sy, sz] = boardSizeMm(params)
  const [fx, fy, fz] = furnitureSize(furniture)
  const gap = AUTO_PLACEMENT_GAP
  const xs = new Set<number>([0, fx - sx])
  const ys = new Set<number>([0, fy - sy])
  const zs = new Set<number>([0, fz - sz])
  const obstacles = existing.map(boardBounds)
  for (const o of obstacles) {
    xs.add(o.max[0] + gap).add(o.min[0] - gap - sx).add(o.min[0])
    ys.add(o.max[1] + gap)
    zs.add(o.max[2] + gap).add(o.min[2] - gap - sz).add(o.min[2])
  }
  const inside = (v: number, free: number) => v >= 0 && v <= free

  let best: BoardPosition | null = null
  let bestScore = Infinity
  for (const y of ys) {
    if (!inside(y, fy - sy)) continue
    for (const x of xs) {
      if (!inside(x, fx - sx)) continue
      for (const z of zs) {
        if (!inside(z, fz - sz)) continue
        const pos = { x, y, z }
        const bb = boundsAt(params, pos)
        if (obstacles.some((o) => boundsOverlap(bb, o))) continue
        // lowest level first, then the corner closest to the furniture origin
        const score = y * 1e6 + Math.hypot(x, z)
        if (score < bestScore) {
          bestScore = score
          best = pos
        }
      }
    }
  }
  return best ?? { ...ORIGIN }
}

const inRange = (v: number, l: NumericLimits) => Number.isFinite(v) && v >= l.min && v <= l.max

export function isValidBoardParams(b: BoardParams): boolean {
  return (Object.keys(BOARD_PARAM_LIMITS) as BoardDimension[]).every((k) => inRange(b[k], BOARD_PARAM_LIMITS[k]))
}

function nextBoardName(existing: Board[]): string {
  const max = existing.reduce((m, b) => {
    const n = /^Płyta (\d+)$/.exec(b.name)
    return n ? Math.max(m, Number(n[1])) : m
  }, 0)
  return `Płyta ${max + 1}`
}

const roundMm = (v: number) => Number(v.toFixed(3)) || 0

/**
 * Position of a board centred in the furniture on every axis (its centre = the furniture centre),
 * rounded to the dimension precision (0.1 mm). A board as big as the furniture on an axis sits at 0.
 */
export function centeredPosition(params: BoardParams, furniture: Furniture): BoardPosition {
  const size = boardSizeMm(params)
  const fs = furnitureSize(furniture)
  const at = (i: number) => roundMm(Math.max(0, Math.round(((fs[i] - size[i]) / 2) * 10) / 10))
  return { x: at(0), y: at(1), z: at(2) }
}

/** Id of the preview of a board not added yet (green wireframe in the scene). */
export const DRAFT_BOARD_ID = '__draft__'

/**
 * The board the "Nowa płyta" form would add – fitted to the furniture and centred in it, exactly where
 * `createBoard` puts it. Shown in the scene as a green wireframe before "Dodaj" is pressed.
 */
export function draftBoard(params: BoardParams, furniture: Furniture): Board {
  const fitted = fitParamsToFurniture(params, furniture)
  return { ...fitted, id: DRAFT_BOARD_ID, name: 'Nowa płyta', position: centeredPosition(fitted, furniture) }
}

let counter = 0
/**
 * Creates a new board in the CENTRE of the furniture (see `centeredPosition`). It may overlap the
 * existing boards – the collision is shown in the list and in red, and the board is then moved / joined.
 */
export function createBoard(params: BoardParams, existing: Board[], furniture: Furniture): Board {
  counter += 1
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `board-${Date.now()}-${counter}`
  const draft = draftBoard(params, furniture)
  return { ...draft, id, name: nextBoardName(existing) }
}
