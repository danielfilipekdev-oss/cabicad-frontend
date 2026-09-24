import type { Board, BoardParams } from './board.ts'
import { MIN_EDGE_MM, areBandsValid, boardContour, boardCutouts, edgeLength, edgeMidpoint, type ContourEdge, type EdgeKey } from './cutouts.ts'
import { edgeBandingError, resolveEdgeBand, type EdgeBand } from './edgeBanding.ts'
import { edgeBandColor } from './edgeBandCatalog.ts'
import { add, dot, lineIntersection, samePoint, scale, signedArea, type Vec2 } from './polygon.ts'
import { coreFrom, isCoreValid, offsetEdges, type OffsetEdge } from './offset.ts'

/**
 * Render geometry of a board: outline with cut-outs, core and edge bands (all in mm).
 *
 * Everything is computed in the board's own 2D frame (see `cutouts.ts`: X along the width, Y along the
 * height, edge A at the top) and extruded by the board thickness; `boardTransform` places the 2D frame
 * in the furniture / world coordinates.
 *
 * The board dimensions entered by the user are GROSS: core + bands = entered outline. The core is the
 * outline offset inwards by the band thickness of every edge. Joints of two bands:
 *  - two perpendicular axis-parallel edges: the band of the edge along the width (A / C and the
 *    horizontal cut-out edges) runs through, the other one fits between (as before the cut-outs),
 *  - any other angle (chamfers): mitred joint.
 */

type Vec3 = [number, number, number]

const formatMm = (v: number) => String(v).replace('.', ',')

export interface BandPiece {
  edge: EdgeKey
  label: string
  band: EdgeBand
  color: string
  /** Outline of the band piece in the 2D frame (extruded by the thickness). */
  polygon: Vec2[]
}

export interface EdgeAnchor {
  edge: EdgeKey
  label: string
  /** Middle of the edge's outer face (world). */
  point: Vec3
  /** Outward direction (unit vector, world) of the edge. */
  dir: Vec3
  band: EdgeBand | null
  color: string | null
}

export interface BoardShape {
  width: number
  height: number
  thickness: number
  /** Outline edges, clockwise from edge A. */
  edges: ContourEdge[]
  /** Outline (gross) polygon = all points of `edges` (arcs tessellated). */
  outer: Vec2[]
  /** Core polygon (outline without the bands). */
  core: Vec2[]
  bands: BandPiece[]
  /** 1 = bands as entered; < 1 = bands too thick for the outline, scaled down for rendering. */
  bandScale: number
}

const isAxisX = (d: Vec2) => Math.abs(d[1]) < 1e-9
const isAxisY = (d: Vec2) => Math.abs(d[0]) < 1e-9

/** Which band runs through a joint of edges p → e: 'p', 'e' or null (mitre). */
function jointWinner(p: OffsetEdge, e: OffsetEdge): 'p' | 'e' | null {
  const perpendicular = Math.abs(dot(p.dir, e.dir)) < 1e-9
  if (!perpendicular) return null
  if (isAxisX(p.dir) && isAxisY(e.dir)) return 'p'
  if (isAxisY(p.dir) && isAxisX(e.dir)) return 'e'
  return null
}

/**
 * Outer / inner point of the band of edge `me` at its joint with edge `other` (see `jointWinner`):
 * the winning band reaches the outer corner and ends on the other edge's outer line, the losing band ends
 * on the winner's inner line; mitre = outer corner + inner (offset) corner.
 */
function jointPoints(me: OffsetEdge, other: OffsetEdge, winner: 'me' | 'other' | null, outerV: Vec2, innerV: Vec2) {
  const meInner = add(me.from, scale(me.nIn, me.t))
  const otherInner = add(other.from, scale(other.nIn, other.t))
  if (winner === 'me') {
    return { outer: outerV, inner: lineIntersection(meInner, me.dir, other.from, other.dir) ?? innerV }
  }
  if (winner === 'other') {
    return { outer: lineIntersection(me.from, me.dir, otherInner, other.dir) ?? outerV, inner: innerV }
  }
  return { outer: outerV, inner: innerV }
}

function dedupe(poly: Vec2[]): Vec2[] {
  return poly.filter((p, i) => !samePoint(p, poly[(i + 1) % poly.length], 1e-7))
}

/** 2D shape of a board (outline, core, bands) – see the module comment. */
export function boardShape(params: BoardParams): BoardShape {
  const edges = boardContour(params)
  // straight segments of the outline (an arc = several segments of one edge)
  const segs: { from: Vec2; to: Vec2; edge: number }[] = []
  edges.forEach((e, ei) => {
    for (let i = 1; i < e.points.length; i++) segs.push({ from: e.points[i - 1], to: e.points[i], edge: ei })
  })
  const outer = segs.map((sg) => sg.from)
  const bandsOf = edges.map((e) => resolveEdgeBand(params.edgeBanding, e.key))

  const offsetAt = (k: number): OffsetEdge[] =>
    offsetEdges(segs.map((sg) => ({ from: sg.from, to: sg.to, t: (bandsOf[sg.edge]?.thickness ?? 0) * k })))

  // bands too thick for the outline (invalid input – shown as an error) → scale them down to still render
  let bandScale = 1
  let oe = offsetAt(1)
  let core = coreFrom(oe)
  if (!isCoreValid(core, oe)) {
    let a = 0
    let b = 1
    for (let i = 0; i < 30; i++) {
      const m = (a + b) / 2
      const test = offsetAt(m)
      if (isCoreValid(coreFrom(test), test)) a = m
      else b = m
    }
    bandScale = a
    oe = offsetAt(a)
    core = coreFrom(oe)
  }

  const n = segs.length
  const bands: BandPiece[] = []
  let s0 = 0
  edges.forEach((edge, ei) => {
    const count = edge.points.length - 1
    const s1 = s0 + count - 1 // segments s0 … s1 belong to this edge
    const band = bandsOf[ei]
    const first = oe[s0]
    const last = oe[s1]
    if (band && first.t > 0) {
      const prev = oe[(s0 - 1 + n) % n]
      const next = oe[(s1 + 1) % n]
      const wStart = jointWinner(prev, first)
      const wEnd = jointWinner(last, next)
      const start = jointPoints(first, prev, wStart === 'e' ? 'me' : wStart === 'p' ? 'other' : null, first.from, core[s0])
      const end = jointPoints(last, next, wEnd === 'p' ? 'me' : wEnd === 'e' ? 'other' : null, last.to, core[(s1 + 1) % n])
      // inner vertices of a tessellated arc: mitred (outline point + core point)
      const outerMid = edge.points.slice(1, -1)
      const innerMid: Vec2[] = []
      for (let i = s0 + 1; i <= s1; i++) innerMid.push(core[i])
      const polygon = dedupe([start.outer, ...outerMid, end.outer, end.inner, ...innerMid.reverse(), start.inner])
      if (polygon.length >= 3) {
        bands.push({ edge: edge.key, label: edge.label, band, color: edgeBandColor(band.typeId), polygon })
      }
    }
    s0 += count
  })

  return { width: params.width, height: params.height, thickness: params.thickness, edges, outer, core, bands, bandScale }
}

/**
 * Validation of the board outline + bands: bands on opposite edges must leave some core (A + C < height,
 * B + D < width) and no edge (also the short edges of the cut-outs) may be "eaten" by the bands of its
 * neighbours. Returns an error message or null.
 */
export function boardShapeError(params: BoardParams): string | null {
  const base = edgeBandingError(params)
  if (base) return base
  if (!areBandsValid(params.width, params.height, boardCutouts(params), params.edgeBanding)) {
    return `Obrzeża nie mieszczą się przy wycięciach – krótkie krawędzie, mostki i promienie muszą mieć ${formatMm(MIN_EDGE_MM)} mm materiału plus grubość obrzeży.`
  }
  if (boardShape(params).bandScale < 1) return 'Obrzeża są grubsze niż krótkie krawędzie, mostki lub promienie wycięć – zwiększ odstęp albo zmień obrzeże.'
  return null
}

/**
 * Placement of the 2D frame in the furniture: the 2D shape lies in the local XY plane and is extruded
 * along local +Z by the thickness; the group transform maps it to the world.
 *  - vertical board (XY plane): local = world − position,
 *  - side board (YZ plane, seen from the right): X = x + lz (thickness to the right), Y = y + ly,
 *    Z = z + W − lx (edge D at the front, B at the back),
 *  - horizontal board (XZ plane): X = x, Y = z (thickness up), Z = H − y (edge A at the back, z = min).
 */
export function boardTransform(board: Board): { position: Vec3; rotation: Vec3 } {
  const { x, y, z } = board.position
  switch (board.orientation) {
    case 'vertical':
      return { position: [x, y, z], rotation: [0, 0, 0] }
    case 'side':
      return { position: [x, y, z + board.width], rotation: [0, Math.PI / 2, 0] }
    default:
      return { position: [x, y, z + board.height], rotation: [-Math.PI / 2, 0, 0] }
  }
}

/** Local (2D frame + thickness) point → world point. */
export function localToWorld(board: Board, [lx, ly, lz]: Vec3): Vec3 {
  const { x, y, z } = board.position
  switch (board.orientation) {
    case 'vertical':
      return [x + lx, y + ly, z + lz]
    case 'side':
      return [x + lz, y + ly, z + board.width - lx]
    default:
      return [x + lx, y + lz, z + board.height - ly]
  }
}

/** Local direction → world direction. */
function dirToWorld(board: Board, [dx, dy, dz]: Vec3): Vec3 {
  switch (board.orientation) {
    case 'vertical':
      return [dx, dy, dz]
    case 'side':
      return [dz, dy, -dx]
    default:
      return [dx, dz, -dy]
  }
}

/** Label anchors of all edges: middle of the outer face + outward direction (world). */
export function boardAnchors(board: Board, shape: BoardShape): EdgeAnchor[] {
  // a side split by U slots gets one label – on its longest part
  const longest = new Map<EdgeKey, ContourEdge>()
  for (const e of shape.edges) {
    const cur = longest.get(e.key)
    if (!cur || edgeLength(e) > edgeLength(cur)) longest.set(e.key, e)
  }
  return [...longest.values()].map((e) => {
    const { point: mid, dir: d } = edgeMidpoint(e)
    const out: Vec2 = [-d[1], d[0]] // left of a clockwise edge = outside
    const band = resolveEdgeBand(board.edgeBanding, e.key)
    return {
      edge: e.key,
      label: e.label,
      point: localToWorld(board, [mid[0], mid[1], shape.thickness / 2]),
      dir: dirToWorld(board, [out[0], out[1], 0]),
      band,
      color: band ? edgeBandColor(band.typeId) : null,
    }
  })
}

/** Orientation sanity helper (used by tests): the outline is clockwise. */
export function isClockwise(poly: Vec2[]): boolean {
  return signedArea(poly) < 0
}
