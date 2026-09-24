/**
 * Small 2D polygon helpers used by the board shape (cut-outs, edge-band offsets).
 * Coordinates in millimetres, Y axis pointing up.
 */

export type Vec2 = [number, number]

/** Length tolerance [mm]: points closer than this are the same point. */
export const LEN_EPS = 1e-6

export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]]
export const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k]
export const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1]
export const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0]
export const length = (a: Vec2) => Math.hypot(a[0], a[1])
export const samePoint = (a: Vec2, b: Vec2, eps = LEN_EPS) => Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps

export function normalize(a: Vec2): Vec2 {
  const l = length(a)
  return l > 0 ? [a[0] / l, a[1] / l] : [0, 0]
}

/** Signed area (shoelace): > 0 counter-clockwise, < 0 clockwise (Y up). */
export function signedArea(poly: Vec2[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s / 2
}

/** Intersection of the infinite lines p + s·d and q + u·e; null when (almost) parallel. */
export function lineIntersection(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const den = cross(d, e)
  if (Math.abs(den) < 1e-12) return null
  const s = cross(sub(q, p), e) / den
  return add(p, scale(d, s))
}

const orient = (a: Vec2, b: Vec2, c: Vec2) => cross(sub(b, a), sub(c, a))

function onSegment(a: Vec2, b: Vec2, p: Vec2, eps: number): boolean {
  return (
    Math.min(a[0], b[0]) - eps <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) + eps &&
    Math.min(a[1], b[1]) - eps <= p[1] &&
    p[1] <= Math.max(a[1], b[1]) + eps
  )
}

/** True when the segments ab and cd intersect or touch. */
export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  // orientation tolerance scaled by the segment lengths (area units)
  const eps = 1e-9 * Math.max(1, length(sub(b, a)) * length(sub(d, c)))
  const d1 = orient(c, d, a)
  const d2 = orient(c, d, b)
  const d3 = orient(a, b, c)
  const d4 = orient(a, b, d)
  const opp = (x: number, y: number) => (x > eps && y < -eps) || (x < -eps && y > eps)
  if (opp(d1, d2) && opp(d3, d4)) return true
  const le = 1e-6
  if (Math.abs(d1) <= eps && onSegment(c, d, a, le)) return true
  if (Math.abs(d2) <= eps && onSegment(c, d, b, le)) return true
  if (Math.abs(d3) <= eps && onSegment(a, b, c, le)) return true
  if (Math.abs(d4) <= eps && onSegment(a, b, d, le)) return true
  return false
}

/**
 * Simple polygon test: at least 3 vertices, no zero-length edges, no edge folding back onto the previous
 * one (spike) and no two non-adjacent edges touching / crossing; non-zero area.
 */
export function isSimplePolygon(poly: Vec2[]): boolean {
  const n = poly.length
  if (n < 3) return false
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    if (samePoint(a, b)) return false
    // adjacent edge going back along this one = zero-width spike
    const c = poly[(i + 2) % n]
    const e1 = sub(b, a)
    const e2 = sub(c, b)
    if (Math.abs(cross(normalize(e1), normalize(e2))) < 1e-9 && dot(e1, e2) < 0) return false
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1)
      if (adjacent) continue
      if (segmentsIntersect(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return false
    }
  }
  return Math.abs(signedArea(poly)) > 1e-6
}
