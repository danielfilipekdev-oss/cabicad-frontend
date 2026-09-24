import { add, dot, isSimplePolygon, lineIntersection, normalize, scale, sub, type Vec2 } from './polygon.ts'

/**
 * Inward offset of the board outline by the edge band thickness (the board core = outline − bands).
 * Shared by the renderer (`boardGeometry.ts`) and the cut-out validation (`cutouts.ts`).
 */

export interface OffsetEdge {
  from: Vec2
  to: Vec2
  dir: Vec2
  /** Inward normal (the outline is clockwise, so the board lies to the right of every edge). */
  nIn: Vec2
  /** Band thickness [mm] of the edge (0 = no band). */
  t: number
}

/** Straight segments of a clockwise outline with their band thickness → offset edges. */
export function offsetEdges(segs: { from: Vec2; to: Vec2; t: number }[]): OffsetEdge[] {
  return segs.map((s) => {
    const dir = normalize(sub(s.to, s.from))
    return { from: s.from, to: s.to, dir, nIn: [dir[1], -dir[0]] as Vec2, t: s.t }
  })
}

/** Inner (offset) vertex at the start of edge `e` (after edge `p`). */
function innerVertex(p: OffsetEdge, e: OffsetEdge): Vec2 {
  const hit = lineIntersection(add(p.from, scale(p.nIn, p.t)), p.dir, add(e.from, scale(e.nIn, e.t)), e.dir)
  // parallel neighbours (tangent arc segments) → offset of the thicker band
  return hit ?? add(e.from, scale(e.nIn, Math.max(p.t, e.t)))
}

/** Core polygon: vertex i = start of offset edge i. */
export function coreFrom(edges: OffsetEdge[]): Vec2[] {
  return edges.map((e, i) => innerVertex(edges[(i - 1 + edges.length) % edges.length], e))
}

/** Core is valid when it is a simple polygon with every edge pointing the same way as its outline edge. */
export function isCoreValid(core: Vec2[], edges: OffsetEdge[]): boolean {
  if (!isSimplePolygon(core)) return false
  for (let i = 0; i < edges.length; i++) {
    const d = sub(core[(i + 1) % core.length], core[i])
    if (dot(d, edges[i].dir) <= 1e-9) return false
  }
  return true
}
