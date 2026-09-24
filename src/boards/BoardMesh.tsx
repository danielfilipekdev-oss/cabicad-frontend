import { useEffect, useMemo, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Edges } from '@react-three/drei'
import {
  Color,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Plane,
  Vector3,
  type Camera,
  type Texture,
} from 'three'
import { boardPositionLimits, type Board, type BoardPosition, type GrainDirection } from './board.ts'
import type { Furniture } from '../furniture/furniture.ts'
import { boardModelOrDefault, type BoardModel } from './boardCatalog.ts'
import { useBoardCatalog } from './useBoardCatalog.ts'
import { boardFaceTexture, edgeBandTexture, useBoardTexture, useTextures } from './boardTextures.ts'
import { UNKNOWN_BAND_COLOR, edgeBandTextureUrl, findEdgeBandModel, useEdgeBandCatalog } from './edgeBandCatalog.ts'
import { chipboardEdgeTexture, chipboardFaceTexture } from './chipboardTextures.ts'
import { boardAnchors, boardShape, boardTransform } from './boardGeometry.ts'
import EdgeLabels from './EdgeLabels.tsx'
import { withoutHiddenBands, type HiddenBand } from '../layout/edgeContacts.ts'
import { extrude } from './extrude.ts'
import DimensionLabels from './DimensionLabels.tsx'
import { boardGrooves, grooveProblem } from './grooves.ts'
import { cutGrooves } from './grooveGeometry.ts'

interface Props {
  board: Board
  /** Board overlaps another board – drawn in red so the problem is visible in the scene. */
  colliding?: boolean
  /** Board is being edited – its edges are highlighted in green. */
  highlighted?: boolean
  /** Called when the board is clicked in the scene (left button, without dragging the camera). */
  onSelect?: (id: string) => void
  /**
   * The board can be moved with the mouse (only the selected board): LMB + drag moves it in the XZ plane,
   * Shift + LMB + drag along Y. The position is clamped to the furniture; collisions are allowed.
   */
  draggable?: boolean
  /**
   * Axes [x, y, z] on which the board is held by a layout constraint – it cannot be moved along them
   * (the offset of the joint is changed in the panel). See `layout/constraints.ts` → `boardLocks`.
   */
  lockedAxes?: [boolean, boolean, boolean]
  /** Furniture – the board cannot be dragged out of it. Required for dragging. */
  furniture?: Furniture
  /** Called with the moved board while dragging. */
  onMove?: (board: Board) => void
  /** Edges whose band is left out because they are joined to another board (see `layout/edgeContacts.ts`). */
  hiddenBands?: HiddenBand[]
}

type DragMode = 'xz' | 'y'

interface DragState {
  pointerId: number
  mode: DragMode
  /** Plane the pointer ray is intersected with (horizontal for XZ, vertical facing the camera for Y). */
  plane: Plane
  /** Point on the plane where the current drag segment started, and the board position at that moment. */
  startPoint: Vector3
  startPos: BoardPosition
  /** Last pointer hit on the plane (the anchor when Shift is pressed / released during the drag). */
  lastPoint: Vector3
}

const UP = new Vector3(0, 1, 0)
/** Board positions set by dragging are rounded to whole millimetres. */
const DRAG_STEP_MM = 1

/** Drag plane through `point`: horizontal (XZ mode) or vertical and facing the camera (Y mode). */
function dragPlane(mode: DragMode, point: Vector3, camera: Camera): Plane {
  if (mode === 'xz') return new Plane().setFromNormalAndCoplanarPoint(UP, point)
  const normal = camera.getWorldDirection(new Vector3()).setY(0)
  if (normal.lengthSq() < 1e-8) normal.set(0, 0, 1) // camera looking straight down / up
  return new Plane().setFromNormalAndCoplanarPoint(normal.normalize(), point)
}

/** Max pointer travel [px] between press and release that still counts as a click (more = camera pan). */
const CLICK_MAX_DRAG_PX = 4

export const HIGHLIGHT_EDGE_COLOR = '#00c853'

/** Red glow added to the material of a board that collides with another board. */
const COLLISION_EMISSIVE = new Color('#c62828')
const COLLISION_EMISSIVE_INTENSITY = 0.45

/**
 * Invisible material of the gross board outline: it is only the click target and carries the outline
 * (Edges), the visible parts are the core and the edge bands.
 */
const HIT_BOX_MATERIAL = new MeshBasicMaterial({ visible: false })
/** Visible parts don't take part in raycasting – clicks go to the gross outline. */
const noRaycast = () => null

/** Colour of the cut edge (core) of the non-chipboard types – MDF / HDF are uniform fibre boards. */
const CORE_COLORS: Record<string, string> = { MDF: '#b8966a', HDF: '#8f6a45' }

/**
 * Materials of the board core (the board without its edge bands) – ExtrudeGeometry groups:
 * 0 = the two large faces, 1 = the narrow sides. The extrusion has UVs in millimetres, so the
 * textures repeat once per tile size. The board MODEL (`boardCatalog.ts`) decides the look:
 *  - a model with an image → the faces with the texture made from it (real scale, turned by the grain
 *    direction `board.grain` – see `boardTextures.ts`); its average colour while the image loads,
 *  - the raw chipboard (no image) → speckled beige chipboard faces; other raw boards → their colour.
 * The narrow sides show the core of the board type: chipboard, or the MDF / HDF colour (an edge is
 * covered by its ABS band, drawn separately, when it has one).
 */
function createBoardMaterials(model: BoardModel, grain: GrainDirection, texture: Texture | null): MeshStandardMaterial[] {
  const face = texture
    ? new MeshStandardMaterial({ map: boardFaceTexture(texture, model, grain), roughness: 0.6 })
    : model.textureUrl || model.type !== 'CHIPBOARD'
      ? new MeshStandardMaterial({ color: model.color, roughness: 0.6 })
      : new MeshStandardMaterial({ map: chipboardFaceTexture(1, 1), roughness: 0.92 })
  const core = CORE_COLORS[model.type]
  const edge = core
    ? new MeshStandardMaterial({ color: core, roughness: 0.9 })
    : new MeshStandardMaterial({ map: chipboardEdgeTexture(1, 1), roughness: 0.92 })
  return [face, edge]
}

type Materials = MeshStandardMaterial | MeshStandardMaterial[]
const materialList = (m: Materials) => (Array.isArray(m) ? m : [m])

/**
 * Renders a single board at its position (scene units = mm). The board outline (rectangle or a shape
 * with cut-outs, see `cutouts.ts`) is built in the board's 2D frame and extruded by the thickness:
 *  - an invisible gross outline (entered dimensions and cut-outs) – click target + outline edges,
 *  - the core (texture of the board model), shrunk by the edge bands,
 *  - the edge bands (ABS) as thin extruded strips on the banded edges – core + bands = gross outline,
 *  - optional edge labels (A–D + E, F… of the cut-outs).
 */
export default function BoardMesh({
  board,
  colliding = false,
  highlighted = false,
  onSelect,
  draggable = false,
  lockedAxes = [false, false, false],
  furniture,
  onMove,
  hiddenBands,
}: Props) {
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const canDrag = draggable && !!furniture && !!onMove
  /** Drag mode usable only when at least one of its axes is free (not held by a joint). */
  const modeFree = (mode: DragMode) => (mode === 'xz' ? !lockedAxes[0] || !lockedAxes[2] : !lockedAxes[1])
  const anyFree = modeFree('xz') || modeFree('y')

  // cursor: pointer over a clickable board, "move" over the draggable (selected) board, "grabbing" while
  // dragging (reset also when the board is removed while hovered)
  useEffect(() => {
    const cursor = dragging ? 'grabbing' : hovered && canDrag && anyFree ? 'move' : hovered && onSelect ? 'pointer' : null
    if (!cursor) return
    document.body.style.cursor = cursor
    return () => {
      document.body.style.cursor = ''
    }
  }, [hovered, dragging, canDrag, anyFree, onSelect])

  // ---- dragging -------------------------------------------------------------------------------
  const camera = useThree((s) => s.camera)
  // camera controls (OrbitControls, makeDefault) – disabled while a board is dragged so LMB doesn't pan
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null
  const drag = useRef<DragState | null>(null)
  const latest = useRef(board)
  latest.current = board

  const stopDrag = () => {
    if (!drag.current) return
    drag.current = null
    setDragging(false)
    if (controls) controls.enabled = true
  }
  // re-enable the camera if the board disappears / stops being draggable in the middle of a drag
  useEffect(() => {
    if (!canDrag) stopDrag()
    return stopDrag
  }, [canDrag])

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!canDrag || e.button !== 0) return
    if (!modeFree(e.shiftKey ? 'y' : 'xz')) return // every axis of this mode is held by a joint
    // only when this board is the nearest board under the cursor (not dragged through another board);
    // faces closer than 1 mm count as the same distance (e.g. two overlapping boards)
    const nearest = e.intersections.find((i) => i.object.userData.boardId !== undefined)
    const mine = e.intersections.find((i) => i.object.userData.boardId === board.id)
    if (!mine || (nearest && nearest.distance < mine.distance - 1)) return
    e.stopPropagation()
    ;(e.target as unknown as Element).setPointerCapture(e.pointerId)
    if (controls) controls.enabled = false
    const mode: DragMode = e.shiftKey ? 'y' : 'xz'
    drag.current = {
      pointerId: e.pointerId,
      mode,
      plane: dragPlane(mode, e.point, camera),
      startPoint: e.point.clone(),
      startPos: { ...board.position },
      lastPoint: e.point.clone(),
    }
    setDragging(true)
  }

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId || !furniture || !onMove) return
    e.stopPropagation()
    const current = latest.current
    const mode: DragMode = e.shiftKey ? 'y' : 'xz'
    if (mode !== d.mode) {
      // Shift pressed / released → continue from the current place on the other plane
      d.mode = mode
      d.plane = dragPlane(mode, d.lastPoint, camera)
      d.startPoint = d.lastPoint.clone()
      d.startPos = { ...current.position }
    }
    const hit = e.ray.intersectPlane(d.plane, new Vector3())
    if (!hit) return // ray parallel to the plane
    d.lastPoint = hit
    const delta = hit.clone().sub(d.startPoint)
    const target: BoardPosition =
      mode === 'xz'
        ? { x: d.startPos.x + delta.x, y: d.startPos.y, z: d.startPos.z + delta.z }
        : { x: d.startPos.x, y: d.startPos.y + delta.y, z: d.startPos.z }
    // keep the board inside the furniture (collisions with other boards are allowed – shown in red)
    const limits = boardPositionLimits(current, furniture)
    const position = { ...current.position }
    for (const axis of ['x', 'y', 'z'] as const) {
      if (mode === 'xz' ? axis === 'y' : axis !== 'y') continue // only the axes of the current mode move
      if (lockedAxes[axis === 'x' ? 0 : axis === 'y' ? 1 : 2]) continue // held by a joint
      const v = Math.round(target[axis] / DRAG_STEP_MM) * DRAG_STEP_MM
      position[axis] = Math.min(limits[axis].max, Math.max(limits[axis].min, v))
    }
    if (position.x !== current.position.x || position.y !== current.position.y || position.z !== current.position.z) {
      onMove({ ...current, position })
    }
  }

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    e.stopPropagation()
    const target = e.target as unknown as Element
    if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId)
    stopDrag()
  }

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    // only the nearest board under the cursor reacts; ignore the click that ends a camera pan (LMB drag)
    e.stopPropagation()
    if (e.delta > CLICK_MAX_DRAG_PX) return
    onSelect?.(board.id)
  }

  // bands of the edges joined to another board are left out (the board itself keeps its configuration)
  const shown = useMemo(
    () => (hiddenBands?.length ? { ...board, edgeBanding: withoutHiddenBands(board.edgeBanding, hiddenBands) } : board),
    [board, hiddenBands],
  )
  const shape = useMemo(() => boardShape(shown), [shown])
  const transform = boardTransform(board)
  const anchors = useMemo(() => boardAnchors(shown, shape), [shown, shape])
  useBoardCatalog() // the model may arrive with the catalog
  useEdgeBandCatalog() // … and the band models with theirs
  const model = boardModelOrDefault(board.materialId)
  const grain = board.grain ?? 'AC'
  const texture = useBoardTexture(model)

  // geometries: rebuilt when the outline / bands change, disposed with the previous version
  const outerKey = JSON.stringify(shape.outer)
  const coreKey = JSON.stringify(shape.core)
  const bandsKey = JSON.stringify(shape.bands.map((b) => [b.edge, b.band.typeId, b.polygon]))
  const T = shape.thickness
  const outerGeometry = useMemo(() => extrude(shape.outer, T), [outerKey, T])
  const coreGeometry = useMemo(() => extrude(shape.core, T), [coreKey, T])
  const bandGeometries = useMemo(
    () => shape.bands.map((b) => ({ edge: b.edge, color: b.band.typeId, geometry: extrude(b.polygon, T) })),
    [bandsKey, T],
  )
  useEffect(() => () => outerGeometry.dispose(), [outerGeometry])
  useEffect(() => () => coreGeometry.dispose(), [coreGeometry])
  useEffect(() => () => bandGeometries.forEach((b) => b.geometry.dispose()), [bandGeometries])

  // (re)created only when something that affects the look changes; disposed with their texture clones
  const coreMaterials = useMemo(() => createBoardMaterials(model, grain, texture), [model, grain, texture])
  // one material per band colour
  // one material per band model (`color` of a band piece = its model id): the decor texture laid along
  // the edge, or the model's colour (grey while the band catalog is not loaded)
  const bandTypes = [...new Set(shape.bands.map((b) => b.band.typeId))].sort()
  const bandModels = bandTypes.map((id) => ({ id, model: findEdgeBandModel(id) }))
  const bandTextures = useTextures(bandModels.flatMap(({ model }) => (model && edgeBandTextureUrl(model)) || []))
  const bandLookKey = bandModels
    .map(({ id, model }) => `${id}:${model?.color ?? ''}:${model && bandTextures.has(edgeBandTextureUrl(model) ?? '') ? 't' : ''}`)
    .join(',')
  const bandMaterials = useMemo(
    () =>
      new Map(
        bandModels.map(({ id, model }) => {
          const tex = model && bandTextures.get(edgeBandTextureUrl(model) ?? '')
          return [
            id,
            tex
              ? new MeshStandardMaterial({ map: edgeBandTexture(tex, model.textureSize), roughness: 0.45 })
              : new MeshStandardMaterial({ color: model?.color ?? UNKNOWN_BAND_COLOR, roughness: 0.45 }),
          ]
        }),
      ),
    [bandLookKey], // eslint-disable-line react-hooks/exhaustive-deps
  )
  useEffect(
    () => () => {
      for (const m of materialList(coreMaterials)) {
        m.map?.dispose()
        m.dispose()
      }
    },
    [coreMaterials],
  )
  useEffect(
    () => () =>
      bandMaterials.forEach((m) => {
        m.map?.dispose()
        m.dispose()
      }),
    [bandMaterials],
  )

  // grooves (frezowania): cut out of the core and the bands (CSG); their walls are raw chipboard
  const grooves = useMemo(() => boardGrooves(shown).filter((g) => !grooveProblem(shown, g)), [shown])
  const groovesKey = JSON.stringify(grooves)
  // raw chipboard inside the groove, a bit darker (it lies in the shade of the channel walls)
  const wallMaterial = useMemo(() => new MeshStandardMaterial({ map: chipboardEdgeTexture(1, 1), color: '#a39276', roughness: 0.95 }), [])
  useEffect(
    () => () => {
      wallMaterial.map?.dispose()
      wallMaterial.dispose()
    },
    [wallMaterial],
  )
  const milled = useMemo(() => {
    if (!grooves.length) return null
    const dims = { width: board.width, height: board.height, thickness: T }
    const core = cutGrooves(coreGeometry, materialList(coreMaterials), dims, grooves, wallMaterial)
    const bands = bandGeometries.map((b) => {
      const m = bandMaterials.get(b.color)!
      return { ...b, ...cutGrooves(b.geometry, [m, m], dims, grooves, wallMaterial) }
    })
    return { core, bands }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groovesKey, coreGeometry, bandGeometries, coreMaterials, bandMaterials, wallMaterial, T])
  useEffect(
    () => () => {
      if (!milled) return
      milled.core.geometry.dispose()
      milled.bands.forEach((b) => b.geometry.dispose())
    },
    [milled],
  )

  // collision tint without rebuilding the materials
  useEffect(() => {
    for (const m of [...materialList(coreMaterials), ...bandMaterials.values()]) {
      m.emissive.copy(colliding ? COLLISION_EMISSIVE : new Color(0x000000))
      m.emissiveIntensity = colliding ? COLLISION_EMISSIVE_INTENSITY : 1
    }
  }, [coreMaterials, bandMaterials, colliding])

  const edgeColor = highlighted ? HIGHLIGHT_EDGE_COLOR : colliding ? '#b71c1c' : '#6b4f33'
  return (
    <group>
      <group position={transform.position} rotation={transform.rotation}>
        <mesh
          geometry={outerGeometry}
          userData={{ boardId: board.id, highlighted }}
          renderOrder={highlighted ? 1 : 0}
          onClick={handleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onLostPointerCapture={() => stopDrag()}
          onPointerOver={(e) => {
            e.stopPropagation()
            setHovered(true)
          }}
          onPointerOut={() => setHovered(false)}
          material={HIT_BOX_MATERIAL}
        >
          {/* key forces a fresh line material when the highlight toggles (width change) */}
          <Edges key={highlighted ? 'hl' : 'n'} color={edgeColor} lineWidth={highlighted ? 3 : 1} />
        </mesh>
        <mesh
          geometry={milled?.core.geometry ?? coreGeometry}
          material={milled?.core.materials ?? coreMaterials}
          castShadow
          receiveShadow
          raycast={noRaycast}
        />
        {(milled?.bands ?? bandGeometries).map((b, i) => (
          <mesh
            key={`${b.edge}#${i}`}
            geometry={b.geometry}
            material={'materials' in b ? b.materials : bandMaterials.get(b.color)}
            castShadow
            receiveShadow
            raycast={noRaycast}
            userData={{ boardId: board.id, edge: b.edge }}
          />
        ))}
      </group>
      {highlighted && <EdgeLabels anchors={anchors} />}
      {highlighted && <DimensionLabels board={board} />}
    </group>
  )
}
