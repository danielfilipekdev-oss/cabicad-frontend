import { resolveEdgeBand, type EdgeBanding, type EdgeId } from './edgeBanding.ts'
import { isSimplePolygon, samePoint, type Vec2 } from './polygon.ts'
import { coreFrom, isCoreValid, offsetEdges } from './offset.ts'

/**
 * Cut-outs (wycięcia) of a board – they change the rectangular board into e.g. a trapezoid, an L,
 * a board with rounded corners or with a U-shaped slot.
 *
 * The board shape is described in its own 2D frame ("rzut 2D"), the same for both orientations:
 *  - X along the board width (0 … W), Y along the board height (0 … H), Y up,
 *  - edge A at the top (y = H), B on the right, C at the bottom, D on the left
 *    (vertical board: seen from the front; horizontal board: seen from above, front at the bottom).
 *
 * Corner cut-outs (at most one per corner) have two distances from their corner – `x` along the width
 * and `y` along the height:
 *  - chamfer (ścięcie / skos): the corner is cut off by a straight line (y = full height → trapezoid),
 *  - notch (wycięcie prostokątne): an x × y rectangle is removed from the corner (L-shaped board),
 *  - radius (zaokrąglenie): the corner is rounded with the radius r (stored as x = y = r).
 * Edge cut-outs:
 *  - slot (wycięcie U): a rectangle `width` × `depth` cut into an edge, `offset` from the reference corner
 *    of that edge (A → left-top DA, C → left-bottom CD, B → right-bottom BC, D → left-bottom CD).
 *    Several slots may be on one edge.
 *
 * Every straight edge of the outline is either removed completely or at least MIN_EDGE_MM long
 * (no slivers of edges that cannot be banded / machined), and no material web is narrower than that.
 * With edge bands the same rules apply to the board core (outline − bands), i.e. a short edge / web
 * needs MIN_EDGE_MM plus the thickness of the bands of its neighbours, a radius MIN_EDGE_MM plus its
 * band (`areBandsValid`). Editing respects both; the fitting to the board size only the outline rules
 * (a thicker band is reported as an error instead of silently changing the shape). The allowed values
 * therefore are not always one interval – `setCutoutParam` / `constrainCutoutParam` snap a value to the
 * nearest allowed one.
 *
 * New edges get stable keys (`<id>:s` chamfer, `<id>:x` / `<id>:y` notch, `<id>:r` radius,
 * `<id>:w1` / `<id>:b` / `<id>:w2` slot walls and bottom), so edge band overrides stay attached to them;
 * display letters E, F, G… are assigned in the order of the cut-outs. A side of the board split by a slot
 * keeps its key (A…D) for all its parts.
 */

export type Corner = 'AB' | 'BC' | 'CD' | 'DA'
export type CornerCutoutKind = 'chamfer' | 'notch' | 'radius'
export type CutoutKind = CornerCutoutKind | 'slot'

export interface CornerCutout {
  id: string
  kind: CornerCutoutKind
  corner: Corner
  /** Distance [mm] from the corner along the board width (X). Radius: r. */
  x: number
  /** Distance [mm] from the corner along the board height (Y). Radius: r (= x). */
  y: number
}

export interface SlotCutout {
  id: string
  kind: 'slot'
  edge: EdgeId
  /** Distance [mm] of the slot from the reference corner of the edge (see `slotFrame`). */
  offset: number
  /** Width [mm] of the slot along the edge. */
  width: number
  /** Depth [mm] of the slot into the board. */
  depth: number
}

export type Cutout = CornerCutout | SlotCutout

export const isSlot = (c: Cutout): c is SlotCutout => c.kind === 'slot'
export const isCornerCutout = (c: Cutout): c is CornerCutout => c.kind !== 'slot'

/** Adjustable parameters of the cut-outs. */
export type CutoutParam = 'x' | 'y' | 'r' | 'offset' | 'width' | 'depth'

/** Corners in the clockwise order used to walk around the board (starting at the left-top corner). */
export const CORNERS: Corner[] = ['DA', 'AB', 'BC', 'CD']
export const SLOT_EDGES: EdgeId[] = ['A', 'B', 'C', 'D']

export const CUTOUT_KIND_LABELS: Record<CutoutKind, string> = {
  chamfer: 'Ścięcie (skos)',
  notch: 'Wycięcie prostokątne (L)',
  radius: 'Zaokrąglenie (R)',
  slot: 'Wycięcie U',
}
export const CORNER_KINDS: CornerCutoutKind[] = ['chamfer', 'notch', 'radius']

/** Smallest cut-out dimension [mm]. */
export const MIN_CUT_MM = 1
/** Every straight edge of the outline is either removed completely or at least this long [mm]. */
export const MIN_EDGE_MM = 1
/** Precision of the cut-out distances [mm] (the same as the board dimensions). */
export const CUT_STEP = 0.1

/** Key of a board edge: 'A'…'D' or a cut-out edge (see the module comment). */
export type EdgeKey = string

export type EdgeKind = 'side' | 'chamfer' | 'notch' | 'arc' | 'slot'

export interface ContourEdge {
  key: EdgeKey
  /** Display letter: A–D for the board sides, E, F, G… for the cut-out edges. */
  label: string
  kind: EdgeKind
  /** Cut-out the edge belongs to (cut-out edges only). */
  cutoutId?: string
  /** Polyline of the edge (≥ 2 points; an arc is tessellated), `from` = first point, `to` = last point. */
  points: Vec2[]
  from: Vec2
  to: Vec2
  /** Arc edges: centre and radius of the arc. */
  arc?: { center: Vec2; radius: number }
}

interface ShapeInput {
  width: number
  height: number
  cutouts?: Cutout[]
  /** Edge bands – when given, editing keeps MIN_EDGE_MM of core material next to the bands. */
  edgeBanding?: EdgeBanding
}

// ---- geometry of single cut-outs ------------------------------------------------------------------

/** Corner point and the directions pointing into the board (sx along X, sy along Y). */
export function cornerGeometry(corner: Corner, W: number, H: number): { point: Vec2; sx: 1 | -1; sy: 1 | -1 } {
  switch (corner) {
    case 'AB':
      return { point: [W, H], sx: -1, sy: -1 }
    case 'BC':
      return { point: [W, 0], sx: -1, sy: 1 }
    case 'CD':
      return { point: [0, 0], sx: 1, sy: 1 }
    case 'DA':
      return { point: [0, H], sx: 1, sy: -1 }
  }
}

/** Points of a corner cut-out: on the horizontal edge (A / C), on the vertical edge (B / D), the inner corner. */
export function cutoutPoints(c: CornerCutout, W: number, H: number): { onX: Vec2; onY: Vec2; inner: Vec2; corner: Vec2 } {
  const { point, sx, sy } = cornerGeometry(c.corner, W, H)
  return {
    corner: point,
    onX: [point[0] + sx * c.x, point[1]],
    onY: [point[0], point[1] + sy * c.y],
    inner: [point[0] + sx * c.x, point[1] + sy * c.y],
  }
}

/**
 * Frame of a slot edge: reference corner (`origin`), unit direction along the edge (`along`), unit
 * direction into the board (`inward`), edge length and the board size across the edge.
 */
export function slotFrame(edge: EdgeId, W: number, H: number) {
  const f: Record<EdgeId, { origin: Vec2; along: Vec2; inward: Vec2; corner: Corner }> = {
    A: { origin: [0, H], along: [1, 0], inward: [0, -1], corner: 'DA' },
    B: { origin: [W, 0], along: [0, 1], inward: [-1, 0], corner: 'BC' },
    C: { origin: [0, 0], along: [1, 0], inward: [0, 1], corner: 'CD' },
    D: { origin: [0, 0], along: [0, 1], inward: [1, 0], corner: 'CD' },
  }
  const horizontal = edge === 'A' || edge === 'C'
  return { ...f[edge], horizontal, length: horizontal ? W : H, across: horizontal ? H : W }
}

const at = (o: Vec2, a: Vec2, s: number, n: Vec2, d: number): Vec2 => [o[0] + a[0] * s + n[0] * d, o[1] + a[1] * s + n[1] * d]

/** Points of a slot: mouth m1 (near the reference corner), mouth m2, bottom b1 / b2 and the bottom middle. */
export function slotPoints(c: SlotCutout, W: number, H: number) {
  const f = slotFrame(c.edge, W, H)
  const { origin: o, along: a, inward: n } = f
  return {
    m1: at(o, a, c.offset, n, 0),
    m2: at(o, a, c.offset + c.width, n, 0),
    b1: at(o, a, c.offset, n, c.depth),
    b2: at(o, a, c.offset + c.width, n, c.depth),
    bottomMid: at(o, a, c.offset + c.width / 2, n, c.depth),
  }
}

/** Number of straight segments of a quarter-circle arc (fine = rendering, coarse = validation). */
function arcSegments(r: number, fine: boolean): number {
  return fine ? Math.max(8, Math.min(72, Math.ceil((r * Math.PI) / 2 / 3))) : 6
}

/** Walking the outline clockwise, corner cut-outs are entered from a vertical edge at DA / BC. */
const ARRIVES_VERTICAL: Record<Corner, boolean> = { DA: true, AB: false, BC: true, CD: false }

/** Points of a rounded corner from the point where the arc starts (walking clockwise) to where it ends. */
export function radiusArcPoints(c: CornerCutout, W: number, H: number, fine = true): Vec2[] {
  const { point, sx, sy } = cornerGeometry(c.corner, W, H)
  const r = c.x
  const center: Vec2 = [point[0] + sx * r, point[1] + sy * r]
  const p = cutoutPoints(c, W, H)
  const pin = ARRIVES_VERTICAL[c.corner] ? p.onY : p.onX
  const pout = ARRIVES_VERTICAL[c.corner] ? p.onX : p.onY
  const a0 = Math.atan2(pin[1] - center[1], pin[0] - center[0])
  let a1 = Math.atan2(pout[1] - center[1], pout[0] - center[0])
  if (a1 > a0) a1 -= 2 * Math.PI // clockwise = decreasing angle
  const n = arcSegments(r, fine)
  const pts: Vec2[] = [pin]
  for (let i = 1; i < n; i++) {
    const t = a0 + ((a1 - a0) * i) / n
    pts.push([center[0] + r * Math.cos(t), center[1] + r * Math.sin(t)])
  }
  pts.push(pout)
  return pts
}

/** Polygon of the material removed by a cut-out (for drawing the hatched area). */
export function cutoutRemovedPolygon(c: Cutout, W: number, H: number): Vec2[] {
  if (isSlot(c)) {
    const s = slotPoints(c, W, H)
    return [s.m1, s.b1, s.b2, s.m2]
  }
  const p = cutoutPoints(c, W, H)
  if (c.kind === 'chamfer') return [p.corner, p.onX, p.onY]
  if (c.kind === 'notch') return [p.corner, p.onX, p.inner, p.onY]
  return [p.corner, ...radiusArcPoints(c, W, H)]
}

/** Reference corner of a cut-out – (0, 0) of its X / Y distances. */
export function cutoutReference(c: Cutout, W: number, H: number): { point: Vec2; inward: Vec2 } {
  if (isSlot(c)) {
    const f = slotFrame(c.edge, W, H)
    const g = cornerGeometry(f.corner, W, H)
    return { point: f.origin, inward: [g.sx, g.sy] }
  }
  const g = cornerGeometry(c.corner, W, H)
  return { point: g.point, inward: [g.sx, g.sy] }
}

/** Distances [X, Y] of a point from the reference corner of a cut-out (always ≥ 0). */
export function distFromReference(c: Cutout, W: number, H: number, p: Vec2): Vec2 {
  const { point } = cutoutReference(c, W, H)
  const r = (v: number) => Number(v.toFixed(3)) || 0
  return [r(Math.abs(p[0] - point[0])), r(Math.abs(p[1] - point[1]))]
}

// ---- outline --------------------------------------------------------------------------------------

/** Edge leaving each corner when walking clockwise. */
const LEAVING: Record<Corner, EdgeId> = { DA: 'A', AB: 'B', BC: 'C', CD: 'D' }
/** Walking clockwise goes along the slot frame direction on A (→) and D (↑), against it on B (↓) and C (←). */
const WALK_ALONG: Record<EdgeId, boolean> = { A: true, B: false, C: false, D: true }

const LETTERS = 'EFGHIJKLMNOPQRSTUVWXYZ'

/** Edge keys of a cut-out in the order the letters are assigned. */
export function cutoutEdgeKeys(c: Cutout): EdgeKey[] {
  switch (c.kind) {
    case 'chamfer':
      return [`${c.id}:s`]
    case 'notch':
      return [`${c.id}:x`, `${c.id}:y`]
    case 'radius':
      return [`${c.id}:r`]
    case 'slot':
      return [`${c.id}:w1`, `${c.id}:b`, `${c.id}:w2`]
  }
}

/** Display letters of the cut-out edges (in the order of the cut-outs). */
export function cutoutEdgeLabels(cutouts: Cutout[]): Map<EdgeKey, string> {
  const labels = new Map<EdgeKey, string>()
  let i = 0
  for (const c of cutouts) {
    for (const k of cutoutEdgeKeys(c)) {
      labels.set(k, i < LETTERS.length ? LETTERS[i] : `Z${i - LETTERS.length + 1}`)
      i++
    }
  }
  return labels
}

interface Vert {
  p: Vec2
  key: EdgeKey
  kind: EdgeKind
  cutoutId?: string
  arc?: { center: Vec2; radius: number }
}

/**
 * Outline of the board (clockwise, starting at the beginning of edge A) as a list of edges.
 * Uses the cut-outs as given – call `boardCutouts` first to get valid ones. Zero-length edges
 * (e.g. edge B removed by a full-height chamfer) are left out; arcs are tessellated
 * (`fine` = for rendering, otherwise a few segments for fast validation).
 */
export function contourFromCutouts(W: number, H: number, cutouts: Cutout[], fine = true): ContourEdge[] {
  const byCorner = new Map<Corner, CornerCutout>()
  const slots = new Map<EdgeId, SlotCutout[]>()
  for (const c of cutouts) {
    if (isSlot(c)) slots.set(c.edge, [...(slots.get(c.edge) ?? []), c])
    else byCorner.set(c.corner, c)
  }
  const labels = cutoutEdgeLabels(cutouts)
  const verts: Vert[] = []
  for (const corner of CORNERS) {
    const leaving = LEAVING[corner]
    const c = byCorner.get(corner)
    if (!c) {
      verts.push({ p: cornerGeometry(corner, W, H).point, key: leaving, kind: 'side' })
    } else {
      const pts = cutoutPoints(c, W, H)
      const arrivesV = ARRIVES_VERTICAL[corner]
      const pin = arrivesV ? pts.onY : pts.onX
      const pout = arrivesV ? pts.onX : pts.onY
      if (c.kind === 'chamfer') {
        verts.push({ p: pin, key: `${c.id}:s`, kind: 'chamfer', cutoutId: c.id })
      } else if (c.kind === 'notch') {
        // from the vertical edge the first notch edge is horizontal (x), from the horizontal one vertical (y)
        verts.push({ p: pin, key: `${c.id}:${arrivesV ? 'x' : 'y'}`, kind: 'notch', cutoutId: c.id })
        verts.push({ p: pts.inner, key: `${c.id}:${arrivesV ? 'y' : 'x'}`, kind: 'notch', cutoutId: c.id })
      } else {
        const g = cornerGeometry(corner, W, H)
        const arc = { center: [g.point[0] + g.sx * c.x, g.point[1] + g.sy * c.x] as Vec2, radius: c.x }
        const arcPts = radiusArcPoints(c, W, H, fine)
        for (const p of arcPts.slice(0, -1)) verts.push({ p, key: `${c.id}:r`, kind: 'arc', cutoutId: c.id, arc })
      }
      verts.push({ p: pout, key: leaving, kind: 'side' })
    }
    // U slots on the edge leaving this corner, in the walking order
    const along = WALK_ALONG[leaving]
    const onEdge = [...(slots.get(leaving) ?? [])].sort((a, b) => (along ? a.offset - b.offset : b.offset - a.offset))
    for (const s of onEdge) {
      const p = slotPoints(s, W, H)
      const v = (pt: Vec2, part: string): Vert => ({ p: pt, key: `${s.id}:${part}`, kind: 'slot', cutoutId: s.id })
      if (along) verts.push(v(p.m1, 'w1'), v(p.b1, 'b'), v(p.b2, 'w2'), { p: p.m2, key: leaving, kind: 'side' })
      else verts.push(v(p.m2, 'w2'), v(p.b2, 'b'), v(p.b1, 'w1'), { p: p.m1, key: leaving, kind: 'side' })
    }
  }
  // drop zero-length edges (vertex equal to the next one)
  const kept = verts.filter((v, i) => !samePoint(v.p, verts[(i + 1) % verts.length].p))
  // consecutive vertices with the same key (tessellated arcs) form one edge
  const edges: ContourEdge[] = []
  for (let i = 0; i < kept.length; i++) {
    const v = kept[i]
    const next = kept[(i + 1) % kept.length].p
    const last = edges[edges.length - 1]
    if (last && last.key === v.key && v.kind === 'arc') {
      last.points.push(next)
      last.to = next
      continue
    }
    edges.push({
      key: v.key,
      label: v.kind === 'side' ? v.key : labels.get(v.key) ?? '?',
      kind: v.kind,
      cutoutId: v.cutoutId,
      points: [v.p, next],
      from: v.p,
      to: next,
      arc: v.arc,
    })
  }
  return edges
}

/** Length of an edge polyline [mm]. */
export function edgeLength(e: ContourEdge): number {
  let l = 0
  for (let i = 1; i < e.points.length; i++) {
    l += Math.hypot(e.points[i][0] - e.points[i - 1][0], e.points[i][1] - e.points[i - 1][1])
  }
  return l
}

/** Middle of an edge (by length) and the unit direction of the edge there. */
export function edgeMidpoint(e: ContourEdge): { point: Vec2; dir: Vec2 } {
  const half = edgeLength(e) / 2
  let acc = 0
  for (let i = 1; i < e.points.length; i++) {
    const a = e.points[i - 1]
    const b = e.points[i]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (acc + l >= half - 1e-9 || i === e.points.length - 1) {
      const t = l > 0 ? (half - acc) / l : 0
      return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: l > 0 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : [1, 0] }
    }
    acc += l
  }
  return { point: e.from, dir: [1, 0] }
}

/** One entry per edge key (a side split by a U slot is listed once). */
export function uniqueEdges(edges: ContourEdge[]): ContourEdge[] {
  const seen = new Set<EdgeKey>()
  return edges.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)))
}

// ---- validation -----------------------------------------------------------------------------------

function paramsInBounds(c: Cutout, W: number, H: number): boolean {
  const e = 1e-9
  if (isSlot(c)) {
    const f = slotFrame(c.edge, W, H)
    return c.offset >= MIN_CUT_MM - e && c.width >= MIN_CUT_MM - e && c.depth >= MIN_CUT_MM - e && c.offset + c.width <= f.length + e && c.depth <= f.across + e
  }
  if (c.kind === 'radius' && Math.abs(c.x - c.y) > e) return false
  return c.x >= MIN_CUT_MM - e && c.y >= MIN_CUT_MM - e && c.x <= W + e && c.y <= H + e
}

/**
 * True when the cut-outs give a valid board: at most one cut-out per corner, a simple (non
 * self-intersecting) outline and every straight edge either removed or at least MIN_EDGE_MM long.
 */
export function areCutoutsValid(W: number, H: number, cutouts: Cutout[]): boolean {
  if (!(W > 0 && H > 0)) return false
  const corners = new Set<Corner>()
  for (const c of cutouts) {
    if (!paramsInBounds(c, W, H)) return false
    if (isSlot(c)) continue
    if (corners.has(c.corner)) return false
    corners.add(c.corner)
  }
  const edges = contourFromCutouts(W, H, cutouts, false)
  if (edges.some((e) => e.kind !== 'arc' && edgeLength(e) < MIN_EDGE_MM - 1e-6)) return false
  if (!isSimplePolygon(edges.flatMap((e) => e.points.slice(0, -1)))) return false
  // no material web narrower than MIN_EDGE_MM (e.g. the bottom of a U slot 0,1 mm from the opposite edge)
  const n = edges.length
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue // neighbours through the wrap-around
      if (polylineDistance(edges[i].points, edges[j].points) < MIN_EDGE_MM - 1e-6) return false
    }
  }
  return true
}

/**
 * Band-aware rules: the core (outline offset inwards by the band of every edge) must be a valid polygon,
 * every straight core edge at least MIN_EDGE_MM long, no core web narrower than MIN_EDGE_MM and every
 * banded arc must keep a core radius of at least MIN_EDGE_MM. Without bands always true.
 */
export function areBandsValid(W: number, H: number, cutouts: Cutout[], banding: EdgeBanding | undefined): boolean {
  if (!banding) return true
  const edges = contourFromCutouts(W, H, cutouts, false)
  const t = edges.map((e) => resolveEdgeBand(banding, e.key)?.thickness ?? 0)
  if (t.every((v) => v === 0)) return true
  const segs: { from: Vec2; to: Vec2; t: number }[] = []
  const first: number[] = []
  edges.forEach((e, i) => {
    first.push(segs.length)
    for (let j = 1; j < e.points.length; j++) segs.push({ from: e.points[j - 1], to: e.points[j], t: t[i] })
  })
  const oe = offsetEdges(segs)
  const core = coreFrom(oe)
  if (!isCoreValid(core, oe)) return false
  const eps = 1e-6
  // core polyline of every edge
  const corePts = edges.map((e, i) => {
    const s0 = first[i]
    const count = e.points.length - 1
    const pts: Vec2[] = []
    for (let j = 0; j <= count; j++) pts.push(core[(s0 + j) % core.length])
    return pts
  })
  // arcs are tangent to their neighbours: the core at a tangent point lies exactly on the normal of the
  // neighbouring straight edge (the tessellated arc would shift the offset intersection a little)
  const nInOf = (i: number) => oe[first[i]].nIn
  edges.forEach((e, i) => {
    const prev = (i - 1 + edges.length) % edges.length
    const next = (i + 1) % edges.length
    const off = (p: Vec2, n: Vec2, d: number): Vec2 => [p[0] + n[0] * d, p[1] + n[1] * d]
    if (e.kind === 'arc') {
      if (edges[prev].kind !== 'arc') corePts[i][0] = off(e.from, nInOf(prev), t[i])
      if (edges[next].kind !== 'arc') corePts[i][corePts[i].length - 1] = off(e.to, nInOf(next), t[i])
    } else {
      if (edges[prev].kind === 'arc') corePts[i][0] = off(e.from, nInOf(i), t[i])
      if (edges[next].kind === 'arc') corePts[i][corePts[i].length - 1] = off(e.to, nInOf(i), t[i])
    }
  })
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]
    if (e.kind === 'arc') {
      if (t[i] > 0 && e.arc && e.arc.radius - t[i] < MIN_EDGE_MM - eps) return false
      continue
    }
    const a = corePts[i][0]
    const b = corePts[i][corePts[i].length - 1]
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < MIN_EDGE_MM - eps) return false
  }
  const n = edges.length
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      if (polylineDistance(corePts[i], corePts[j]) < MIN_EDGE_MM - eps) return false
    }
  }
  return true
}

function segmentDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  const pd = (p: Vec2, s0: Vec2, s1: Vec2) => {
    const vx = s1[0] - s0[0]
    const vy = s1[1] - s0[1]
    const l2 = vx * vx + vy * vy
    const t = l2 > 0 ? clamp(((p[0] - s0[0]) * vx + (p[1] - s0[1]) * vy) / l2, 0, 1) : 0
    return Math.hypot(p[0] - s0[0] - vx * t, p[1] - s0[1] - vy * t)
  }
  // (segments do not cross – checked by isSimplePolygon)
  return Math.min(pd(a, c, d), pd(b, c, d), pd(c, a, b), pd(d, a, b))
}

function bbox(p: Vec2[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of p) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
  }
  return [x0, y0, x1, y1]
}

function polylineDistance(p: Vec2[], q: Vec2[]): number {
  // bounding boxes further apart than the limit → no need for the exact distance
  const a = bbox(p)
  const b = bbox(q)
  const gap = Math.max(a[0] - b[2], b[0] - a[2], a[1] - b[3], b[1] - a[3])
  if (gap >= MIN_EDGE_MM) return gap
  let m = Infinity
  for (let i = 1; i < p.length; i++) for (let j = 1; j < q.length; j++) m = Math.min(m, segmentDistance(p[i - 1], p[i], q[j - 1], q[j]))
  return m
}

const floorStep = (v: number) => Number((Math.floor(v / CUT_STEP + 1e-6) * CUT_STEP).toFixed(3))
const ceilStep = (v: number) => Number((Math.ceil(v / CUT_STEP - 1e-6) * CUT_STEP).toFixed(3))
const roundStep = (v: number) => Number((Math.round(v / CUT_STEP) * CUT_STEP).toFixed(3))
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Value closest to `target` (in lo … hi, on the CUT_STEP grid) for which `valid` holds:
 *  - the target itself when valid,
 *  - otherwise the nearest valid value within MIN_EDGE_MM (the gaps left by the minimum edge length),
 *  - otherwise the value as close to the target as possible coming from `current` (blocked by another
 *    cut-out or the board border) – `current` when nothing better exists.
 */
export function constrain1D(valid: (v: number) => boolean, target: number, current: number, lo: number, hi: number): number {
  const v = clamp(roundStep(target), lo, hi)
  if (valid(v)) return v
  const towards = current < v ? -1 : 1
  const steps = Math.round(MIN_EDGE_MM / CUT_STEP)
  for (let i = 1; i <= steps; i++) {
    for (const s of [towards, -towards]) {
      const c = roundStep(v + s * i * CUT_STEP)
      if (c >= lo - 1e-9 && c <= hi + 1e-9 && valid(c)) return c
    }
  }
  if (!valid(current)) return current
  let a = current
  let b = v
  for (let i = 0; i < 40 && Math.abs(b - a) > CUT_STEP / 4; i++) {
    const m = (a + b) / 2
    if (valid(m)) a = m
    else b = m
  }
  return lastValidOnGrid(valid, a, current, v)
}

/**
 * Bisection result `a` (valid side, between `from` and `to`) → the last valid value on the CUT_STEP grid
 * going from `from` towards `to` (the bisection stops a tiny bit before the exact limit).
 */
function lastValidOnGrid(valid: (v: number) => boolean, a: number, from: number, to: number): number {
  const dir = to > from ? 1 : -1
  let r = dir > 0 ? floorStep(a) : ceilStep(a)
  for (let i = 0; i < 20 && !valid(r) && r !== from; i++) r = roundStep(r - dir * CUT_STEP)
  if (!valid(r)) return from
  for (let i = 0; i < 20; i++) {
    const n = roundStep(r + dir * CUT_STEP)
    if ((dir > 0 ? n > to + 1e-9 : n < to - 1e-9) || !valid(n)) break
    r = n
  }
  return r
}

// ---- fitting to the board size --------------------------------------------------------------------

const fitCache = new Map<string, Cutout[]>()

/** Scaled-down copy of a cut-out (k = 1 as is, k = 0 smallest). */
function shrunk(c: Cutout, k: number, W: number, H: number): Cutout {
  const s = (v: number) => roundStep(MIN_CUT_MM + (v - MIN_CUT_MM) * k)
  if (isSlot(c)) {
    const f = slotFrame(c.edge, W, H)
    const width = s(c.width)
    const depth = Math.min(s(c.depth), f.across)
    const offset = clamp(c.offset, MIN_CUT_MM, Math.max(MIN_CUT_MM, f.length - MIN_EDGE_MM - width))
    return { ...c, offset: roundStep(offset), width, depth }
  }
  return { ...c, x: s(c.x), y: s(c.y) }
}

/** Cut-out with its values clamped to the board size. */
function clamped(c: Cutout, W: number, H: number): Cutout {
  if (isSlot(c)) {
    const f = slotFrame(c.edge, W, H)
    const width = clamp(roundStep(c.width), MIN_CUT_MM, f.length)
    return {
      ...c,
      width,
      offset: clamp(roundStep(c.offset), MIN_CUT_MM, Math.max(MIN_CUT_MM, f.length - width)),
      depth: clamp(roundStep(c.depth), MIN_CUT_MM, f.across),
    }
  }
  if (c.kind === 'radius') {
    const r = clamp(roundStep(c.x), MIN_CUT_MM, Math.min(W, H))
    return { ...c, x: r, y: r }
  }
  return { ...c, x: clamp(roundStep(c.x), MIN_CUT_MM, W), y: clamp(roundStep(c.y), MIN_CUT_MM, H) }
}

/**
 * Makes the cut-outs valid for the board size: at most one per corner, values clamped to the board;
 * cut-outs that collide with earlier ones are shrunk or – when even the smallest one does not fit –
 * left out. The stored cut-outs are not changed, so typing a temporarily small board size is not
 * destructive.
 */
export function fitCutouts(W: number, H: number, cutouts: Cutout[] | undefined): Cutout[] {
  if (!cutouts?.length || W < MIN_CUT_MM || H < MIN_CUT_MM) return []
  const cacheKey = `${W}|${H}|${JSON.stringify(cutouts)}`
  const cached = fitCache.get(cacheKey)
  if (cached) return cached
  const out: Cutout[] = []
  for (const raw of cutouts) {
    if (isCornerCutout(raw) && out.some((o) => isCornerCutout(o) && o.corner === raw.corner)) continue
    const c = clamped(raw, W, H)
    const ok = (k: number) => areCutoutsValid(W, H, [...out, shrunk(c, k, W, H)])
    if (areCutoutsValid(W, H, [...out, c])) {
      out.push(c)
      continue
    }
    let a = -1
    if (ok(0)) {
      a = 0
      let b = 1
      for (let i = 0; i < 30; i++) {
        const m = (a + b) / 2
        if (ok(m)) a = m
        else b = m
      }
    }
    // the allowed values may have gaps (minimum edge length) → step down until a valid size is found
    for (let k = a; k >= 0; k -= 0.02) {
      if (ok(k)) {
        out.push(shrunk(c, k, W, H))
        break
      }
    }
  }
  if (fitCache.size > 300) fitCache.clear()
  fitCache.set(cacheKey, out)
  return out
}

/** Valid cut-outs of a board (see `fitCutouts`). */
export function boardCutouts(p: ShapeInput): Cutout[] {
  return fitCutouts(p.width, p.height, p.cutouts)
}

/** Outline of the board with its (fitted) cut-outs. */
export function boardContour(p: ShapeInput, fine = true): ContourEdge[] {
  return contourFromCutouts(p.width, p.height, boardCutouts(p), fine)
}

// ---- editing --------------------------------------------------------------------------------------

/** Parameters of a cut-out shown in the form. */
export function cutoutParams(c: Cutout): CutoutParam[] {
  if (isSlot(c)) return ['offset', 'width', 'depth']
  return c.kind === 'radius' ? ['r'] : ['x', 'y']
}

export function getCutoutParam(c: Cutout, p: CutoutParam): number {
  if (isSlot(c)) return p === 'offset' ? c.offset : p === 'width' ? c.width : c.depth
  return p === 'y' ? c.y : c.x
}

export function withCutoutParam(c: Cutout, p: CutoutParam, v: number): Cutout {
  if (isSlot(c)) return { ...c, [p]: v }
  if (p === 'r' || c.kind === 'radius') return { ...c, x: v, y: v }
  return { ...c, [p]: v }
}

/** Static bounds of a parameter (the board size); validity narrows them further. */
function staticBounds(c: Cutout, p: CutoutParam, W: number, H: number): [number, number] {
  if (isSlot(c)) {
    const f = slotFrame(c.edge, W, H)
    return [MIN_CUT_MM, floorStep(p === 'depth' ? f.across : f.length)]
  }
  return [MIN_CUT_MM, floorStep(p === 'x' ? W : p === 'y' ? H : Math.min(W, H))]
}

/**
 * Validity of a changed cut-out: outline rules + band rules (`areBandsValid`). When the current state
 * already breaks the band rules (e.g. a thicker band was chosen afterwards), only the outline rules are
 * used, so the cut-out can still be edited (the error stays shown until it is fixed).
 */
function validator(p: ShapeInput, id: string, build: (v: number) => Cutout, current: number) {
  const others = boardCutouts(p).filter((o) => o.id !== id)
  const index = boardCutouts(p).findIndex((o) => o.id === id)
  const listAt = (v: number) => {
    const list = [...others]
    list.splice(index, 0, build(v))
    return list
  }
  const geo = (v: number) => areCutoutsValid(p.width, p.height, listAt(v))
  const full = (v: number) => geo(v) && areBandsValid(p.width, p.height, listAt(v), p.edgeBanding)
  return full(current) ? full : geo
}

/**
 * Allowed range of one parameter of a cut-out (the other values unchanged): from the current value
 * down / up to the last valid value. Values inside the range can still be forbidden (a remaining edge
 * shorter than MIN_EDGE_MM) – they are snapped by `constrainCutoutParam`.
 */
const rangeCache = new Map<string, { min: number; max: number }>()

export function cutoutRange(p: ShapeInput, id: string, param: CutoutParam): { min: number; max: number } {
  // the same ranges are asked by the side panel and the floating editor → cache
  const key = `${p.width}|${p.height}|${JSON.stringify(p.cutouts)}|${JSON.stringify(p.edgeBanding ?? null)}|${id}|${param}`
  const hit = rangeCache.get(key)
  if (hit) return hit
  const r = computeRange(p, id, param)
  if (rangeCache.size > 500) rangeCache.clear()
  rangeCache.set(key, r)
  return r
}

function computeRange(p: ShapeInput, id: string, param: CutoutParam): { min: number; max: number } {
  const c = boardCutouts(p).find((o) => o.id === id)
  if (!c) return { min: MIN_CUT_MM, max: MIN_CUT_MM }
  const [lo, hi] = staticBounds(c, param, p.width, p.height)
  const cur = getCutoutParam(c, param)
  const valid = validator(p, id, (v) => withCutoutParam(c, param, v), cur)
  const edge = (to: number) => {
    if (valid(to)) return to
    let a = cur
    let b = to
    for (let i = 0; i < 40 && Math.abs(b - a) > CUT_STEP / 4; i++) {
      const m = (a + b) / 2
      if (valid(m)) a = m
      else b = m
    }
    return lastValidOnGrid(valid, a, cur, to)
  }
  return { min: Math.min(cur, edge(lo)), max: Math.max(cur, edge(hi)) }
}

/** Nearest allowed value of a parameter (see `constrain1D`). */
export function constrainCutoutParam(p: ShapeInput, id: string, param: CutoutParam, value: number): number {
  const c = boardCutouts(p).find((o) => o.id === id)
  if (!c) return value
  const [lo, hi] = staticBounds(c, param, p.width, p.height)
  const cur = getCutoutParam(c, param)
  return constrain1D(validator(p, id, (v) => withCutoutParam(c, param, v), cur), value, cur, lo, hi)
}

/** Sets a parameter of a cut-out (snapped to the nearest allowed value) and returns the new cut-out list. */
export function setCutoutParam(p: ShapeInput, id: string, param: CutoutParam, value: number): Cutout[] {
  const v = constrainCutoutParam(p, id, param, value)
  return boardCutouts(p).map((c) => (c.id === id ? withCutoutParam(c, param, v) : c))
}

/**
 * Generic 1D change of a cut-out: `build(t)` gives the cut-out for the value t (e.g. moving the start of
 * a slot while its end stays), constrained like `setCutoutParam`.
 */
export function setCutoutWith(
  p: ShapeInput,
  id: string,
  build: (t: number) => Cutout,
  target: number,
  current: number,
  lo: number,
  hi: number,
): Cutout[] {
  const valid = validator(p, id, build, current)
  const t = constrain1D(valid, target, current, lo, hi)
  return boardCutouts(p).map((c) => (c.id === id ? build(t) : c))
}

let cutoutCounter = 0
function newCutoutId(): string {
  cutoutCounter += 1
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `cut-${crypto.randomUUID().slice(0, 8)}`
    : `cut-${Date.now().toString(36)}-${cutoutCounter}`
}

/** Corners without a corner cut-out. */
export function freeCorners(cutouts: Cutout[]): Corner[] {
  return CORNERS.filter((c) => !cutouts.some((o) => isCornerCutout(o) && o.corner === c))
}

/**
 * Adds a new cut-out with default sizes shrunk to fit: corner kinds in the first free corner (or
 * `corner`), a U slot in the middle of the first edge where it fits (or `edge`). Returns null when
 * there is no room.
 */
export function addCutout(p: ShapeInput, kind: CutoutKind, where?: Corner | EdgeId): Cutout[] | null {
  const current = boardCutouts(p)
  const W = p.width
  const H = p.height
  // default size shrunk (if needed) so that it also leaves room for the edge bands
  const tryAdd = (c: Cutout) => {
    for (let k = 1; k >= 0; k -= 0.05) {
      const fitted = fitCutouts(W, H, [...current, k === 1 ? c : shrunk(c, k, W, H)])
      if (fitted.some((o) => o.id === c.id) && areBandsValid(W, H, fitted, p.edgeBanding)) return fitted
    }
    const fitted = fitCutouts(W, H, [...current, c])
    return fitted.some((o) => o.id === c.id) ? fitted : null
  }
  if (kind === 'slot') {
    const edges = where && SLOT_EDGES.includes(where as EdgeId) ? [where as EdgeId] : SLOT_EDGES
    for (const edge of edges) {
      const f = slotFrame(edge, W, H)
      const width = roundStep(Math.max(MIN_CUT_MM, Math.min(200, f.length / 3)))
      const depth = roundStep(Math.max(MIN_CUT_MM, Math.min(100, f.across / 3)))
      const offset = roundStep(Math.max(MIN_CUT_MM, (f.length - width) / 2))
      const res = tryAdd({ id: newCutoutId(), kind: 'slot', edge, offset, width, depth })
      if (res) return res
    }
    return null
  }
  const free = freeCorners(current)
  const target = where && free.includes(where as Corner) ? (where as Corner) : free[0]
  if (!target) return null
  const def = (full: number) => roundStep(Math.max(MIN_CUT_MM, Math.min(200, full / 3)))
  if (kind === 'radius') {
    const r = roundStep(Math.max(MIN_CUT_MM, Math.min(50, Math.min(W, H) / 4)))
    return tryAdd({ id: newCutoutId(), kind, corner: target, x: r, y: r })
  }
  return tryAdd({ id: newCutoutId(), kind, corner: target, x: def(W), y: def(H) })
}

/** Changes the type of a corner cut-out (the radius takes the smaller of the two distances). */
export function withCornerKind(c: CornerCutout, kind: CornerCutoutKind): CornerCutout {
  if (kind === 'radius') {
    const r = Math.min(c.x, c.y)
    return { ...c, kind, x: r, y: r }
  }
  return { ...c, kind }
}

/** Human readable corner names, e.g. "prawy górny" (vertical board) / "prawy tylny" (horizontal board). */
export function cornerLabel(orientation: 'vertical' | 'side' | 'horizontal', corner: Corner): string {
  const labels: Record<'vertical' | 'side' | 'horizontal', Record<Corner, string>> = {
    vertical: { AB: 'prawy górny', BC: 'prawy dolny', CD: 'lewy dolny', DA: 'lewy górny' },
    side: { AB: 'tylny górny', BC: 'tylny dolny', CD: 'przedni dolny', DA: 'przedni górny' },
    horizontal: { AB: 'prawy tylny', BC: 'prawy przedni', CD: 'lewy przedni', DA: 'lewy tylny' },
  }
  return labels[orientation][corner]
}

/** Short description of a cut-out edge for the panel next to its letter. */
export function edgeKindLabel(edge: ContourEdge): string | null {
  switch (edge.kind) {
    case 'chamfer':
      return 'skos'
    case 'notch':
      return edge.key.endsWith(':x') ? 'wyc. ↔' : 'wyc. ↕'
    case 'arc':
      return 'łuk R'
    case 'slot':
      return edge.key.endsWith(':b') ? 'U dno' : 'U bok'
    default:
      return null
  }
}

/** Short shape name for the board summary. */
export function shapeLabel(cutouts: Cutout[]): string {
  if (cutouts.length === 0) return 'prostokąt'
  const names: Record<CutoutKind, string> = { chamfer: 'skos', notch: 'wycięcie L', radius: 'zaokrąglenie', slot: 'wycięcie U' }
  return (Object.keys(names) as CutoutKind[])
    .map((k) => [k, cutouts.filter((c) => c.kind === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n}× ${names[k]}`)
    .join(', ')
}
