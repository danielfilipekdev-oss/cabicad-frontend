import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import {
  BoxGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  Quaternion,
  Raycaster,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type Camera,
} from 'three'
import { boardBounds, type Board } from '../boards/board.ts'
import { furnitureSize, type Furniture } from '../furniture/furniture.ts'
import { claimPointer } from './pointerClaims.ts'
import {
  FACES,
  FACE_INFO,
  FACE_LABELS,
  connectionProblem,
  handleKey,
  isHandleEnabled,
  type AnchorConstraint,
  type HandleRef,
} from '../layout/constraints.ts'

/**
 * Constraint handles (uchwyty) of the 3D ConstraintLayout.
 *
 * Shown only while a board is selected: a handle on the middle of each of the 6 faces of every board and
 * of the furniture walls. The selected board's handles are green, the others blue (furniture walls –
 * blue squares), handles that can't start / end a chain are grey. Dragging a handle pulls out a chain;
 * dropping it on another (enabled) handle creates the joint and pulls the dependent board to it
 * (offset 0, see `connectHandles`). Existing joints of the selected board are drawn as chains – hovering
 * one turns it red, a click on it removes the joint. Hovering a grey handle says why it can't be used
 * ("inna oś niż uchwyt startowy", "takie wiązanie już istnieje", …).
 *
 * Handles have a constant size on screen and are drawn on top of the boards. They don't take part in
 * the R3F raycasting – they are picked in screen space by window listeners in the capture phase, so a
 * press on a handle never reaches the board drag / camera controls, and a press elsewhere is untouched.
 */

export const HANDLE_COLORS = {
  selected: '#00c853',
  other: '#1e63d6',
  disabled: '#9e9e9e',
  violated: '#e53935',
} as const

/** Radius [px] of a handle, of the hovered / dragged handle, its push out of the face and the pick radius. */
const HANDLE_PX = 7
const HANDLE_ACTIVE_PX = 10
const PUSH_PX = 14
const HIT_PX = 14
/** Size [px] of one chain link, of a hovered (removable) one, and the max number of links of one chain. */
const LINK_PX = 4
const LINK_HOVER_PX = 6
/** Max distance [px] of the pointer from a chain that still grabs it, and the click tolerance. */
const CHAIN_HIT_PX = 8
const CLICK_SLOP_PX = 5
const MAX_LINKS = 300

interface SceneHandle extends HandleRef {
  key: string
  /** Middle of the face (world, mm) and its outward normal. */
  base: Vector3
  normal: Vector3
  /** Owner is the selected board. */
  selected: boolean
  label: string
}

const AXIS_VECTORS = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]

function buildHandles(boards: Board[], furniture: Furniture, selectedId: string): SceneHandle[] {
  const handles: SceneHandle[] = []
  const add = (ref: HandleRef, min: number[], max: number[], selected: boolean, owner: string) => {
    const [axis, side] = FACE_INFO[ref.face]
    const base = new Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2)
    base.setComponent(axis, side ? max[axis] : min[axis])
    const normal = AXIS_VECTORS[axis].clone().multiplyScalar(side ? 1 : -1)
    handles.push({ ...ref, key: handleKey(ref), base, normal, selected, label: `${owner} · ${FACE_LABELS[ref.face]}` })
  }
  const fs = furnitureSize(furniture)
  for (const face of FACES) add({ owner: { kind: 'furniture' }, face }, [0, 0, 0], fs, false, 'Mebel')
  for (const b of boards) {
    const { min, max } = boardBounds(b)
    for (const face of FACES) add({ owner: { kind: 'board', id: b.id }, face }, min, max, b.id === selectedId, b.name)
  }
  return handles
}

/** World size [mm] of one screen pixel at `point`. */
function worldPerPx(camera: Camera, viewportHeight: number, point: Vector3): number {
  if (camera instanceof PerspectiveCamera) {
    const d = camera.position.distanceTo(point)
    return (2 * d * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(viewportHeight, 1)
  }
  if (camera instanceof OrthographicCamera) return (camera.top - camera.bottom) / camera.zoom / Math.max(viewportHeight, 1)
  return 1
}

/** Handle position = middle of the face pushed out of it by a constant number of pixels. */
function handlePosition(h: SceneHandle, camera: Camera, viewportHeight: number, out = new Vector3()): Vector3 {
  return out.copy(h.normal).multiplyScalar(PUSH_PX * worldPerPx(camera, viewportHeight, h.base)).add(h.base)
}

// shared geometries / materials (drawn on top of everything, no depth test)
const SPHERE = new SphereGeometry(1, 20, 14)
const BOX = new BoxGeometry(1.7, 1.7, 1.7)
const LINK = new TorusGeometry(1, 0.3, 6, 14)
const material = (color: string, opacity = 1) =>
  new MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity, toneMapped: false })
const MATERIALS = {
  selected: material(HANDLE_COLORS.selected),
  other: material(HANDLE_COLORS.other),
  disabled: material(HANDLE_COLORS.disabled, 0.55),
  violated: material(HANDLE_COLORS.violated),
}
const noRaycast = () => null

function HandleMesh({ handle, enabled, active }: { handle: SceneHandle; enabled: boolean; active: boolean }) {
  const ref = useRef<Mesh>(null)
  const camera = useThree((s) => s.camera)
  const height = useThree((s) => s.size.height)
  useFrame(() => {
    const m = ref.current
    if (!m) return
    handlePosition(handle, camera, height, m.position)
    const px = active ? HANDLE_ACTIVE_PX : enabled ? HANDLE_PX : HANDLE_PX * 0.75
    m.scale.setScalar(px * worldPerPx(camera, height, m.position))
  })
  const mat = !enabled ? MATERIALS.disabled : handle.selected ? MATERIALS.selected : MATERIALS.other
  return (
    <mesh
      ref={ref}
      geometry={handle.owner.kind === 'furniture' ? BOX : SPHERE}
      material={mat}
      renderOrder={1002}
      raycast={noRaycast}
      userData={{ handle: handle.key, enabled }}
    />
  )
}

const X_AXIS = new Vector3(1, 0, 0)
const QUARTER_TURN = new Quaternion().setFromAxisAngle(X_AXIS, Math.PI / 2)

/**
 * Chain (łańcuch) between two points – torus links along the segment, every other link turned by 90°,
 * constant size on screen. `points` is read every frame (handles move with the camera zoom).
 */
function Chain({ points, color, hovered = false }: { points: () => [Vector3, Vector3] | null; color: keyof typeof MATERIALS; hovered?: boolean }) {
  const ref = useRef<InstancedMesh>(null)
  const camera = useThree((s) => s.camera)
  const height = useThree((s) => s.size.height)
  const tmp = useMemo(() => ({ m: new Matrix4(), q: new Quaternion(), qa: new Quaternion(), p: new Vector3(), s: new Vector3(), d: new Vector3() }), [])
  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const pts = points()
    if (!pts) {
      mesh.count = 0
      return
    }
    const [a, b] = pts
    const { m, q, qa, p, s, d } = tmp
    d.subVectors(b, a)
    const length = d.length()
    if (length < 1e-6) {
      mesh.count = 0
      return
    }
    d.divideScalar(length)
    p.addVectors(a, b).multiplyScalar(0.5)
    const size = (hovered ? LINK_HOVER_PX : LINK_PX) * worldPerPx(camera, height, p)
    const spacing = 2.3 * size
    const n = Math.max(1, Math.min(MAX_LINKS, Math.floor(length / spacing)))
    const start = (length - n * spacing) / 2 + spacing / 2
    q.setFromUnitVectors(X_AXIS, d)
    qa.copy(q).multiply(QUARTER_TURN)
    s.set(1.6 * size, size, size)
    for (let i = 0; i < n; i++) {
      p.copy(d).multiplyScalar(start + i * spacing).add(a)
      m.compose(p, i % 2 ? qa : q, s)
      mesh.setMatrixAt(i, m)
    }
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh
      ref={ref}
      args={[LINK, MATERIALS[color], MAX_LINKS]}
      frustumCulled={false}
      renderOrder={1001}
      raycast={noRaycast}
    />
  )
}

interface DragState {
  from: SceneHandle
  pointerId: number
  /** Chain end = pointer on a camera-facing plane through the start handle (or the hovered handle). */
  end: Vector3
}

interface Props {
  boards: Board[]
  furniture: Furniture
  selectedId: string
  constraints: AnchorConstraint[]
  /** Ids of constraints that are not satisfied – their chains are red. */
  violated: string[]
  /** A chain was dropped from `from` on `to` (both enabled). */
  onConnect: (from: HandleRef, to: HandleRef) => void
  /** A chain of the selected board was clicked → remove that joint. */
  onDisconnect: (constraintId: string) => void
}

export default function ConstraintHandles({ boards, furniture, selectedId, constraints, violated, onConnect, onDisconnect }: Props) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const height = useThree((s) => s.size.height)

  const handles = useMemo(() => buildHandles(boards, furniture, selectedId), [boards, furniture, selectedId])
  const byKey = useMemo(() => new Map(handles.map((h) => [h.key, h])), [handles])

  const [dragKey, setDragKey] = useState<string | null>(null)
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  /** Chain under the pointer – highlighted in red, a click removes it. */
  const [hoverChain, setHoverChain] = useState<string | null>(null)
  /** Grey handle under the pointer + why it cannot be used. */
  const [blocked, setBlocked] = useState<{ key: string; reason: string } | null>(null)
  const drag = useRef<DragState | null>(null)
  const dragFrom = dragKey ? byKey.get(dragKey) ?? null : null

  const enabled = useMemo(
    () => new Map(handles.map((h) => [h.key, isHandleEnabled(h, handles, selectedId, constraints, dragFrom)])),
    [handles, selectedId, constraints, dragFrom],
  )

  /** Joints of the selected board (as the dependent board or as the target) – drawn as chains. */
  const joints = useMemo(
    () =>
      constraints
        .filter((c) => c.board === selectedId || (c.target.kind === 'board' && c.target.id === selectedId))
        .map((c) => ({
          id: c.id,
          from: byKey.get(handleKey({ owner: { kind: 'board' as const, id: c.board }, face: c.face })),
          to: byKey.get(handleKey({ owner: c.target, face: c.targetFace })),
          ownedBySelected: c.board === selectedId,
        }))
        .filter((j): j is { id: string; from: SceneHandle; to: SceneHandle; ownedBySelected: boolean } => !!j.from && !!j.to),
    [constraints, selectedId, byKey],
  )

  // latest values for the window listeners
  const latest = useRef({ handles, enabled, byKey, joints, constraints, onConnect, onDisconnect, camera, height })
  latest.current = { handles, enabled, byKey, joints, constraints, onConnect, onDisconnect, camera, height }
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId

  useEffect(() => {
    const canvas = gl.domElement
    const raycaster = new Raycaster()
    const ndc = new Vector2()
    const plane = new Plane()
    const tmp = new Vector3()
    let suppressClick = false
    /** Chain pressed with LMB – removed on release if the pointer didn't travel (= a click). */
    let pendingDelete: { id: string; pointerId: number; x: number; y: number } | null = null

    /** Nearest enabled handle within HIT_PX of the pointer (optionally excluding one). */
    const pick = (e: PointerEvent, exclude?: string): SceneHandle | null => {
      const { handles, enabled, camera, height } = latest.current
      const rect = canvas.getBoundingClientRect()
      let best: SceneHandle | null = null
      let bestDist = HIT_PX
      for (const h of handles) {
        if (h.key === exclude || !enabled.get(h.key)) continue
        handlePosition(h, camera, height, tmp).project(camera)
        if (tmp.z > 1 || tmp.z < -1) continue // behind the camera / clipped
        const sx = rect.left + ((tmp.x + 1) / 2) * rect.width
        const sy = rect.top + ((1 - tmp.y) / 2) * rect.height
        const dist = Math.hypot(sx - e.clientX, sy - e.clientY)
        // prefer the selected board's handle when two are on the same spot
        if (dist < bestDist - 0.5 || (best && Math.abs(dist - bestDist) <= 0.5 && h.selected && !best.selected)) {
          best = h
          bestDist = dist
        }
      }
      return best
    }

    /** Chain of the selected board within CHAIN_HIT_PX of the pointer (nearest one). */
    const pickChain = (e: PointerEvent): string | null => {
      const { joints, camera, height } = latest.current
      const rect = canvas.getBoundingClientRect()
      const screen = (h: SceneHandle) => {
        handlePosition(h, camera, height, tmp).project(camera)
        return { x: rect.left + ((tmp.x + 1) / 2) * rect.width, y: rect.top + ((1 - tmp.y) / 2) * rect.height, ok: tmp.z > -1 && tmp.z < 1 }
      }
      let best: string | null = null
      let bestDist = CHAIN_HIT_PX
      for (const j of joints) {
        const a = screen(j.from)
        const b = screen(j.to)
        if (!a.ok || !b.ok) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const len2 = dx * dx + dy * dy
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((e.clientX - a.x) * dx + (e.clientY - a.y) * dy) / len2)) : 0
        const d = Math.hypot(e.clientX - (a.x + t * dx), e.clientY - (a.y + t * dy))
        if (d < bestDist) {
          best = j.id
          bestDist = d
        }
      }
      return best
    }

    /** Nearest handle of any state – used to explain why a grey one cannot be used. */
    const pickAny = (e: PointerEvent, exclude?: string): SceneHandle | null => {
      const { handles, camera, height } = latest.current
      const rect = canvas.getBoundingClientRect()
      let best: SceneHandle | null = null
      let bestDist = HIT_PX
      for (const h of handles) {
        if (h.key === exclude) continue
        handlePosition(h, camera, height, tmp).project(camera)
        if (tmp.z > 1 || tmp.z < -1) continue
        const sx = rect.left + ((tmp.x + 1) / 2) * rect.width
        const sy = rect.top + ((1 - tmp.y) / 2) * rect.height
        const dist = Math.hypot(sx - e.clientX, sy - e.clientY)
        if (dist < bestDist) {
          best = h
          bestDist = dist
        }
      }
      return best
    }

    const explain = (from: SceneHandle | null, h: SceneHandle | null) => {
      if (!h) return setBlocked(null)
      const reason = from
        ? connectionProblem(from, h, selectedRef.current, latest.current.constraints)
        : 'brak możliwego połączenia z tego uchwytu'
      setBlocked((cur) => (cur && cur.key === h.key && cur.reason === reason ? cur : reason ? { key: h.key, reason } : null))
    }

    const pointerOnPlane = (e: PointerEvent, out: Vector3): boolean => {
      const { camera } = latest.current
      const rect = canvas.getBoundingClientRect()
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      return raycaster.ray.intersectPlane(plane, out) !== null
    }

    const endDrag = () => {
      drag.current = null
      setDragKey(null)
      setHoverKey(null)
      setBlocked(null)
    }

    const onDown = (e: PointerEvent) => {
      suppressClick = false
      if (e.target !== canvas || e.button !== 0 || drag.current) return
      const h = pick(e)
      if (!h) {
        // no handle → maybe a chain of the selected board (click removes it)
        const chain = pickChain(e)
        if (!chain) return
        claimPointer(e)
        e.stopPropagation()
        e.preventDefault()
        suppressClick = true
        pendingDelete = { id: chain, pointerId: e.pointerId, x: e.clientX, y: e.clientY }
        return
      }
      // the press belongs to the handle – not to the board drag / resize, selection or camera
      claimPointer(e)
      e.stopPropagation()
      e.preventDefault()
      suppressClick = true
      const { camera, height } = latest.current
      const start = handlePosition(h, camera, height)
      plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()), start)
      drag.current = { from: h, pointerId: e.pointerId, end: start.clone() }
      setDragKey(h.key)
      setHoverKey(null)
    }

    const onMove = (e: PointerEvent) => {
      const d = drag.current
      if (!d) {
        // idle: hover feedback (cursor) only, the event goes on to the scene
        if (e.target !== canvas) return
        const h = pick(e)
        const chain = h ? null : pickChain(e)
        explain(null, h || chain ? null : pickAny(e))
        if (h || chain) claimPointer(e)
        setHoverKey((cur) => (cur === (h?.key ?? null) ? cur : h?.key ?? null))
        setHoverChain((cur) => (cur === chain ? cur : chain))
        return
      }
      if (e.pointerId !== d.pointerId) return
      e.stopPropagation()
      const target = pick(e, d.from.key)
      explain(d.from, target ? null : pickAny(e, d.from.key))
      setHoverKey((cur) => (cur === (target?.key ?? null) ? cur : target?.key ?? null))
      if (target) {
        const { camera, height } = latest.current
        handlePosition(target, camera, height, d.end)
      } else {
        pointerOnPlane(e, d.end)
      }
    }

    const onUp = (e: PointerEvent) => {
      if (pendingDelete && e.pointerId === pendingDelete.pointerId) {
        const { id, x, y } = pendingDelete
        pendingDelete = null
        e.stopPropagation()
        if (Math.hypot(e.clientX - x, e.clientY - y) <= CLICK_SLOP_PX) {
          setHoverChain(null)
          latest.current.onDisconnect(id)
        }
        return
      }
      const d = drag.current
      if (!d || e.pointerId !== d.pointerId) return
      e.stopPropagation()
      const target = pick(e, d.from.key)
      const from: HandleRef = { owner: d.from.owner, face: d.from.face }
      endDrag()
      if (target) latest.current.onConnect(from, { owner: target.owner, face: target.face })
    }

    const onClick = (e: MouseEvent) => {
      if (!suppressClick) return
      suppressClick = false
      e.stopPropagation()
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drag.current) endDrag()
    }
    const onCancel = (e: PointerEvent) => {
      if (pendingDelete && e.pointerId === pendingDelete.pointerId) pendingDelete = null
      if (drag.current && e.pointerId === drag.current.pointerId) endDrag()
    }

    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onCancel, true)
    window.addEventListener('click', onClick, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onCancel, true)
      window.removeEventListener('click', onClick, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [gl])

  // cursor: grab over a handle, grabbing while pulling a chain
  useEffect(() => {
    const cursor = dragKey ? 'grabbing' : hoverKey ? 'grab' : hoverChain ? 'pointer' : null
    if (!cursor) return
    document.body.style.cursor = cursor
    canvas(gl).style.cursor = cursor
    return () => {
      document.body.style.cursor = ''
      canvas(gl).style.cursor = ''
    }
  }, [dragKey, hoverKey, hoverChain, gl])

  const hoveredJoint = joints.find((j) => j.id === hoverChain)
  const blockedHandle = blocked ? byKey.get(blocked.key) ?? null : null

  return (
    <group name="constraint-handles">
      {joints.map((j) => (
        <Chain
          key={j.id}
          color={j.id === hoverChain ? 'violated' : violated.includes(j.id) ? 'violated' : j.ownedBySelected ? 'selected' : 'other'}
          hovered={j.id === hoverChain}
          points={() => [handlePosition(j.from, camera, height), handlePosition(j.to, camera, height)]}
        />
      ))}
      {blockedHandle && (
        <Html position={handlePosition(blockedHandle, camera, height)} center zIndexRange={[20, 10]} className="handle-label">
          {blocked?.reason}
        </Html>
      )}
      {hoveredJoint && (
        <Html
          position={handlePosition(hoveredJoint.from, camera, height).add(handlePosition(hoveredJoint.to, camera, height)).multiplyScalar(0.5)}
          center
          zIndexRange={[20, 10]}
          className="chain-label"
        >
          × Kliknij, aby usunąć wiązanie
        </Html>
      )}
      {dragFrom && (
        <Chain
          color={dragFrom.selected ? 'selected' : 'other'}
          points={() => (drag.current ? [handlePosition(drag.current.from, camera, height), drag.current.end] : null)}
        />
      )}
      {handles.map((h) => (
        <HandleMesh
          key={h.key}
          handle={h}
          enabled={enabled.get(h.key) ?? false}
          active={h.key === dragKey || h.key === hoverKey}
        />
      ))}
    </group>
  )
}

const canvas = (gl: { domElement: HTMLCanvasElement }) => gl.domElement
