import { forwardRef, useLayoutEffect, useMemo, useRef } from 'react'
import { Vector3, type DirectionalLight } from 'three'
import { DEFAULT_LIGHT, lightDirection, type LightSettings } from './lighting.ts'
import SunMarker from './SunMarker.tsx'
import { Canvas } from '@react-three/fiber'
import { Grid, Html, Line } from '@react-three/drei'
import CameraRig, { type CameraRigHandle } from './CameraRig.tsx'
import FurnitureBox from './FurnitureBox.tsx'
import BoardMesh from '../boards/BoardMesh.tsx'
import ConstraintHandles from './ConstraintHandles.tsx'
import BoardResizeEdges from './BoardResizeEdges.tsx'
import DraftBoard from '../boards/DraftBoard.tsx'
import SectionOverlay from './SectionOverlay.tsx'
import HingedGroup from './HingedGroup.tsx'
import type { BoardHinge } from '../layout/hinges.ts'
import type { Section } from '../sections/sections.ts'
import type { HiddenBand } from '../layout/edgeContacts.ts'
import { boardLocks, type AnchorConstraint, type HandleRef } from '../layout/constraints.ts'
import { collidingBoards, type Board } from '../boards/board.ts'
import type { Furniture } from '../furniture/furniture.ts'
import {
  CAMERA_FAR,
  CAMERA_FOV,
  CAMERA_NEAR,
  AXIS_COLORS,
  AXIS_LENGTH,
  GRID_CELL_SIZE,
  GRID_FADE_DISTANCE,
  GRID_SECTION_SIZE,
  WORKSPACE_SIZE,
} from './sceneConfig.ts'

/**
 * Red dot marking the origin (0, 0, 0) of the furniture coordinate system = left-top corner of the
 * furniture's bottom plane – always drawn on top so it is visible from any angle.
 */
function OriginMarker() {
  return (
    <mesh position={[0, 0, 0]} renderOrder={999}>
      <sphereGeometry args={[15, 24, 24]} />
      <meshBasicMaterial color="#ff0000" depthTest={false} transparent />
    </mesh>
  )
}

const AXES: { label: string; color: string; dir: [number, number, number] }[] = [
  { label: 'X', color: AXIS_COLORS[0], dir: [1, 0, 0] },
  { label: 'Y', color: AXIS_COLORS[1], dir: [0, 1, 0] },
  { label: 'Z', color: AXIS_COLORS[2], dir: [0, 0, 1] },
]

/**
 * Axes going out of the origin (X – red, Y – green, Z – blue) with X / Y / Z labels at their tips.
 * Drawn on top of everything (like the red dot), because they run along the furniture edges.
 */
function OriginAxes() {
  const scale = (d: [number, number, number], k: number): [number, number, number] => [d[0] * k, d[1] * k, d[2] * k]
  return (
    <>
      {AXES.map(({ label, color, dir }) => (
        <group key={label}>
          <Line
            points={[[0, 0, 0], scale(dir, AXIS_LENGTH)]}
            color={color}
            lineWidth={2.5}
            depthTest={false}
            transparent
            renderOrder={998}
            raycast={() => null}
          />
          <Html position={scale(dir, AXIS_LENGTH + 40)} center zIndexRange={[10, 0]} className="axis-label">
            <span style={{ color }}>{label}</span>
          </Html>
        </group>
      ))}
    </>
  )
}

/**
 * Outline of the workspace floor – the largest possible footprint of the furniture (4000 × 4000 mm),
 * starting at the furniture origin.
 */
function WorkspaceOutline() {
  const w = WORKSPACE_SIZE.width
  const d = WORKSPACE_SIZE.depth
  const y = 1 // 1 mm above the grid to avoid z-fighting
  return (
    <Line
      points={[[0, y, 0], [w, y, 0], [w, y, d], [0, y, d], [0, y, 0]]}
      color="#5a7bd8"
      lineWidth={1.5}
      dashed
      dashSize={100}
      gapSize={50}
    />
  )
}

/**
 * 3D design scene for a single piece of furniture (React Three Fiber + three.js).
 * Units: millimetres (1 scene unit = 1 mm). Y axis points up; the workspace floor lies on the XZ plane.
 * The world origin IS the furniture origin (red dot, left-top corner of the furniture's bottom plane), so
 * the furniture grows only to the right (+X), up (+Y) and to the front (+Z) and the dot never moves.
 */
interface SceneProps {
  boards: Board[]
  /** Key light direction / intensity and the ambient light ("Światło" widget). */
  light?: LightSettings
  /** Draw the dashed rays from the sun to the furniture ("Pokaż promienie" in the Światło panel). */
  sunRays?: boolean
  /** Furniture cuboid = working volume of the boards; boards are positioned relative to its origin. */
  furniture: Furniture
  /** Id of the board being edited – drawn with green edges. */
  highlightedId?: string | null
  /** Board clicked in the scene – opens its edit panel. */
  onBoardSelect?: (id: string) => void
  /** Left click on an empty spot of the scene (no board hit, no camera drag) – closes the board edit mode. */
  onEmptyClick?: () => void
  /** The selected (highlighted) board was moved with the mouse. */
  onBoardMove?: (board: Board) => void
  /** Layout constraints – drawn as chains between the handles of the selected board. */
  constraints?: AnchorConstraint[]
  /** Ids of constraints that are not satisfied (red chains). */
  violated?: string[]
  /** A chain was pulled from one handle to another → create the joint. Enables the handles. */
  onConnectHandles?: (from: HandleRef, to: HandleRef) => void
  /** A chain of the selected board was clicked in the scene → remove that joint. */
  onDisconnectChain?: (constraintId: string) => void
  /** The selected board was resized by dragging an edge of its outline. Enables the resize edges. */
  onBoardResize?: (board: Board) => void
  /**
   * Boards not added yet, previewed as a green wireframe: the single board of the "Dodaj płytę" form
   * (with its dimensions) and the carcass boards whose "add" button is hovered.
   */
  drafts?: { board: Board; dimensions: boolean }[]
  /** Boards with a hinge joint (board id → hinge) and the ones that are open (turned out). */
  hinges?: Map<string, BoardHinge>
  openLeaves?: Set<string>
  /** Per board: edges whose band is left out because they are joined to another board. */
  hiddenBands?: Map<string, HiddenBand[]>
  /** "Półki i Przedziały" mode: the section tree shown as planes at the front (see `SectionOverlay`). */
  sections?: {
    root: Section
    selectedId: string | null
    onSelect: (id: string | null) => void
    onMoveDivider?: (boardId: string, lo: number) => void
    /** "Fronty": run of sub-sections of the selected section picked for one front (Ctrl + click). */
    range?: { from: number; to: number } | null
    onCtrlPick?: (id: string) => void
    /** "Fronty": sections covered by the front clicked in the list – highlighted. */
    highlighted?: string[] | null
  }
}

/**
 * Directional key light casting the shadows, with the shadow camera FITTED to the furniture (a sphere
 * around it + a margin). A shadow camera covering the whole 10 m workspace had ~5 mm per shadow-map texel
 * and a depth bias of ~15 mm, so light leaked through the joints of the boards – bright stripes inside a
 * carcass just under the top / along the sides. Fitted: well under 1 mm per texel, the bias < 0.5 mm.
 * Direction and intensity come from the "Światło" widget (`lighting.ts`).
 */
function KeyLight({ furniture, light: settings }: { furniture: Furniture; light: LightSettings }) {
  const ref = useRef<DirectionalLight>(null)
  const { width: W, height: H, depth: D } = furniture
  const { azimuth, elevation } = settings
  useLayoutEffect(() => {
    const light = ref.current
    if (!light) return
    const center = new Vector3(W / 2, H / 2, D / 2)
    // radius of the sphere around the furniture + room for open doors / flaps and the floor shadow
    const r = Math.hypot(W, H, D) / 2 + Math.max(W, D) * 0.6 + 200
    light.position.copy(center).addScaledVector(lightDirection({ ...settings, azimuth, elevation }), r + 500)
    light.target.position.copy(center)
    light.target.updateMatrixWorld()
    const cam = light.shadow.camera
    cam.left = -r
    cam.right = r
    cam.top = r
    cam.bottom = -r
    cam.near = 100
    cam.far = 2 * r + 600
    cam.updateProjectionMatrix()
    // bias in depth-range units (≈ 0.0001 × depth range = a fraction of a mm) + a small offset along the
    // surface normal [mm] against shadow acne on the lit faces
    light.shadow.bias = -0.0001
    light.shadow.normalBias = 0.6
    light.shadow.needsUpdate = true
  }, [W, H, D, azimuth, elevation]) // eslint-disable-line react-hooks/exhaustive-deps
  return <directionalLight ref={ref} intensity={settings.intensity} castShadow shadow-mapSize={[4096, 4096]} />
}

const Scene = forwardRef<CameraRigHandle, SceneProps>(function Scene({ boards, furniture, highlightedId = null, onBoardSelect, onEmptyClick, onBoardMove, constraints = [], violated = [], onConnectHandles, onDisconnectChain, onBoardResize, drafts = [], sections, hiddenBands, hinges, openLeaves, light = DEFAULT_LIGHT, sunRays = false }, ref) {
  const selected = boards.find((b) => b.id === highlightedId)
  // what the joints of the selected board fix – it cannot be dragged / resized there
  const locks = useMemo(() => boardLocks(constraints, highlightedId), [constraints, highlightedId])
  const colliding = useMemo(() => new Set(boards.filter((b) => collidingBoards(b, boards).length > 0).map((b) => b.id)), [boards])
  return (
    <Canvas
      shadows
      camera={{ position: [4000, 3000, 5000], fov: CAMERA_FOV, near: CAMERA_NEAR, far: CAMERA_FAR }}
      onContextMenu={(e) => e.preventDefault()}
      // R3F fires this only for clicks that hit no board and moved the pointer ≤ 2 px (so ending a pan/rotate
      // doesn't count); button 0 = left, a plain right click (rotate button) is ignored
      onPointerMissed={(e) => {
        if (e.button === 0) onEmptyClick?.()
      }}
    >
      <color attach="background" args={['#f2f2f2']} />
      {/* bright enough that board textures keep roughly their catalog colours */}
      <ambientLight intensity={light.ambient} />
      <KeyLight furniture={furniture} light={light} />
      <SunMarker furniture={furniture} light={light} showRay={sunRays} />

      {/*
        Workspace floor with 100 mm cells and 1000 mm sections.
        With infiniteGrid drei scales the plane by (1 + fadeDistance), so args must stay tiny:
        [2, 2] → ~80 m plane (half-size = fadeDistance, the grid fades out exactly at its edge).
        Large args (e.g. the workspace size) produced a ~160 km plane whose float precision loss
        made the grid lines jitter while the camera moved. followCamera keeps the (small) plane
        under the camera, so the grid still looks infinite when panning far away.
      */}
      <Grid
        args={[2, 2]}
        cellSize={GRID_CELL_SIZE}
        cellColor="#d0d0d0"
        sectionSize={GRID_SECTION_SIZE}
        sectionColor="#9a9a9a"
        fadeDistance={GRID_FADE_DISTANCE}
        infiniteGrid
        followCamera
      />
      <WorkspaceOutline />

      {/* Furniture coordinate system = world coordinates (origin = red dot) */}
      <FurnitureBox furniture={furniture} />
      <OriginAxes />
      <OriginMarker />

      {boards.map((b) => {
        const mesh = (
          <BoardMesh
          key={b.id}
          board={b}
          colliding={colliding.has(b.id)}
          highlighted={b.id === highlightedId}
          onSelect={onBoardSelect}
          draggable={b.id === highlightedId}
          lockedAxes={locks.position}
          furniture={furniture}
          onMove={onBoardMove}
          hiddenBands={hiddenBands?.get(b.id)}
        />
        )
        // a board with a hinge joint turns around it when open
        const hinge = hinges?.get(b.id)
        return hinge ? (
          <HingedGroup key={b.id} hinge={hinge} open={!!openLeaves?.has(b.id)}>
            {mesh}
          </HingedGroup>
        ) : (
          mesh
        )
      })}

      {sections && (
        <SectionOverlay
          root={sections.root}
          boards={boards}
          furniture={furniture}
          selectedId={sections.selectedId}
          onSelect={sections.onSelect}
          onMoveDivider={sections.onMoveDivider}
          range={sections.range}
          onCtrlPick={sections.onCtrlPick}
          highlighted={sections.highlighted}
        />
      )}

      {/* the board about to be added – green wireframe with its dimensions */}
      {drafts.map((d, i) => (
        <DraftBoard key={`${d.board.role ?? d.board.id}#${i}`} board={d.board} showDimensions={d.dimensions} />
      ))}

      {/* resizing the selected board by its outline edges */}
      {selected && onBoardResize && (
        <BoardResizeEdges board={selected} furniture={furniture} lockedFaces={locks.faces} onResize={onBoardResize} />
      )}

      {/* constraint handles (uchwyty) – only while a board is selected */}
      {highlightedId && onConnectHandles && boards.some((b) => b.id === highlightedId) && (
        <ConstraintHandles
          boards={boards}
          furniture={furniture}
          selectedId={highlightedId}
          constraints={constraints}
          violated={violated}
          onConnect={onConnectHandles}
          onDisconnect={onDisconnectChain ?? (() => {})}
        />
      )}

      <CameraRig ref={ref} furniture={furniture} />
    </Canvas>
  )
})

export default Scene
