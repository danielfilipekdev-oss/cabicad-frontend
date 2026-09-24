import { useEffect, useMemo, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import { DoubleSide, Plane, Vector3 } from 'three'
import { boardBounds } from '../boards/board.ts'
import { AXIS_COLORS } from './sceneConfig.ts'
import type { Board } from '../boards/board.ts'
import type { Furniture } from '../furniture/furniture.ts'
import { formatNumber } from '../ui/format.ts'
import {
  SPLIT_AXIS,
  allSections,
  findSection,
  parentSection,
  sectionAtPoint,
  sectionBoxes,
  sectionLabels,
  sectionPath,
  type Section,
  type SectionBox,
} from '../sections/sections.ts'

/** Max pointer travel [px] that still counts as a click (more = camera pan / rotate). */
const CLICK_MAX_PX = 4
const CHOICE_COLOR = '#2f6fd6'
const SELECTED_COLOR = '#00c853'
const HIGHLIGHT_COLOR = '#1565c0'

interface Props {
  root: Section
  boards: Board[]
  furniture: Furniture
  /** Section entered / selected (null = nothing yet, the root is offered). */
  selectedId: string | null
  onSelect: (id: string | null) => void
  /**
   * A shelf / partition dragged at the front: its lower / left face should be at `lo` [mm along the
   * split axis] – turned into joint offsets (see `moveDivider`). Enables the drag handles.
   */
  onMoveDivider?: (boardId: string, lo: number) => void
  /** Run of sub-sections of the selected section picked (Ctrl + click) – highlighted green. */
  range?: { from: number; to: number } | null
  /** Ctrl (⌘) + click on a section – adds it to / takes it off the picked run (enables multi-select). */
  onCtrlPick?: (id: string) => void
  /** Sections covered by the front clicked in the "Fronty" list – highlighted (whatever the level). */
  highlighted?: string[] | null
}

/**
 * "Półki i Przedziały" mode in the scene: the sections are drawn as 2D planes at the FRONT of the
 * furniture and entered level by level:
 *  - nothing selected → the root section (the whole front) is highlighted; clicking it enters it,
 *  - a section with sub-sections selected → its outline (green) and its sub-sections (blue) – clicking
 *    one enters it (and so on down to a leaf, which is then highlighted green),
 *  - clicking elsewhere on the front picks the section at the same level there,
 *  - RIGHT click (without dragging – dragging rotates the camera) or Esc → one level up,
 *  - clicking outside the furniture → back to the start (the root highlighted) – handled by the scene.
 */
export default function SectionOverlay({ root, boards, furniture, selectedId, onSelect, onMoveDivider, range, onCtrlPick, highlighted }: Props) {
  const boxes = useMemo(() => sectionBoxes(root, boards, furniture), [root, boards, furniture])
  const labels = useMemo(() => sectionLabels(root), [root])
  const selected = findSection(root, selectedId)
  const depth = selected ? sectionPath(root, selected.id).length - 1 : 0
  const [hovered, setHovered] = useState<string | null>(null)
  /** Shelf / partition under the cursor / being dragged – the sizes of its two sub-sections are shown. */
  const [handleHover, setHandleHover] = useState<{ id: string; axis: number } | null>(null)
  const [handleDrag, setHandleDrag] = useState<{ id: string; axis: number } | null>(null)
  const activeHandle = handleDrag ?? handleHover
  const activeDivider = activeHandle?.id ?? null
  const Z = furniture.depth

  // one level up: RMB click / Esc (the latest selection through a ref – listeners are attached once)
  const upRef = useRef<() => void>(() => {})
  upRef.current = () => {
    if (!selected) return
    onSelect(parentSection(root, selected.id)?.id ?? null)
  }
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const el = gl.domElement
    let down: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => {
      if (e.button === 2) down = { x: e.clientX, y: e.clientY }
    }
    const onUp = (e: PointerEvent) => {
      if (e.button !== 2 || !down) return
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) <= CLICK_MAX_PX) upRef.current()
      down = null
    }
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key === 'Escape' && !(t && t.closest('input, textarea, select'))) upRef.current()
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [gl])

  // one owner of the cursor: resize over / while dragging a shelf / partition, pointer over a section
  const cursor = activeHandle ? (activeHandle.axis === 1 ? 'ns-resize' : 'ew-resize') : hovered ? 'pointer' : ''
  useEffect(() => {
    document.body.style.cursor = cursor
    return () => {
      document.body.style.cursor = ''
    }
  }, [cursor])

  const rootBox = boxes.get(root.id)
  if (!rootBox) return null

  // sections offered for a click (blue) and the active one (green)
  const choices: Section[] = !selected ? [root] : selected.children
  const active = selected

  const click = (e: ThreeEvent<MouseEvent>, fn: () => void) => {
    e.stopPropagation()
    if (e.delta > CLICK_MAX_PX || e.nativeEvent.button !== 0) return
    fn()
  }
  const ctrl = (e: ThreeEvent<MouseEvent>) => !!onCtrlPick && (e.nativeEvent.ctrlKey || e.nativeEvent.metaKey)
  // picked run of sub-sections (Ctrl + click) – shown green like a selected leaf
  const picked = active && range ? active.children.slice(range.from, range.to + 1) : []
  // anywhere on the front: the section at the current level under the cursor
  const catcherClick = (e: ThreeEvent<MouseEvent>) =>
    click(e, () => {
      if (!selected) return onSelect(root.id)
      const s = sectionAtPoint(root, boxes, e.point.x, e.point.y, depth)
      if (ctrl(e)) return onCtrlPick!(s.id)
      if (s.id !== selected.id) onSelect(s.id)
    })

  return (
    <group>
      {/* invisible catcher over the whole front – clicks between the offered sections */}
      <FrontPlane box={rootBox} z={Z + 0.5} visible={false} onClick={catcherClick} />
      {active && (
        <>
          <Outline box={boxes.get(active.id)} z={Z + 2} color={SELECTED_COLOR} width={3} />
          {active.children.length === 0 && (
            <>
              <FrontPlane box={boxes.get(active.id)} z={Z + 1} color={SELECTED_COLOR} opacity={0.22} />
              <SectionLabel box={boxes.get(active.id)} z={Z} label={labels.get(active.id)!} selected />
            </>
          )}
        </>
      )}
      {(highlighted ?? []).map((id) => (
        <group key={`front-${id}`}>
          <FrontPlane box={boxes.get(id)} z={Z + 1.8} color={HIGHLIGHT_COLOR} opacity={0.35} />
          <Outline box={boxes.get(id)} z={Z + 2.4} color={HIGHLIGHT_COLOR} width={3} />
        </group>
      ))}
      {picked.map((s) => (
        <group key={`picked-${s.id}`}>
          <FrontPlane box={boxes.get(s.id)} z={Z + 1.6} color={SELECTED_COLOR} opacity={0.22} />
          <Outline box={boxes.get(s.id)} z={Z + 2.2} color={SELECTED_COLOR} width={2.5} />
        </group>
      ))}
      {onMoveDivider &&
        allSections(root).flatMap((sec) =>
          sec.dividers.map((id, i) => {
            const board = boards.find((b) => b.id === id)
            if (!board || !sec.split) return null
            return (
              <DividerHandle
                key={id}
                board={board}
                axis={SPLIT_AXIS[sec.split]}
                z={Z + 3}
                onMove={(lo) => onMoveDivider(id, lo)}
                onClick={() => onSelect(sec.id)}
                onHoverChange={(on) => setHandleHover((cur) => (on ? { id, axis: SPLIT_AXIS[sec.split!] } : cur?.id === id ? null : cur))}
                onDragChange={(on) => setHandleDrag(on ? { id, axis: SPLIT_AXIS[sec.split!] } : null)}
                below={boxes.get(sec.children[i]?.id)}
                above={boxes.get(sec.children[i + 1]?.id)}
                showSizes={activeDivider === id}
              />
            )
          }),
        )}
      {choices.map((s) => {
        const box = boxes.get(s.id)
        const hot = hovered === s.id
        return (
          <group key={s.id}>
            <FrontPlane
              box={box}
              z={Z + 1.5}
              color={CHOICE_COLOR}
              opacity={hot ? 0.3 : 0.15}
              onClick={(e) => click(e, () => (ctrl(e) ? onCtrlPick!(s.id) : onSelect(s.id)))}
              onOver={() => setHovered(s.id)}
              onOut={() => setHovered((h) => (h === s.id ? null : h))}
            />
            <Outline box={box} z={Z + 1.5} color={CHOICE_COLOR} width={hot ? 2.5 : 1.5} />
            <SectionLabel box={box} z={Z} label={labels.get(s.id)!} />
          </group>
        )
      })}
    </group>
  )
}

const noRaycast = () => null

function FrontPlane({
  box,
  z,
  color = '#000',
  opacity = 0,
  visible = true,
  onClick,
  onOver,
  onOut,
}: {
  box: SectionBox | undefined
  z: number
  color?: string
  opacity?: number
  visible?: boolean
  onClick?: (e: ThreeEvent<MouseEvent>) => void
  onOver?: () => void
  onOut?: () => void
}) {
  if (!box) return null
  const w = box.max[0] - box.min[0]
  const h = box.max[1] - box.min[1]
  if (w <= 0 || h <= 0) return null
  return (
    <mesh
      position={[(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, z]}
      onClick={onClick}
      {...(onClick ? {} : { raycast: noRaycast })}
      onPointerOver={
        onOver
          ? (e) => {
              e.stopPropagation()
              onOver()
            }
          : undefined
      }
      onPointerOut={onOut}
      renderOrder={5}
    >
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial visible={visible} color={color} transparent opacity={opacity} depthWrite={false} side={DoubleSide} />
    </mesh>
  )
}

function Outline({ box, z, color, width }: { box: SectionBox | undefined; z: number; color: string; width: number }) {
  if (!box) return null
  const [x0, y0] = box.min
  const [x1, y1] = box.max
  return (
    <Line
      points={[[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [x0, y0, z]]}
      color={color}
      lineWidth={width}
      depthTest={false}
      transparent
      renderOrder={996}
      raycast={noRaycast}
    />
  )
}

function SectionLabel({ box, z, label, selected = false }: { box: SectionBox | undefined; z: number; label: string; selected?: boolean }) {
  if (!box) return null
  const w = box.max[0] - box.min[0]
  const h = box.max[1] - box.min[1]
  return (
    <Html position={[(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, z]} center zIndexRange={[8, 0]} className="axis-label">
      <span className={`section-label${selected ? ' section-label--selected' : ''}`} data-section-label={label}>
        {label}
        <small>
          {formatNumber(w)} × {formatNumber(h)}
        </small>
      </span>
    </Html>
  )
}

/** Extra grab margin [mm] around the front edge of a shelf / partition. */
const HANDLE_PAD = 8
const HANDLE_COLOR = '#e65100'

/**
 * Drag handle of a shelf / partition at the front of the furniture (over its front edge): LMB + drag moves
 * it along the split axis (1 mm steps) – the move becomes the offsets of its joints (`moveDivider`, the
 * section switches to the manual layout); a click without dragging selects its section. While hovered /
 * dragged the sizes of the two sub-sections around it are shown.
 */
function DividerHandle({
  board,
  axis,
  z,
  onMove,
  onClick,
  onHoverChange,
  onDragChange,
  below,
  above,
  showSizes,
}: {
  board: Board
  axis: 0 | 1 | 2
  z: number
  onMove: (lo: number) => void
  onClick: () => void
  onHoverChange: (on: boolean) => void
  onDragChange: (on: boolean) => void
  below: SectionBox | undefined
  above: SectionBox | undefined
  showSizes: boolean
}) {
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null
  const [hover, setHover] = useState(false)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ pointerId: number; grab: number; startX: number; startY: number; moved: boolean } | null>(null)
  const plane = useMemo(() => new Plane(new Vector3(0, 0, 1), -z), [z])
  const { min, max } = boardBounds(board)
  const lo = min[axis]

  // camera back on if the handle disappears in the middle of a drag
  useEffect(
    () => () => {
      if (drag.current && controls) controls.enabled = true
    },
    [controls],
  )

  const x0 = axis === 0 ? min[0] - HANDLE_PAD : min[0]
  const x1 = axis === 0 ? max[0] + HANDLE_PAD : max[0]
  const y0 = axis === 1 ? min[1] - HANDLE_PAD : min[1]
  const y1 = axis === 1 ? max[1] + HANDLE_PAD : max[1]
  const hot = hover || dragging
  const color = AXIS_COLORS[axis]
  const size = (b: SectionBox | undefined) => (b ? b.max[axis] - b.min[axis] : null)

  return (
    <group>
      <mesh
        position={[(x0 + x1) / 2, (y0 + y1) / 2, z]}
        renderOrder={6}
        userData={{ dividerHandle: board.id }}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHover(true)
          onHoverChange(true)
        }}
        onPointerOut={() => {
          setHover(false)
          onHoverChange(false)
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.stopPropagation()
          ;(e.target as unknown as Element).setPointerCapture(e.pointerId)
          if (controls) controls.enabled = false
          const hit = e.ray.intersectPlane(plane, new Vector3())
          drag.current = { pointerId: e.pointerId, grab: (hit ?? e.point).getComponent(axis) - lo, startX: e.clientX, startY: e.clientY, moved: false }
          setDragging(true)
          onDragChange(true)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d || e.pointerId !== d.pointerId) return
          e.stopPropagation()
          if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) <= CLICK_MAX_PX) return
          d.moved = true
          const hit = e.ray.intersectPlane(plane, new Vector3())
          if (!hit) return
          const next = Math.round(hit.getComponent(axis) - d.grab)
          if (next !== lo) onMove(next)
        }}
        onPointerUp={(e) => {
          const d = drag.current
          if (!d || e.pointerId !== d.pointerId) return
          e.stopPropagation()
          const t = e.target as unknown as Element
          if (t.hasPointerCapture(e.pointerId)) t.releasePointerCapture(e.pointerId)
          drag.current = null
          setDragging(false)
          onDragChange(false)
          if (controls) controls.enabled = true
          if (!d.moved) onClick()
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <planeGeometry args={[Math.max(1, x1 - x0), Math.max(1, y1 - y0)]} />
        <meshBasicMaterial color={HANDLE_COLOR} transparent opacity={dragging ? 0.75 : hot ? 0.55 : 0.28} depthWrite={false} side={DoubleSide} />
      </mesh>
      {showSizes &&
        [below, above].map((b, i) =>
          b ? (
            <Html
              key={i}
              // off the middle (where the section label is), towards the start of the other axis
              position={
                axis === 1
                  ? [b.min[0] + 0.22 * (b.max[0] - b.min[0]), (b.min[1] + b.max[1]) / 2, z]
                  : [(b.min[0] + b.max[0]) / 2, b.min[1] + 0.22 * (b.max[1] - b.min[1]), z]
              }
              center
              zIndexRange={[12, 0]}
              className="axis-label"
            >
              <span className="dimension-label divider-gap-label" style={{ color }} data-gap-label={i === 0 ? 'below' : 'above'}>
                {axis === 1 ? '↕' : '↔'} {formatNumber(size(b)!)}
                <small> mm</small>
              </span>
            </Html>
          ) : null,
        )}
    </group>
  )
}
