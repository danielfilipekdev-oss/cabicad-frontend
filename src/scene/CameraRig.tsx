import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { Box3, MOUSE, PerspectiveCamera, Vector3 } from 'three'
import { computeFitView } from './fitCamera.ts'
import { isMoveKey, isTypingTarget, keyboardMove } from './cameraKeys.ts'
import type { Furniture } from '../furniture/furniture.ts'
import { DEFAULT_VIEW_DIRECTION, MAX_CAMERA_DISTANCE, MIN_CAMERA_DISTANCE } from './sceneConfig.ts'

export interface CameraRigHandle {
  /** Moves the camera back to the default view – straight at the front of the furniture. */
  resetView: () => void
}

/**
 * Camera + mouse controls of the design scene:
 *  - mouse wheel            → zoom in / out (towards the cursor)
 *  - left button + drag     → pan (moves the camera position together with its target)
 *  - right button + drag    → rotate (orbit) the camera around the target
 *  - middle button + drag   → zoom (dolly)
 *  - W / A / S / D          → move the camera forward / left / back / right (with its target, in the
 *                             horizontal plane – see `cameraKeys.ts`)
 *  - Q / E                  → move the camera down / up; Shift = faster
 * On start (and on "Resetuj widok") the camera looks straight at the front of the furniture, centred on it,
 * slightly from above, so that the whole furniture is visible (red dot = back, bottom left).
 */
const CameraRig = forwardRef<CameraRigHandle, { furniture: Furniture }>(function CameraRig({ furniture }, ref) {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  const resetView = useCallback(() => {
    const controls = controlsRef.current
    if (!(camera instanceof PerspectiveCamera)) return
    camera.aspect = size.width / Math.max(size.height, 1)
    camera.updateProjectionMatrix()
    // furniture occupies [0, width] × [0, height] × [0, depth] in world coordinates (origin = red dot)
    const bounds = new Box3(new Vector3(0, 0, 0), new Vector3(furniture.width, furniture.height, furniture.depth))
    const { position, target } = computeFitView(camera, bounds, DEFAULT_VIEW_DIRECTION)
    camera.position.copy(position)
    camera.lookAt(target)
    if (controls) {
      controls.target.copy(target)
      controls.update()
    }
  }, [camera, size.width, size.height, furniture.width, furniture.height, furniture.depth])

  useImperativeHandle(ref, () => ({ resetView }), [resetView])

  // Default view on first render (once the viewport size is known).
  const initialised = useRef(false)
  useEffect(() => {
    if (initialised.current || size.width === 0 || size.height === 0) return
    initialised.current = true
    resetView()
  }, [resetView, size.width, size.height])

  // ---- WASD ------------------------------------------------------------------------------------
  const held = useRef(new Set<string>())
  const shift = useRef(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      shift.current = e.shiftKey
      if (!isMoveKey(e.code) || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return
      e.preventDefault()
      held.current.add(e.code)
    }
    const up = (e: KeyboardEvent) => {
      shift.current = e.shiftKey
      held.current.delete(e.code)
    }
    // keys released while the window had no focus would stay "held"
    const clear = () => held.current.clear()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    document.addEventListener('visibilitychange', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
      document.removeEventListener('visibilitychange', clear)
    }
  }, [])
  useFrame((_, delta) => {
    const controls = controlsRef.current
    if (!held.current.size || !controls) return
    const dir = camera.getWorldDirection(new Vector3())
    const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
    // a long frame (tab switch, breakpoint) must not throw the camera away
    const dt = Math.min(delta, 0.1)
    const move = keyboardMove(held.current, dir, up, camera.position.distanceTo(controls.target), dt, shift.current)
    if (move.lengthSq() === 0) return
    camera.position.add(move)
    controls.target.add(move)
    controls.update()
  })

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.15}
      zoomToCursor
      screenSpacePanning
      minDistance={MIN_CAMERA_DISTANCE}
      maxDistance={MAX_CAMERA_DISTANCE}
      mouseButtons={{ LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }}
    />
  )
})

export default CameraRig
