import { resolveEdgeBand, type EdgeBanding, type EdgeId } from './edgeBanding.ts'
import { boardContour, type Cutout } from './cutouts.ts'
import type { BoardOrientation } from './board.ts'

/**
 * Grooves (frezowania) of a board – rectangular channels milled into the board: width × depth, running
 * along the board for `length` (by default through the whole available length – `through`).
 *
 * A groove is on one of the two FACES of the board (the side seen in the 2D view – `front` – or the
 * opposite one – `back`) or in one of its EDGES A–D. An edge can be milled only when it has NO edge band
 * (ABS) – the groove would cut through it; an edge whose band is left out because it touches another
 * board counts as bare. A board can have any number of grooves.
 *
 * Everything is in the board's 2D frame (`cutouts.ts`: X along the width 0 … W, Y along the height
 * 0 … H, edge A at the top) + Z across the thickness (0 = the back face, T = the front face):
 *  - face groove along A–C (`dir: 'AC'`) runs along X, `offset` = distance of its lower wall from edge C,
 *    along B–D runs along Y, `offset` = distance of its left wall from edge D,
 *  - edge groove runs along its edge (A / C along X, B / D along Y), `offset` = distance of its wall from
 *    the back face (across the thickness) – or ACROSS the edge (`across`): through the thickness (its
 *    "length" runs from the back face, the whole thickness when through), `offset` / `width` along the edge
 *    from edge D (A / C) or C (B / D),
 *  - `start` / `length` along the groove from edge D (along X) or edge C (along Y); a through groove
 *    spans the whole available length (the board, or the straight part(s) of the edge with cut-outs).
 * The depth leaves at least MIN_WALL_MM of material (`fitGroove` keeps every value valid for the current
 * board size).
 */

export type GrooveFace = 'front' | 'back'
export type GrooveSide = GrooveFace | EdgeId
export type GrooveDir = 'AC' | 'BD'

export interface Groove {
  id: string
  side: GrooveSide
  /** Face grooves: the direction. */
  dir: GrooveDir
  /**
   * Edge grooves: ACROSS the edge – through its width, i.e. across the board thickness (from strona 2
   * towards strona 1) at `offset` along the edge – instead of along the edge (default).
   */
  across?: boolean
  /** Distance [mm] of the groove wall from the reference (see the module comment). */
  offset: number
  /** Width [mm] of the groove (across it). */
  width: number
  /** Depth [mm] into the board. */
  depth: number
  /** Through the whole available length (start / length ignored). */
  through: boolean
  /** Start [mm] along the groove (from edge D / C) – when not through. */
  start: number
  /** Length [mm] – when not through. */
  length: number
}

export type GrooveParam = 'offset' | 'width' | 'depth' | 'start' | 'length'

export const GROOVE_EDGES: EdgeId[] = ['A', 'B', 'C', 'D']
export const MIN_GROOVE_MM = 1
/** Material left under / beside the bottom of a groove [mm]. */
export const MIN_WALL_MM = 1
export const GROOVE_STEP = 0.1

export const isFaceSide = (s: GrooveSide): s is GrooveFace => s === 'front' || s === 'back'

/** Face names per orientation (front = the side seen in the 2D view). */
export function faceLabel(orientation: BoardOrientation, face: GrooveFace): string {
  const names: Record<BoardOrientation, [string, string]> = {
    vertical: ['przód', 'tył'],
    side: ['prawa strona', 'lewa strona'],
    horizontal: ['góra', 'spód'],
  }
  const [f, b] = names[orientation]
  return face === 'front' ? `Strona 1 – ${f}` : `Strona 2 – ${b}`
}

interface GrooveInput {
  width: number
  height: number
  thickness: number
  cutouts?: Cutout[]
  edgeBanding?: EdgeBanding
  grooves?: Groove[]
}

type GrooveWhere = Pick<Groove, 'side' | 'dir' | 'across'>

/** Axis an edge runs along: A / C along X (0), B / D along Y (1). */
export const edgeAxis = (e: EdgeId): 0 | 1 => (e === 'A' || e === 'C' ? 0 : 1)

/** Axis (0 = X, 1 = Y, 2 = Z – across the thickness) the groove runs along. */
export function grooveAlongAxis(g: GrooveWhere): 0 | 1 | 2 {
  if (isFaceSide(g.side)) return g.dir === 'AC' ? 0 : 1
  return g.across ? 2 : edgeAxis(g.side)
}

/** Straight part(s) of an edge [from, to] along it (the edge minus the corner cut-outs). */
export function grooveEdgeSpan(p: GrooveInput, e: EdgeId): [number, number] {
  const axis = edgeAxis(e)
  const full: [number, number] = [0, axis === 0 ? p.width : p.height]
  const parts = boardContour(p).filter((c) => c.key === e)
  if (!parts.length) return full
  const vals = parts.flatMap((c) => c.points.map((pt) => pt[axis]))
  return [Math.min(...vals), Math.max(...vals)]
}

/** Available span [from, to] along the groove: the board, the straight part(s) of an edge or the thickness. */
export function grooveSpan(p: GrooveInput, g: GrooveWhere): [number, number] {
  if (isFaceSide(g.side)) return [0, g.dir === 'AC' ? p.width : p.height]
  return g.across ? [0, p.thickness] : grooveEdgeSpan(p, g.side)
}

/** Span [from, to] of `offset` + `width` across the groove: the board (faces), the thickness (along an edge) or the edge (across it). */
export function grooveAcrossSpan(p: GrooveInput, g: GrooveWhere): [number, number] {
  if (isFaceSide(g.side)) return [0, g.dir === 'AC' ? p.height : p.width]
  return g.across ? grooveEdgeSpan(p, g.side) : [0, p.thickness]
}

/** End of the span across the groove (see `grooveAcrossSpan`). */
export function grooveAcross(p: GrooveInput, g: GrooveWhere): number {
  return grooveAcrossSpan(p, g)[1]
}

/** Largest depth: the thickness (faces) or the board size under the edge (edges), minus the wall. */
export function grooveMaxDepth(p: GrooveInput, g: GrooveWhere): number {
  if (isFaceSide(g.side)) return p.thickness - MIN_WALL_MM
  return (edgeAxis(g.side) === 0 ? p.height : p.width) - MIN_WALL_MM
}

/** Why the groove cannot be milled (an edge with a band), or null. */
export function grooveProblem(p: GrooveInput, g: Pick<Groove, 'side'>): string | null {
  if (isFaceSide(g.side)) return null
  if (p.edgeBanding && resolveEdgeBand(p.edgeBanding, g.side)) return `Krawędź ${g.side} ma obrzeże – frezować można tylko krawędź bez obrzeża.`
  return null
}

const round = (v: number) => Number((Math.round(v / GROOVE_STEP) * GROOVE_STEP).toFixed(3)) || 0
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))

/** The groove with every value limited to the current board (a through groove spans the whole span). */
export function fitGroove(p: GrooveInput, g: Groove): Groove {
  const [lo, hi] = grooveAcrossSpan(p, g)
  const width = round(clamp(g.width, MIN_GROOVE_MM, hi - lo))
  const offset = round(clamp(g.offset, lo, hi - width))
  const depth = round(clamp(g.depth, MIN_GROOVE_MM, grooveMaxDepth(p, g)))
  const [a, b] = grooveSpan(p, g)
  if (g.through) return { ...g, width, offset, depth, start: round(a), length: round(b - a) }
  const start = round(clamp(g.start, a, b - MIN_GROOVE_MM))
  const length = round(clamp(g.length, MIN_GROOVE_MM, b - start))
  return { ...g, width, offset, depth, start, length }
}

/** Grooves of the board fitted to its current size. */
export function boardGrooves(p: GrooveInput): Groove[] {
  return (p.grooves ?? []).map((g) => fitGroove(p, g))
}

/** Allowed range of a parameter (for the numeric fields). */
export function grooveRange(p: GrooveInput, g: Groove, param: GrooveParam): { min: number; max: number } {
  const [lo, hi] = grooveAcrossSpan(p, g)
  const [a, b] = grooveSpan(p, g)
  switch (param) {
    case 'width':
      return { min: MIN_GROOVE_MM, max: round(hi - g.offset) }
    case 'offset':
      return { min: round(lo), max: round(Math.max(lo, hi - g.width)) }
    case 'depth':
      return { min: MIN_GROOVE_MM, max: round(grooveMaxDepth(p, g)) }
    case 'start':
      return { min: round(a), max: round(Math.max(a, b - g.length)) }
    default:
      return { min: MIN_GROOVE_MM, max: round(b - g.start) }
  }
}

/** The groove with one parameter changed (limited to its range). */
export function withGrooveParam(p: GrooveInput, g: Groove, param: GrooveParam, value: number): Groove {
  const r = grooveRange(p, g, param)
  return fitGroove(p, { ...g, [param]: clamp(value, r.min, r.max) })
}

let counter = 0
const newId = () => {
  counter += 1
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `groove-${Date.now()}-${counter}`
}

/**
 * A new groove on a face / an edge: 4 mm wide, 8 mm deep (less on a thin board), through; on a face
 * along A–C 10 mm from edge C, along an edge in the middle of the thickness, across an edge in the
 * middle of the edge.
 */
export function createGroove(p: GrooveInput, side: GrooveSide, dir: GrooveDir = 'AC', across = false): Groove {
  const width = Math.min(4, Math.max(MIN_GROOVE_MM, p.thickness - 2 * MIN_WALL_MM))
  const base: Groove = { id: newId(), side, dir, offset: 10, width, depth: 8, through: true, start: 0, length: 100 }
  if (!isFaceSide(side)) {
    if (across) {
      const [a, b] = grooveEdgeSpan(p, side)
      base.across = true
      base.offset = (a + b - width) / 2
    } else base.offset = (p.thickness - width) / 2
  }
  return fitGroove(p, base)
}

/** Local box [x0, y0, z0] – [x1, y1, z1] of the groove (2D frame + Z), `grow` mm longer / out of the board. */
export function grooveBox(p: GrooveInput, g: Groove, grow = 0): { min: [number, number, number]; max: [number, number, number] } {
  const W = p.width
  const H = p.height
  const T = p.thickness
  const along = grooveAlongAxis(g)
  const extend = g.through ? grow : 0
  const s0 = g.start - extend
  const s1 = g.start + g.length + extend
  const min: [number, number, number] = [0, 0, 0]
  const max: [number, number, number] = [0, 0, 0]
  const setAxis = (i: number, lo: number, hi: number) => {
    min[i] = lo || 0
    max[i] = hi || 0
  }
  setAxis(along, s0, s1)
  if (isFaceSide(g.side)) {
    setAxis(along === 0 ? 1 : 0, g.offset, g.offset + g.width)
    if (g.side === 'front') setAxis(2, T - g.depth, T + grow)
    else setAxis(2, -grow, g.depth)
  } else {
    // across the edge: offset / width along the edge (the thickness is the length); along: across the thickness
    if (g.across) setAxis(edgeAxis(g.side), g.offset, g.offset + g.width)
    else setAxis(2, g.offset, g.offset + g.width)
    const i = edgeAxis(g.side) === 0 ? 1 : 0
    if (g.side === 'A') setAxis(i, H - g.depth, H + grow)
    else if (g.side === 'C') setAxis(i, -grow, g.depth)
    else if (g.side === 'B') setAxis(i, W - g.depth, W + grow)
    else setAxis(i, -grow, g.depth)
  }
  return { min, max }
}

/** Short description, e.g. "Strona 1 – przód · A–C · 4 × 8 mm · na wylot". */
export function grooveLabel(orientation: BoardOrientation, g: Groove): string {
  const where = isFaceSide(g.side)
    ? `${faceLabel(orientation, g.side)} · ${g.dir === 'AC' ? 'A–C' : 'B–D'}`
    : `krawędź ${g.side} · ${g.across ? 'w poprzek' : 'wzdłuż'}`
  const len = g.through ? 'na wylot' : `dł. ${String(g.length).replace('.', ',')}`
  return `${where} · ${String(g.width).replace('.', ',')} × ${String(g.depth).replace('.', ',')} mm · ${len}`
}
