import { useEffect, useMemo, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import { Plane, Raycaster, Vector2, Vector3, type Camera } from 'three'
import { dimensionAxis, type Board } from '../boards/board.ts'
import type { Furniture } from '../furniture/furniture.ts'
import { RESIZE_LABELS, boardEdges, resizeBoard, type BoardEdge, type Vec3 } from '../boards/resize.ts'
import { formatNumber } from '../ui/format.ts'
import { isPointerClaimed } from './pointerClaims.ts'
import { AXIS_FACES, type Face } from '../layout/constraints.ts'

/**
 * Resizing the selected board by its (green) outline edges.
 *
 * Hovering an edge highlights it and shows a resize cursor; LMB + drag changes the board WIDTH or HEIGHT
 * (an edge along the thickness = a corner → both), see `boards/resize.ts`. The size is shown next to
 * the edge while dragging; the change goes through the normal board update (constraints follow).
 *
 * An edge that moves a face held by a joint is not draggable at all (the joint decides where that face
 * is; its offset is changed in the panel).
 *
 * Edges are picked in screen space by document listeners in the capture phase – after the constraint
 * handles (window listeners), which win where both overlap (`pointerClaims`). A press on an edge never
 * reaches the board drag / camera.
 */

/** Max distance [px] of the pointer from an edge that still grabs it. */
const EDGE_HIT_PX = 6
const EDGE_HOVER_COLOR = '#aeea00'

interface DragState {
  pointerId: number
  edge: BoardEdge
  /** Board at the start of the drag – the result is always computed from it (absolute, no drift). */
  start: Board
  /** Single dimension: the line the pointer is projected on; corner: the board plane. */
  lineOrigin: Vector3
  lineDir: Vector3
  plane: Plane | null
  /** Pointer projection at the start (line parameter or plane point). */
  startParam: number
  startPoint: Vector3
}

const vec = (p: Vec3) => new Vector3(p[0], p[1], p[2])
const AXIS = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]

/** Distance [px] from point P to segment AB (screen coordinates). */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Parameter s of the point on the line O + s·D closest to the ray (null when looking along the line). */
function closestOnLine(origin: Vector3, dir: Vector3, rayOrigin: Vector3, rayDir: Vector3): number | null {
  const w0 = origin.clone().sub(rayOrigin)
  const b = dir.dot(rayDir)
  const d = dir.dot(w0)
  const e = rayDir.dot(w0)
  const denom = 1 - b * b
  if (denom < 1e-4) return null
  return (b * e - d) / denom
}

/** Resize cursor matching the on-screen direction in which the edge moves. */
function cursorFor(edge: BoardEdge, camera: Camera, rect: DOMRect): string {
  const mid = vec(edge.a).add(vec(edge.b)).multiplyScalar(0.5)
  const out = new Vector3()
  for (const s of edge.sides) out.addScaledVector(AXIS[s.axis], s.side ? 1 : -1)
  const p0 = mid.clone().project(camera)
  const p1 = mid.clone().addScaledVector(out, 100).project(camera)
  const dx = (p1.x - p0.x) * rect.width
  const dy = -(p1.y - p0.y) * rect.height
  if (edge.sides.length === 2) return dx * dy > 0 ? 'nwse-resize' : 'nesw-resize'
  return Math.abs(dx) > Math.abs(dy) ? 'ew-resize' : 'ns-resize'
}

interface Props {
  board: Board
  furniture: Furniture
  /** Faces of the board held by a joint – edges moving them cannot be dragged. */
  lockedFaces: Set<Face>
  /** The board resized by dragging an edge (called continuously while dragging). */
  onResize: (board: Board) => void
}

export default function BoardResizeEdges({ board, furniture, lockedFaces, onResize }: Props) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const edges = useMemo(
    () => boardEdges(board).filter((e) => e.sides.every((s) => !lockedFaces.has(AXIS_FACES[s.axis][s.side]))),
    [board, lockedFaces],
  )
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const drag = useRef<DragState | null>(null)

  const latest = useRef({ board, edges, furniture, onResize, camera })
  latest.current = { board, edges, furniture, onResize, camera }

  useEffect(() => {
    const canvas = gl.domElement
    const raycaster = new Raycaster()
    const ndc = new Vector2()
    let suppressClick = false

    const setRay = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, latest.current.camera)
    }

    const pick = (e: PointerEvent): BoardEdge | null => {
      const { edges, camera } = latest.current
      const rect = canvas.getBoundingClientRect()
      const toScreen = (p: Vec3) => {
        const v = vec(p).project(camera)
        return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, ok: v.z > -1 && v.z < 1 }
      }
      let best: BoardEdge | null = null
      let bestDist = EDGE_HIT_PX
      for (const edge of edges) {
        const a = toScreen(edge.a)
        const b = toScreen(edge.b)
        if (!a.ok || !b.ok) continue
        const d = segmentDistance(e.clientX, e.clientY, a.x, a.y, b.x, b.y)
        // a corner (short edge) wins over a long edge at the same distance – it's the smaller target
        if (d < bestDist - 0.5 || (best && Math.abs(d - bestDist) <= 0.5 && edge.sides.length > best.sides.length)) {
          best = edge
          bestDist = d
        }
      }
      return best
    }

    const hover = (edge: BoardEdge | null) => {
      setHoverId((cur) => (cur === (edge?.id ?? null) ? cur : edge?.id ?? null))
      setCursor(edge ? cursorFor(edge, latest.current.camera, canvas.getBoundingClientRect()) : null)
    }

    const onDown = (e: PointerEvent) => {
      suppressClick = false
      if (e.target !== canvas || e.button !== 0 || drag.current || isPointerClaimed(e)) return
      const edge = pick(e)
      if (!edge) return
      e.stopPropagation()
      e.preventDefault()
      suppressClick = true
      setRay(e)
      const start = latest.current.board
      const lineOrigin = vec(edge.a).add(vec(edge.b)).multiplyScalar(0.5)
      const lineDir = AXIS[edge.sides[0].axis].clone()
      let plane: Plane | null = null
      let startParam = 0
      const startPoint = new Vector3()
      if (edge.sides.length === 2) {
        const tAxis = dimensionAxis(start.orientation, 'thickness')
        plane = new Plane().setFromNormalAndCoplanarPoint(AXIS[tAxis], lineOrigin)
        if (!raycaster.ray.intersectPlane(plane, startPoint)) return
      } else {
        const s = closestOnLine(lineOrigin, lineDir, raycaster.ray.origin, raycaster.ray.direction)
        if (s === null) return
        startParam = s
      }
      drag.current = { pointerId: e.pointerId, edge, start, lineOrigin, lineDir, plane, startParam, startPoint }
      setDragId(edge.id)
    }

    const onMove = (e: PointerEvent) => {
      const d = drag.current
      if (!d) {
        if (e.target !== canvas || isPointerClaimed(e)) {
          if (e.target === canvas) hover(null)
          return
        }
        hover(pick(e))
        return
      }
      if (e.pointerId !== d.pointerId) return
      e.stopPropagation()
      setRay(e)
      const delta: Vec3 = [0, 0, 0]
      if (d.plane) {
        const hit = raycaster.ray.intersectPlane(d.plane, new Vector3())
        if (!hit) return
        for (const s of d.edge.sides) delta[s.axis] = hit.getComponent(s.axis) - d.startPoint.getComponent(s.axis)
      } else {
        const s = closestOnLine(d.lineOrigin, d.lineDir, raycaster.ray.origin, raycaster.ray.direction)
        if (s === null) return
        delta[d.edge.sides[0].axis] = s - d.startParam
      }
      const { furniture, onResize, board } = latest.current
      const next = resizeBoard(d.start, d.edge.sides, delta, furniture)
      if (next.width !== board.width || next.height !== board.height || next.position.x !== board.position.x || next.position.y !== board.position.y || next.position.z !== board.position.z) {
        onResize(next)
      }
    }

    const endDrag = () => {
      drag.current = null
      setDragId(null)
    }
    const onUp = (e: PointerEvent) => {
      const d = drag.current
      if (!d || e.pointerId !== d.pointerId) return
      e.stopPropagation()
      endDrag()
    }
    const onCancel = (e: PointerEvent) => {
      if (drag.current && e.pointerId === drag.current.pointerId) endDrag()
    }
    const onClick = (e: MouseEvent) => {
      if (!suppressClick) return
      suppressClick = false
      e.stopPropagation()
    }

    // document (not window): the constraint handles on window see the event first and win
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('pointermove', onMove, true)
    document.addEventListener('pointerup', onUp, true)
    document.addEventListener('pointercancel', onCancel, true)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('pointermove', onMove, true)
      document.removeEventListener('pointerup', onUp, true)
      document.removeEventListener('pointercancel', onCancel, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [gl])

  // resize cursor over an edge / while dragging
  useEffect(() => {
    if (!cursor) return
    const canvas = gl.domElement
    canvas.style.cursor = cursor
    document.body.style.cursor = cursor
    return () => {
      canvas.style.cursor = ''
      document.body.style.cursor = ''
    }
  }, [cursor, gl])

  const activeId = dragId ?? hoverId
  const active = edges.find((e) => e.id === activeId)
  if (!active) return null
  const mid: Vec3 = [(active.a[0] + active.b[0]) / 2, (active.a[1] + active.b[1]) / 2, (active.a[2] + active.b[2]) / 2]
  return (
    <group name="board-resize-edges">
      <Line points={[active.a, active.b]} color={EDGE_HOVER_COLOR} lineWidth={5} depthTest={false} transparent renderOrder={1003} raycast={() => null} />
      {dragId && (
        <Html position={mid} center zIndexRange={[20, 10]} className="resize-label">
          {active.sides.map((s) => (
            <div key={s.key}>
              {RESIZE_LABELS[s.key]}: <b>{formatNumber(board[s.key])} mm</b>
            </div>
          ))}
        </Html>
      )}
    </group>
  )
}
