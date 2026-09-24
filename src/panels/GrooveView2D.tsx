import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import type { BoardParams } from '../boards/board.ts'
import { boardContour } from '../boards/cutouts.ts'
import { resolveEdgeBand } from '../boards/edgeBanding.ts'
import { edgeBandColor } from '../boards/edgeBandCatalog.ts'
import {
  boardGrooves,
  edgeAxis,
  grooveAcross,
  grooveAlongAxis,
  grooveProblem,
  isFaceSide,
  withGrooveParam,
  type Groove,
  type GrooveParam,
} from '../boards/grooves.ts'
import type { Vec2 } from '../boards/polygon.ts'
import type { EdgeId } from '../boards/edgeBanding.ts'
import { formatNumber } from '../ui/format.ts'

/**
 * 2D views of the grooves (frezowania) of a board – like the cut-out editor:
 *  - RZUT: the board (A at the top) with every groove – face 1 (seen) filled, face 2 dashed (seen through
 *    the board), edge grooves as hidden (dashed) channels from their edge. The selected groove has
 *    draggable points: its middle (position across), its far wall (width), its ends (start / length, when
 *    not through) and for an edge groove its bottom (depth),
 *  - PRZEKRÓJ (cross-section) of the selected groove – the board thickness with the channel: its bottom
 *    (depth), middle (position) and far wall (width) can be dragged too.
 * Values are limited like in the numeric fields (`withGrooveParam`). Shift – 10 mm steps, Alt – 0,1 mm.
 */

interface Props {
  value: BoardParams
  onGrooveChange: (groove: Groove) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  large?: boolean
}

interface Handle {
  key: string
  /** Point in the view's model coordinates. */
  point: Vec2
  axes: 'x' | 'y'
  label: string
  title: string
  /** New groove for the handle moved to `target` (model coordinates). */
  move: (g: Groove, target: Vec2, step: number) => Groove
}

const dragStep = (e: { shiftKey: boolean; altKey: boolean }) => (e.shiftKey ? 10 : e.altKey ? 0.1 : 1)
const snap = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(3))
const fmt = formatNumber
const HINT = '(Shift – co 10 mm, Alt – co 0,1 mm)'

/** Reference named in the labels: where `offset` is measured from. */
function offsetRef(g: Groove): string {
  if (!isFaceSide(g.side)) return g.across ? (edgeAxis(g.side) === 0 ? 'od D' : 'od C') : 'od strony 2'
  return g.dir === 'AC' ? 'od C' : 'od D'
}

/** An SVG with draggable handles in its own model coordinates (Y up). */
function DragView({
  width,
  height,
  toModel,
  toScreen,
  handles,
  groove,
  onChange,
  children,
  label,
  large,
  showLabels = true,
}: {
  width: number
  height: number
  toModel: (x: number, y: number) => Vec2
  toScreen: (p: Vec2) => Vec2
  handles: Handle[]
  groove: Groove | null
  onChange: (g: Groove) => void
  children: ReactNode
  label: string
  large: boolean
  /** Labels next to the points (off in a small view – the values are written under it). */
  showLabels?: boolean
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ pointerId: number; handle: Handle } | null>(null)
  const latest = useRef(groove)
  latest.current = groove
  const [dragging, setDragging] = useState<string | null>(null)
  const apply = (h: Handle, target: Vec2, step: number) => {
    const g = latest.current
    if (!g) return
    const next = h.move(g, target, step)
    if (JSON.stringify(next) !== JSON.stringify(g)) onChange(next)
  }
  const at = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = svgRef.current!.getBoundingClientRect()
    return toModel(e.clientX - r.left, e.clientY - r.top)
  }
  const r = large ? 7 : 5
  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="shape-editor-svg groove-svg"
      role="group"
      aria-label={label}
      data-dragging={dragging ?? undefined}
      onPointerMove={(e: PointerEvent<SVGSVGElement>) => {
        const d = drag.current
        if (d && d.pointerId === e.pointerId) apply(d.handle, at(e), dragStep(e))
      }}
      onPointerUp={(e) => {
        if (!drag.current || drag.current.pointerId !== e.pointerId) return
        if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId)
        drag.current = null
        setDragging(null)
      }}
      onLostPointerCapture={() => {
        drag.current = null
        setDragging(null)
      }}
    >
      {children}
      {handles.map((h) => {
        const [cx, cy] = toScreen(h.point)
        return (
          <g key={h.key} data-groove-handle={h.key}>
            <circle
              cx={cx}
              cy={cy}
              r={r}
              tabIndex={0}
              role="slider"
              aria-label={h.title}
              className={`shape-handle shape-handle--${h.axes} shape-handle--selected groove-handle`}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.preventDefault()
                e.stopPropagation()
                svgRef.current?.setPointerCapture(e.pointerId)
                drag.current = { pointerId: e.pointerId, handle: h }
                setDragging(h.key)
              }}
              onKeyDown={(e: KeyboardEvent<SVGElement>) => {
                const step = dragStep(e)
                const dx = h.axes === 'x' ? (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0) : 0
                const dy = h.axes === 'y' ? (e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0) : 0
                if (!dx && !dy) return
                e.preventDefault()
                apply(h, [h.point[0] + dx, h.point[1] + dy], step)
              }}
            >
              <title>{`${h.title} ${HINT}`}</title>
            </circle>
            {showLabels && (() => {
              // the near wall labelled to the left, the far wall to the right (they may be close), others beside / above
              const side = h.key === 'pos' || h.key === 'start' ? -1 : h.key === 'wall' || h.key === 'end' ? 1 : 0
              const x = side ? cx + side * (r + 4) : cx + (h.axes === 'x' ? 0 : r + 4)
              const y = side ? cy : cy + (h.axes === 'x' ? -(r + 4) : 0)
              const anchor = side < 0 ? 'end' : side > 0 || h.axes !== 'x' ? 'start' : 'middle'
              return (
                <text x={x} y={y} textAnchor={anchor} dominantBaseline="central" className="shape-point-label shape-point-label--selected">
                  {h.label}
                </text>
              )
            })()}
          </g>
        )
      })}
    </svg>
  )
}

function useWidth(large: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(large ? 560 : 250)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setW(el.clientWidth || (large ? 560 : 250))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [large])
  return [ref, w] as const
}

const param = (p: BoardParams, g: Groove, name: GrooveParam, v: number) => withGrooveParam(p, g, name, v)

/** Points of the rzut of the selected groove (board frame). */
function rzutHandles(p: BoardParams, g: Groove): Handle[] {
  const face = isFaceSide(g.side)
  // in-plane axis the groove (face) / its edge (edge grooves) runs along, and the other one
  const a = face ? (grooveAlongAxis(g) as 0 | 1) : edgeAxis(g.side as EdgeId)
  const c = a === 0 ? 1 : 0
  const ax = (i: number) => (i === 0 ? 'x' : 'y') as 'x' | 'y'
  const pt = (along: number, across: number): Vec2 => (a === 0 ? [along, across] : [across, along])
  const acrossEdge = !face && !!g.across
  // extent along `a` drawn in the rzut: the groove length, or its width for a groove across an edge
  const [e0, e1] = acrossEdge ? [g.offset, g.offset + g.width] : [g.start, g.start + g.length]
  const mid = (e0 + e1) / 2
  const hs: Handle[] = []
  if (face) {
    hs.push({
      key: 'pos',
      point: pt(mid - Math.min(g.length / 4, 40), g.offset),
      axes: ax(c),
      label: `${offsetRef(g)} ${fmt(g.offset)}`,
      title: 'Przeciągnij bliższą ściankę, aby przesunąć frez w poprzek (położenie liczone do niej)',
      move: (cur, t, s) => param(p, cur, 'offset', snap(t[c], s)),
    })
    hs.push({
      key: 'wall',
      point: pt(mid + Math.min(g.length / 4, 40), g.offset + g.width),
      axes: ax(c),
      label: `szer. ${fmt(g.width)}`,
      title: 'Przeciągnij, aby zmienić szerokość frezu',
      move: (cur, t, s) => param(p, cur, 'width', snap(t[c] - cur.offset, s)),
    })
  } else {
    // the bottom of an edge groove: `depth` from its edge
    const edgeAt = g.side === 'A' ? p.height : g.side === 'B' ? p.width : 0
    const sign = g.side === 'A' || g.side === 'B' ? -1 : 1
    hs.push({
      key: 'depth',
      point: pt(mid, edgeAt + sign * g.depth),
      axes: ax(c),
      label: `głęb. ${fmt(g.depth)}`,
      title: 'Przeciągnij, aby zmienić głębokość frezu w krawędzi',
      move: (cur, t, s) => param(p, cur, 'depth', snap(sign * (t[c] - edgeAt), s)),
    })
    if (acrossEdge) {
      const inside = edgeAt + (sign * g.depth) / 2
      hs.push({
        key: 'pos',
        point: pt(g.offset, inside),
        axes: ax(a),
        label: `${offsetRef(g)} ${fmt(g.offset)}`,
        title: 'Przeciągnij bliższą ściankę, aby przesunąć frez wzdłuż krawędzi',
        move: (cur, t, s) => param(p, cur, 'offset', snap(t[a], s)),
      })
      hs.push({
        key: 'wall',
        point: pt(g.offset + g.width, inside),
        axes: ax(a),
        label: `szer. ${fmt(g.width)}`,
        title: 'Przeciągnij, aby zmienić szerokość frezu',
        move: (cur, t, s) => param(p, cur, 'width', snap(t[a] - cur.offset, s)),
      })
    }
  }
  if (!g.through && !acrossEdge) {
    const acrossMid = face ? g.offset + g.width / 2 : rzutEdgeMid(p, g)
    hs.push({
      key: 'start',
      point: pt(g.start, acrossMid),
      axes: ax(a),
      label: `od ${fmt(g.start)}`,
      title: 'Przeciągnij, aby przesunąć początek frezu (koniec zostaje)',
      move: (cur, t, s) => {
        const end = cur.start + cur.length
        const start = Math.min(snap(t[a], s), end - 1)
        return param(p, param(p, cur, 'start', start), 'length', end - Math.max(start, 0))
      },
    })
    hs.push({
      key: 'end',
      point: pt(g.start + g.length, acrossMid),
      axes: ax(a),
      label: `dł. ${fmt(g.length)}`,
      title: 'Przeciągnij, aby zmienić długość frezu',
      move: (cur, t, s) => param(p, cur, 'length', snap(t[a] - cur.start, s)),
    })
  }
  return hs
}

/** Middle of the hidden channel of an edge groove across the board (for the end points in the rzut). */
function rzutEdgeMid(p: BoardParams, g: Groove): number {
  if (g.side === 'A') return p.height - g.depth / 2
  if (g.side === 'C') return g.depth / 2
  if (g.side === 'B') return p.width - g.depth / 2
  return g.depth / 2
}

/** Outline of a groove in the rzut (board frame): the channel on the face / in the edge. */
function rzutRect(p: BoardParams, g: Groove): [Vec2, Vec2] {
  const face = isFaceSide(g.side)
  const a = face ? (grooveAlongAxis(g) as 0 | 1) : edgeAxis(g.side as EdgeId)
  let lo: number
  let hi: number
  if (face) {
    lo = g.offset
    hi = g.offset + g.width
  } else if (g.side === 'A') {
    lo = p.height - g.depth
    hi = p.height
  } else if (g.side === 'B') {
    lo = p.width - g.depth
    hi = p.width
  } else {
    lo = 0
    hi = g.depth
  }
  const [s0, s1] = !face && g.across ? [g.offset, g.offset + g.width] : [g.start, g.start + g.length]
  return a === 0
    ? [
        [s0, lo],
        [s1, hi],
      ]
    : [
        [lo, s0],
        [hi, s1],
      ]
}

export function GrooveRzut({ value, onGrooveChange, selectedId, onSelect, large = false }: Props) {
  const W = value.width
  const H = value.height
  const grooves = boardGrooves(value)
  const edges = boardContour(value)
  const selected = grooves.find((g) => g.id === selectedId) ?? null
  const [wrapRef, wrapWidth] = useWidth(large)
  const padX = large ? 70 : 40
  const padY = large ? 34 : 24
  const maxH = large ? Math.min(520, Math.max(260, window.innerHeight * 0.5)) : 220
  const k = Math.max(1e-6, Math.min((wrapWidth - 2 * padX) / W, (maxH - 2 * padY) / H))
  const sx = (x: number) => padX + x * k
  const sy = (y: number) => padY + (H - y) * k
  const pts = (poly: Vec2[]) => poly.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')
  const handles = selected && !grooveProblem(value, selected) ? rzutHandles(value, selected) : []
  return (
    <div ref={wrapRef} className={`shape-editor${large ? ' shape-editor--large' : ''}`}>
      <DragView
        width={W * k + 2 * padX}
        height={H * k + 2 * padY}
        toModel={(x, y) => [(x - padX) / k, H - (y - padY) / k]}
        toScreen={([x, y]) => [sx(x), sy(y)]}
        handles={handles}
        groove={selected}
        onChange={onGrooveChange}
        label="Rzut płyty z frezowaniami"
        large={large}
        showLabels={large}
      >
        <polygon points={pts(edges.flatMap((e) => e.points.slice(0, -1)))} className="shape-board" onPointerDown={() => onSelect(null)} />
        {edges.map((e, i) => {
          const band = resolveEdgeBand(value.edgeBanding, e.key)
          const color = band ? edgeBandColor(band.typeId) : '#9a9a9a'
          return (
            <polyline
              key={`${e.key}#${i}`}
              points={pts(e.points)}
              fill="none"
              stroke={color}
              strokeWidth={band ? 3 : 1.5}
              strokeDasharray={band ? undefined : '4 3'}
            />
          )
        })}
        {(['A', 'B', 'C', 'D'] as const).map((l) => {
          const p: Vec2 = l === 'A' ? [W / 2, H] : l === 'C' ? [W / 2, 0] : l === 'B' ? [W, H / 2] : [0, H / 2]
          const off = large ? 16 : 11
          const d: Vec2 = l === 'A' ? [0, -off] : l === 'C' ? [0, off] : l === 'B' ? [off, 0] : [-off, 0]
          return (
            <text key={l} x={sx(p[0]) + d[0]} y={sy(p[1]) + d[1]} className="shape-edge-label" textAnchor="middle" dominantBaseline="central">
              {l}
            </text>
          )
        })}
        {grooves.map((g, i) => {
          const [a, b] = rzutRect(value, g)
          const bad = !!grooveProblem(value, g)
          const cls = [
            'groove-rect',
            isFaceSide(g.side) ? `groove-rect--${g.side}` : 'groove-rect--edge',
            g.id === selectedId ? 'groove-rect--selected' : '',
            bad ? 'groove-rect--bad' : '',
          ].join(' ')
          const x = Math.min(sx(a[0]), sx(b[0]))
          const y = Math.min(sy(a[1]), sy(b[1]))
          return (
            <g key={g.id} data-groove={g.id}>
              <rect
                x={x}
                y={y}
                width={Math.max(1, Math.abs(sx(b[0]) - sx(a[0])))}
                height={Math.max(1, Math.abs(sy(b[1]) - sy(a[1])))}
                className={cls}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  onSelect(g.id)
                }}
              >
                <title>{`Frez ${i + 1}${bad ? ' – krawędź z obrzeżem, frez pominięty' : ''}`}</title>
              </rect>
              {(large || g.id === selectedId) && (
                <text x={x + 3} y={y - 4} className="shape-point-label groove-no">
                  {i + 1}
                </text>
              )}
            </g>
          )
        })}
      </DragView>
    </div>
  )
}

/** Letters at the two ends of the cross-section: [the reference side of `offset`, the opposite one]. */
function sectionEnds(g: Groove): [string, string] {
  if (!isFaceSide(g.side)) return ['str. 2', 'str. 1']
  return g.dir === 'AC' ? ['C', 'A'] : ['D', 'B']
}

/**
 * Cross-section of the selected groove – the board PROFILE with the channel cut into it (open at the
 * face / edge it is milled from):
 *  - face groove: across the groove (horizontal, from its reference edge C / D on the left to A / B on the
 *    right – cut off around the groove when the board is wide) × the thickness (strona 1 at the top),
 *  - edge groove: the thickness (horizontal, strona 2 on the left) × the board from the edge (the edge at
 *    the top).
 * Dimension lines: the position from the reference side (to the near wall), the width and the depth.
 * Points: the near wall (position – the whole groove moves), the far wall (width), the bottom (depth).
 */
export function GrooveSection({ value, groove: g, onGrooveChange, large = false }: { value: BoardParams; groove: Groove; onGrooveChange: (g: Groove) => void; large?: boolean }) {
  const T = value.thickness
  const face = isFaceSide(g.side)
  const [wrapRef, wrapWidth] = useWidth(large)
  // model: u horizontal, v vertical (up)
  const span = grooveAcross(value, g)
  // A window of CONSTANT length slides along the board with the groove (clamped to the board), so the
  // scale – and the height of the drawing – does not change while the groove is moved / resized; it
  // grows (×2) only for a groove wider than the window. The whole board when it is shorter.
  const m = Math.max(3 * T, 20)
  // zoom levels: 10 × thickness, doubled only when the groove does not fit – the scale is the same for
  // every position and width within a level (linear), it changes in clear steps
  let level = 10 * T
  while (g.width + 2 * m > level && level < span) level *= 2
  const win = face ? Math.min(span, level) : T
  const centre = g.offset + g.width / 2
  const u0 = face ? Math.min(Math.max(0, centre - win / 2), span - win) : 0
  const u1 = u0 + win
  // edge groove: the board from its edge down (v = 0 there, the edge at vTop) – a constant part of it too
  const under = face ? T : edgeAxis(g.side as EdgeId) === 0 ? value.height : value.width
  const vTop = face ? T : Math.min(under, Math.max(5 * T, g.depth * 1.25))
  const padX = large ? 64 : 40
  // room for the two stacked dimension lines on the mouth side
  const padY = large ? 66 : 30
  const maxH = large ? 280 : 170
  const k = Math.max(1e-6, Math.min((wrapWidth - 2 * padX) / (u1 - u0), (maxH - 2 * padY) / vTop))
  const w = (u1 - u0) * k + 2 * padX
  const h = vTop * k + 2 * padY
  const su = (u: number) => padX + (u - u0) * k
  const sv = (v: number) => padY + (vTop - v) * k
  // the channel: across [a, b], from the mouth (vm) to the bottom (vb)
  // across an edge the section shows its run through the thickness (start / length), otherwise offset / width
  const acrossEdge = !face && !!g.across
  const a = acrossEdge ? g.start : g.offset
  const b = acrossEdge ? g.start + g.length : g.offset + g.width
  const [posParam, sizeParam]: [GrooveParam, GrooveParam] = acrossEdge ? ['start', 'length'] : ['offset', 'width']
  const posRef = acrossEdge ? 'od strony 2' : offsetRef(g)
  const fromBottom = face && g.side === 'back'
  const vm = fromBottom ? 0 : vTop
  const vb = fromBottom ? g.depth : vTop - g.depth
  // profile of the board with the channel (open at the mouth)
  const P = (u: number, v: number) => `${su(u)},${sv(v)}`
  const profile = fromBottom
    ? [P(u0, 0), P(a, 0), P(a, vb), P(b, vb), P(b, 0), P(u1, 0), P(u1, vTop), P(u0, vTop)]
    : [P(u0, 0), P(u1, 0), P(u1, vTop), P(b, vTop), P(b, vb), P(a, vb), P(a, vTop), P(u0, vTop)]
  // outline without the cut-off ends (those get break lines)
  const clippedL = face ? u0 > 1e-6 : false
  const clippedR = face ? u1 < span - 1e-6 : false
  const clippedBottom = !face && vTop < under
  const outline: string[][] = []
  if (fromBottom) {
    outline.push([P(u0, 0), P(a, 0), P(a, vb), P(b, vb), P(b, 0), P(u1, 0)])
    outline.push([P(u0, vTop), P(u1, vTop)])
  } else {
    outline.push([P(u0, vTop), P(a, vTop), P(a, vb), P(b, vb), P(b, vTop), P(u1, vTop)])
    if (!clippedBottom) outline.push([P(u0, 0), P(u1, 0)])
  }
  if (!clippedL) outline.push([P(u0, 0), P(u0, vTop)])
  if (!clippedR) outline.push([P(u1, 0), P(u1, vTop)])

  const handles: Handle[] = [
    {
      key: 'depth',
      point: [(a + b) / 2, vb],
      axes: 'y',
      label: `głęb. ${fmt(g.depth)}`,
      title: 'Przeciągnij dno, aby zmienić głębokość',
      move: (cur, t, st) => param(value, cur, 'depth', snap(fromBottom ? t[1] : vTop - t[1], st)),
    },
    {
      key: 'pos',
      point: [a, (vm + vb) / 2],
      axes: 'x',
      label: `${posRef} ${fmt(a)}`,
      title: 'Przeciągnij bliższą ściankę, aby przesunąć frez',
      move: (cur, t, st) => {
        // moving the near wall moves the groove (a through groove across an edge becomes a limited one)
        const next = acrossEdge && cur.through ? { ...cur, through: false } : cur
        return param(value, next, posParam, snap(t[0], st))
      },
    },
    {
      key: 'wall',
      point: [b, (vm + vb) / 2],
      axes: 'x',
      label: `${acrossEdge ? 'dł.' : 'szer.'} ${fmt(b - a)}`,
      title: acrossEdge ? 'Przeciągnij dalszą ściankę, aby zmienić długość (w grubości)' : 'Przeciągnij dalszą ściankę, aby zmienić szerokość',
      move: (cur, t, st) => {
        const next = acrossEdge && cur.through ? { ...cur, through: false } : cur
        return param(value, next, sizeParam, snap(t[0] - (acrossEdge ? next.start : next.offset), st))
      },
    },
  ]
  // dimension lines: outside the mouth side (position + width), next to the channel (depth)
  const out = fromBottom ? 1 : -1 // screen direction away from the mouth
  const dimY = sv(vm) + out * (large ? 22 : 14)
  const dimY2 = dimY + out * (large ? 16 : 0)
  const [refL, refR] = sectionEnds(g)
  const dimText = large ? 'groove-dim-text' : 'groove-dim-text groove-dim-text--small'
  return (
    <div ref={wrapRef} className={`shape-editor groove-section${large ? ' shape-editor--large' : ''}`}>
      <DragView
        width={w}
        height={h}
        toModel={(x, y) => [u0 + (x - padX) / k, vTop - (y - padY) / k]}
        toScreen={([u, v]) => [su(u), sv(v)]}
        handles={handles}
        groove={g}
        onChange={onGrooveChange}
        label="Przekrój frezu"
        large={large}
        showLabels={false}
      >
        <polygon points={profile.join(' ')} className="shape-board" />
        {outline.map((l, i) => (
          <polyline key={i} points={l.join(' ')} className="groove-profile" />
        ))}
        {clippedL && <line x1={su(u0)} y1={sv(0)} x2={su(u0)} y2={sv(vTop)} className="groove-break" />}
        {clippedR && <line x1={su(u1)} y1={sv(0)} x2={su(u1)} y2={sv(vTop)} className="groove-break" />}
        {clippedBottom && <line x1={su(0)} y1={sv(0)} x2={su(T)} y2={sv(0)} className="groove-break" />}
        {/* ends: the reference side on the left */}
        <text x={su(u0) - 6} y={sv(vTop / 2)} textAnchor="end" dominantBaseline="central" className="groove-section-end">
          {clippedL ? `← ${refL}` : refL}
        </text>
        <text x={su(u1) + 6} y={sv(vTop / 2)} textAnchor="start" dominantBaseline="central" className="groove-section-end">
          {clippedR ? `${refR} →` : refR}
        </text>
        {face && (
          <>
            <text x={su(u1) + 6} y={sv(vTop) - 2} textAnchor="start" className="groove-section-caption">str. 1</text>
            <text x={su(u1) + 6} y={sv(0) + 10} textAnchor="start" className="groove-section-caption">str. 2</text>
          </>
        )}
        {/* position: from the reference side to the near wall */}
        <g className="groove-dim">
          <line x1={su(u0)} y1={dimY} x2={su(a)} y2={dimY} />
          <line x1={su(a)} y1={sv(vm)} x2={su(a)} y2={dimY} className="groove-dim-ext" />
          {!clippedL && <line x1={su(u0)} y1={sv(vm)} x2={su(u0)} y2={dimY} className="groove-dim-ext" />}
          {large && (
            <text x={(su(u0) + su(a)) / 2} y={dimY + out * 4} textAnchor="middle" dominantBaseline={out < 0 ? 'auto' : 'hanging'} className={dimText}>
              {fmt(a)}
            </text>
          )}
        </g>
        {/* width */}
        <g className="groove-dim">
          <line x1={su(a)} y1={dimY2} x2={su(b)} y2={dimY2} />
          <line x1={su(b)} y1={sv(vm)} x2={su(b)} y2={dimY2} className="groove-dim-ext" />
          {large && (
            <text x={(su(a) + su(b)) / 2} y={dimY2 + out * 4} textAnchor="middle" dominantBaseline={out < 0 ? 'auto' : 'hanging'} className={dimText}>
              {fmt(b - a)}
            </text>
          )}
        </g>
        {/* depth: along the far wall, inside the channel */}
        <g className="groove-dim">
          <line x1={su(b) - 5} y1={sv(vm)} x2={su(b) - 5} y2={sv(vb)} />
          {large && (
            <text x={su(b) - 9} y={(sv(vm) + sv(vb)) / 2} textAnchor="end" dominantBaseline="central" className={dimText}>
              {fmt(g.depth)}
            </text>
          )}
        </g>
      </DragView>
      <div className="groove-section-values">
        {!face && `krawędź ${g.side} u góry · `}
        {acrossEdge
          ? `${offsetRef(g)} ${fmt(g.offset)} · szer. ${fmt(g.width)} · w grubości ${posRef} ${fmt(a)}, dł. ${fmt(b - a)} · głęb. ${fmt(g.depth)} mm`
          : `${offsetRef(g)} ${fmt(g.offset)} · szer. ${fmt(g.width)} · głęb. ${fmt(g.depth)} mm`}
        {face && ` · grubość ${fmt(T)} mm`}
        {face && win < span && ` · widoczne ${fmt(Math.round(win))} mm płyty`}
      </div>
    </div>
  )
}
