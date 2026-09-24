import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { BoardParams } from '../boards/board.ts'
import {
  MIN_CUT_MM,
  boardContour,
  boardCutouts,
  cornerGeometry,
  cutoutPoints,
  cutoutReference,
  cutoutRemovedPolygon,
  distFromReference,
  edgeLength,
  edgeMidpoint,
  isSlot,
  setCutoutParam,
  setCutoutWith,
  slotFrame,
  slotPoints,
  type CornerCutout,
  type Cutout,
  type SlotCutout,
} from '../boards/cutouts.ts'
import { resolveEdgeBand } from '../boards/edgeBanding.ts'
import { edgeBandColor } from '../boards/edgeBandCatalog.ts'
import type { Vec2 } from '../boards/polygon.ts'
import { formatNumber } from '../ui/format.ts'

/** Where the label of a point goes: point on a horizontal edge / on a vertical edge / inside the board. */
type Placement = 'edgeH' | 'edgeV' | 'inside'

interface Handle {
  key: string
  cutout: Cutout
  point: Vec2
  /** Distances of the point from the reference corner of the cut-out [mm] (label). */
  dist: Vec2
  /** Label of the small preview (only the value that changes). */
  short: string
  placement: Placement
  /** Direction into the board (components −1 / 0 / 1) – used to place the label. */
  inward: Vec2
  /** Axes the point moves along (cursor, arrow keys). */
  axes: 'x' | 'y' | 'xy'
  title: string
  /** New cut-out list for the point moved to `target` (board coordinates), values constrained. */
  move: (v: BoardParams, target: Vec2, step: number) => Cutout[]
}

interface Props {
  value: BoardParams
  onCutoutsChange: (cutouts: Cutout[]) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Big editor (floating window) – bigger handles, full labels of all points. */
  large?: boolean
}

/** Mouse drag precision [mm]: default 1 mm, Shift = 10 mm, Alt = 0,1 mm. */
const dragStep = (e: { shiftKey: boolean; altKey: boolean }) => (e.shiftKey ? 10 : e.altKey ? 0.1 : 1)
const snap = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(3))
const fmt = formatNumber

const NO_BAND_COLOR = '#9a9a9a'
const DRAG_HINT = '(Shift – co 10 mm, Alt – co 0,1 mm)'

const findCutout = <T extends Cutout>(v: BoardParams, id: string) => boardCutouts(v).find((c) => c.id === id) as T | undefined

/** Draggable points of a corner cut-out (chamfer: 2 ends, notch: + inner corner, radius: 2 tangent points). */
function cornerHandles(c: CornerCutout, W: number, H: number): Handle[] {
  const p = cutoutPoints(c, W, H)
  const g = cornerGeometry(c.corner, W, H)
  const inward: Vec2 = [g.sx, g.sy]
  const radius = c.kind === 'radius'
  // distance of the target from the corner along one axis, into the board
  const along = (v: BoardParams, target: Vec2, axis: 0 | 1, step: number) => {
    const cur = findCutout<CornerCutout>(v, c.id)!
    const cg = cornerGeometry(cur.corner, v.width, v.height)
    return snap((axis === 0 ? cg.sx : cg.sy) * (target[axis] - cg.point[axis]), step)
  }
  const hs: Handle[] = [
    {
      key: 'onX',
      cutout: c,
      point: p.onX,
      dist: distFromReference(c, W, H, p.onX),
      short: radius ? `R ${fmt(c.x)}` : `X ${fmt(c.x)}`,
      placement: 'edgeH',
      inward,
      axes: 'x',
      title: `Przeciągnij wzdłuż krawędzi, aby zmienić ${radius ? 'promień R' : 'X'} ${DRAG_HINT}`,
      move: (v, t, step) => setCutoutParam(v, c.id, radius ? 'r' : 'x', along(v, t, 0, step)),
    },
    {
      key: 'onY',
      cutout: c,
      point: p.onY,
      dist: distFromReference(c, W, H, p.onY),
      short: radius ? `R ${fmt(c.y)}` : `Y ${fmt(c.y)}`,
      placement: 'edgeV',
      inward,
      axes: 'y',
      title: `Przeciągnij wzdłuż krawędzi, aby zmienić ${radius ? 'promień R' : 'Y'} ${DRAG_HINT}`,
      move: (v, t, step) => setCutoutParam(v, c.id, radius ? 'r' : 'y', along(v, t, 1, step)),
    },
  ]
  if (c.kind === 'notch') {
    hs.unshift({
      key: 'inner',
      cutout: c,
      point: p.inner,
      dist: distFromReference(c, W, H, p.inner),
      short: `X ${fmt(c.x)} · Y ${fmt(c.y)}`,
      placement: 'inside',
      inward,
      axes: 'xy',
      title: `Przeciągnij, aby zmienić X i Y ${DRAG_HINT}`,
      move: (v, t, step) => {
        const list = setCutoutParam(v, c.id, 'x', along(v, t, 0, step))
        return setCutoutParam({ ...v, cutouts: list }, c.id, 'y', along({ ...v, cutouts: list }, t, 1, step))
      },
    })
  }
  return hs
}

/** Draggable points of a U slot: both ends of the mouth (start / width) and the middle of the bottom (position + depth). */
function slotHandles(c: SlotCutout, W: number, H: number): Handle[] {
  const p = slotPoints(c, W, H)
  const f = slotFrame(c.edge, W, H)
  const alongAxis = f.horizontal ? 'x' : 'y'
  const acrossAxis = f.horizontal ? 'y' : 'x'
  const onEdge: Placement = f.horizontal ? 'edgeH' : 'edgeV'
  /** Target → [distance along the edge from the reference corner, depth into the board]. */
  const local = (v: BoardParams, target: Vec2, step: number) => {
    const cur = findCutout<SlotCutout>(v, c.id)!
    const fr = slotFrame(cur.edge, v.width, v.height)
    const dx = target[0] - fr.origin[0]
    const dy = target[1] - fr.origin[1]
    return {
      cur,
      s: snap(dx * fr.along[0] + dy * fr.along[1], step),
      d: snap(dx * fr.inward[0] + dy * fr.inward[1], step),
    }
  }
  const lbl = (pt: Vec2) => distFromReference(c, W, H, pt)
  const shortOf = (pt: Vec2, axis: 'x' | 'y') => `${axis.toUpperCase()} ${fmt(lbl(pt)[axis === 'x' ? 0 : 1])}`
  return [
    {
      key: 'm1',
      cutout: c,
      point: p.m1,
      dist: lbl(p.m1),
      short: shortOf(p.m1, alongAxis),
      placement: onEdge,
      inward: f.inward,
      axes: alongAxis,
      title: `Przeciągnij, aby przesunąć początek wycięcia U (koniec zostaje) ${DRAG_HINT}`,
      move: (v, t, step) => {
        const { cur, s } = local(v, t, step)
        const end = cur.offset + cur.width
        return setCutoutWith(
          v,
          c.id,
          (o) => ({ ...cur, offset: o, width: Number((end - o).toFixed(3)) }),
          s,
          cur.offset,
          MIN_CUT_MM,
          end - MIN_CUT_MM,
        )
      },
    },
    {
      key: 'm2',
      cutout: c,
      point: p.m2,
      dist: lbl(p.m2),
      short: shortOf(p.m2, alongAxis),
      placement: onEdge,
      inward: f.inward,
      axes: alongAxis,
      title: `Przeciągnij, aby zmienić szerokość wycięcia U ${DRAG_HINT}`,
      move: (v, t, step) => {
        const { cur, s } = local(v, t, step)
        return setCutoutParam(v, c.id, 'width', s - cur.offset)
      },
    },
    {
      key: 'bottom',
      cutout: c,
      point: p.bottomMid,
      dist: lbl(p.bottomMid),
      short: shortOf(p.bottomMid, acrossAxis),
      placement: 'inside',
      inward: f.inward,
      axes: 'xy',
      title: `Przeciągnij wzdłuż krawędzi, aby przesunąć wycięcie U, w głąb – aby zmienić głębokość ${DRAG_HINT}`,
      move: (v, t, step) => {
        const { cur, s, d } = local(v, t, step)
        const list = setCutoutParam(v, c.id, 'offset', s - cur.width / 2)
        return setCutoutParam({ ...v, cutouts: list }, c.id, 'depth', d)
      },
    },
  ]
}

function cutoutHandles(c: Cutout, W: number, H: number): Handle[] {
  return isSlot(c) ? slotHandles(c, W, H) : cornerHandles(c, W, H)
}

interface LabelBox {
  handle: Handle
  text: string
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
  baseline: 'auto' | 'central' | 'hanging'
}

/** Base position of the label of a point (see `layoutLabels`). */
function labelAt(h: Handle, cx: number, cy: number, gap: number, large: boolean): LabelBox {
  const [ix, iy] = h.inward
  const text = large ? `X ${fmt(h.dist[0])} · Y ${fmt(h.dist[1])}` : h.short
  const box: LabelBox = { handle: h, text, x: cx, y: cy, anchor: 'middle', baseline: 'central' }
  if (h.placement === 'edgeH') {
    // outside the board, beyond the edge (iy = direction into the board, board Y up → screen Y down)
    box.y = cy + iy * gap
    box.baseline = iy > 0 ? 'hanging' : 'auto'
  } else if (h.placement === 'edgeV') {
    box.x = cx - ix * gap
    box.anchor = ix > 0 ? 'end' : 'start'
  } else {
    box.x = cx + ix * gap
    box.y = cy - iy * gap
    box.anchor = ix > 0 ? 'start' : ix < 0 ? 'end' : 'middle'
    box.baseline = iy > 0 ? 'auto' : iy < 0 ? 'hanging' : 'central'
  }
  return box
}

/** Approximate screen rectangle of a label [x0, y0, x1, y1]. */
function rect(b: LabelBox, charW: number, lineH: number): [number, number, number, number] {
  const w = b.text.length * charW
  const x0 = b.anchor === 'start' ? b.x : b.anchor === 'end' ? b.x - w : b.x - w / 2
  const y0 = b.baseline === 'hanging' ? b.y : b.baseline === 'auto' ? b.y - lineH : b.y - lineH / 2
  return [x0, y0, x0 + w, y0 + lineH]
}

/**
 * Point labels without overlaps: a label that would cover an already placed one is moved by a line
 * (labels on A / C further out of the board, the others up / down away from the covered label).
 */
function layoutLabels(boxes: LabelBox[], large: boolean, obstacles: Vec2[], height: number): LabelBox[] {
  const charW = large ? 6.6 : 5.6
  const lineH = large ? 15 : 12
  // edge letters (centres) are obstacles too
  const placed: [number, number, number, number][] = obstacles.map(([x, y]) => [x - 6, y - 7, x + 6, y + 7])
  const hit = (r: [number, number, number, number]) =>
    placed.some((q) => r[0] < q[2] && q[0] < r[2] && r[1] < q[3] && q[1] < r[3])
  return boxes.map((b0) => {
    // preferred direction: labels on A / C away from the board, the others downwards
    const pref = b0.handle.placement === 'edgeH' && b0.handle.inward[1] < 0 ? -1 : 1
    let best = b0
    for (const k of [0, 1, 2, -1, -2, 3, -3]) {
      const b = { ...b0, y: b0.y + pref * k * lineH }
      const r = rect(b, charW, lineH)
      if (r[1] < 0 || r[3] > height) continue
      if (!hit(r)) {
        best = b
        break
      }
    }
    placed.push(rect(best, charW, lineH))
    return best
  })
}

function PointLabel({ box, selected }: { box: LabelBox; selected: boolean }) {
  return (
    <text
      x={box.x}
      y={box.y}
      textAnchor={box.anchor}
      dominantBaseline={box.baseline}
      className={`shape-point-label${selected ? ' shape-point-label--selected' : ''}`}
    >
      {box.text}
    </text>
  )
}

/**
 * 2D view ("rzut") of a board with its cut-outs, A at the top (vertical board: seen from the front,
 * horizontal board: seen from above, front at the bottom).
 *  - the points of the cut-outs can be dragged (the values are limited to the allowed ones – the same
 *    as in the numeric inputs), a focused point can also be moved with the arrow keys,
 *  - every point has a label with its X / Y distances from the reference corner of the cut-out (0, 0),
 *  - the edges are drawn in the colour of their band and labelled (A–D, E, F…).
 */
export default function ShapeEditor2D({ value, onCutoutsChange, selectedId, onSelect, large = false }: Props) {
  const W = value.width
  const H = value.height
  const cutouts = boardCutouts(value)
  const edges = boardContour(value)
  const hatchId = `hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  // ---- layout: the board is drawn to scale in pixel coordinates -------------------------------
  const wrapRef = useRef<HTMLDivElement>(null)
  const [wrapWidth, setWrapWidth] = useState(large ? 560 : 250)
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setWrapWidth(el.clientWidth || (large ? 560 : 250))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [large])

  // margins for the edge letters and the point labels (the labels of the points on B / D go to the side)
  const padX = large ? 104 : 52
  const padY = large ? 40 : 26
  const maxH = large ? Math.min(520, Math.max(260, window.innerHeight * 0.55)) : 230
  const k = Math.max(1e-6, Math.min((wrapWidth - 2 * padX) / W, (maxH - 2 * padY) / H))
  const svgW = W * k + 2 * padX
  const svgH = H * k + 2 * padY
  const sx = (x: number) => padX + x * k
  const sy = (y: number) => padY + (H - y) * k
  const pts = (poly: Vec2[]) => poly.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')

  // ---- dragging -------------------------------------------------------------------------------
  const svgRef = useRef<SVGSVGElement>(null)
  const latest = useRef(value)
  latest.current = value
  const drag = useRef<{ pointerId: number; handle: Handle } | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const apply = (h: Handle, target: Vec2, step: number) => {
    const v = latest.current
    if (!boardCutouts(v).some((c) => c.id === h.cutout.id)) return
    const next = h.move(v, target, step)
    if (JSON.stringify(next) !== JSON.stringify(boardCutouts(v))) onCutoutsChange(next)
  }

  const toBoard = (clientX: number, clientY: number): Vec2 => {
    const r = svgRef.current!.getBoundingClientRect()
    return [(clientX - r.left - padX) / k, H - (clientY - r.top - padY) / k]
  }

  const onHandleDown = (h: Handle) => (e: PointerEvent<SVGElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as SVGElement).focus()
    svgRef.current?.setPointerCapture(e.pointerId)
    drag.current = { pointerId: e.pointerId, handle: h }
    setDraggingId(h.cutout.id)
    onSelect(h.cutout.id)
  }
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    apply(d.handle, toBoard(e.clientX, e.clientY), dragStep(e))
  }
  const endDrag = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag.current || drag.current.pointerId !== e.pointerId) return
    if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId)
    drag.current = null
    setDraggingId(null)
  }
  useEffect(() => () => void (drag.current = null), [])

  const onHandleKey = (h: Handle) => (e: KeyboardEvent<SVGElement>) => {
    const step = dragStep(e)
    let dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0
    let dy = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0
    if (h.axes === 'x') dy = 0
    if (h.axes === 'y') dx = 0
    if (!dx && !dy) return
    e.preventDefault()
    onSelect(h.cutout.id)
    apply(h, [h.point[0] + dx, h.point[1] + dy], step)
  }

  // ---- drawing --------------------------------------------------------------------------------
  const r = large ? 7 : 5
  const labelOffset = large ? 12 : 9
  const handles = cutouts.flatMap((c) => cutoutHandles(c, W, H))
  // a side split by U slots gets its letter only on its longest part
  const letterShown = edges.map((e, i) => {
    const len = (x: typeof e) => edgeLength(x)
    return !edges.some((o, j) => j !== i && o.key === e.key && (len(o) > len(e) || (len(o) === len(e) && j < i)))
  })
  const showLabel = (h: Handle) => large || h.cutout.id === selectedId || h.cutout.id === draggingId
  // selected cut-out first, so its labels keep their place and the others move away
  const labelOrder = [...handles.filter((h) => h.cutout.id === selectedId), ...handles.filter((h) => h.cutout.id !== selectedId)]
  const labels = layoutLabels(
    labelOrder.filter(showLabel).map((h) => labelAt(h, sx(h.point[0]), sy(h.point[1]), labelOffset, large)),
    large,
    edges.filter((_, i) => letterShown[i]).map((e) => {
      const { point, dir } = edgeMidpoint(e)
      const off = large ? 16 : 11
      return [sx(point[0]) - dir[1] * off, sy(point[1]) - dir[0] * off] as Vec2
    }),
    svgH,
  )

  return (
    <div ref={wrapRef} className={`shape-editor${large ? ' shape-editor--large' : ''}`}>
      <svg
        ref={svgRef}
        width={svgW}
        height={svgH}
        className="shape-editor-svg"
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        data-dragging={draggingId ?? undefined}
        role="group"
        aria-label="Rzut 2D płyty z wycięciami"
      >
        <defs>
          <pattern id={hatchId} patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="7" stroke="#c9a0a0" strokeWidth="2" />
          </pattern>
        </defs>

        {/* gross rectangle (dashed) and the removed parts (hatched) */}
        <rect x={sx(0)} y={sy(H)} width={W * k} height={H * k} className="shape-gross" />
        {cutouts.map((c) => (
          <polygon
            key={c.id}
            points={pts(cutoutRemovedPolygon(c, W, H))}
            fill={`url(#${hatchId})`}
            className={`shape-removed${c.id === selectedId ? ' shape-removed--selected' : ''}`}
            onPointerDown={(e) => {
              e.stopPropagation()
              onSelect(c.id)
            }}
          />
        ))}

        {/* the board */}
        <polygon points={pts(edges.flatMap((e) => e.points.slice(0, -1)))} className="shape-board" onPointerDown={() => onSelect(null)} />

        {/* edges in the colour of their band + letters */}
        {edges.map((e, i) => {
          const band = resolveEdgeBand(value.edgeBanding, e.key)
          const color = band ? edgeBandColor(band.typeId) : NO_BAND_COLOR
          const { point: mid, dir } = edgeMidpoint(e)
          // outward normal (left of a clockwise edge); board Y up → screen Y down
          const nx = -dir[1]
          const ny = dir[0]
          const off = large ? 16 : 11
          const selected = e.cutoutId !== undefined && e.cutoutId === selectedId
          return (
            <g key={`${e.key}#${i}`} data-edge={e.label} data-edge-key={e.key}>
              <polyline
                points={pts(e.points)}
                fill="none"
                stroke={color}
                strokeWidth={band ? (large ? 4 : 3) : 1.5}
                strokeDasharray={band ? undefined : '4 3'}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={selected ? 'shape-edge shape-edge--selected' : 'shape-edge'}
              />
              {letterShown[i] && (
                <text
                  x={sx(mid[0]) + nx * off}
                  y={sy(mid[1]) - ny * off}
                  className="shape-edge-label"
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {e.label}
                </text>
              )}
            </g>
          )
        })}

        {/* reference corners of the cut-outs = (0, 0) of the point labels */}
        {cutouts
          .filter((c) => large || c.id === selectedId)
          .map((c) => {
            const { point, inward } = cutoutReference(c, W, H)
            const cx = sx(point[0])
            const cy = sy(point[1])
            return (
              <g key={`corner-${c.id}`} className={`shape-corner${c.id === selectedId ? ' shape-corner--selected' : ''}`}>
                <circle cx={cx} cy={cy} r={3} />
                {(c.id === selectedId || !large) && (
                  <text
                    x={cx - inward[0] * 6}
                    y={cy + inward[1] * 12}
                    textAnchor={inward[0] > 0 ? 'end' : 'start'}
                    dominantBaseline="central"
                    className="shape-point-label shape-point-label--corner"
                  >
                    0, 0
                  </text>
                )}
              </g>
            )
          })}

        {/* draggable points + their X / Y labels */}
        {handles.map((h) => {
          const cx = sx(h.point[0])
          const cy = sy(h.point[1])
          const selected = h.cutout.id === selectedId
          return (
            <g key={`${h.cutout.id}-${h.key}`} data-handle={`${h.cutout.id}:${h.key}`}>
              <circle
                cx={cx}
                cy={cy}
                r={r}
                tabIndex={0}
                role="slider"
                aria-label={`Punkt wycięcia (${h.axes === 'xy' ? 'X i Y' : h.axes.toUpperCase()})`}
                aria-valuetext={`X ${fmt(h.dist[0])} mm, Y ${fmt(h.dist[1])} mm`}
                className={`shape-handle shape-handle--${h.axes}${selected ? ' shape-handle--selected' : ''}`}
                onPointerDown={onHandleDown(h)}
                onKeyDown={onHandleKey(h)}
                onFocus={() => onSelect(h.cutout.id)}
              >
                <title>{h.title}</title>
              </circle>
            </g>
          )
        })}
        {labels.map((b) => (
          <PointLabel key={`label-${b.handle.cutout.id}-${b.handle.key}`} box={b} selected={b.handle.cutout.id === selectedId} />
        ))}
      </svg>
    </div>
  )
}
