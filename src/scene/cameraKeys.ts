import { Vector3 } from 'three'

/**
 * Keyboard camera movement: W / S – forward / back, A / D – left / right (in the horizontal plane),
 * Q / E – down / up. The camera moves together with its orbit target (like panning), so the view keeps
 * its angle. Physical key codes are used, so it works the same on every keyboard layout.
 */
export type MoveKey = 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD' | 'KeyQ' | 'KeyE'
export const MOVE_KEYS: readonly MoveKey[] = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE']
export const isMoveKey = (code: string): code is MoveKey => (MOVE_KEYS as readonly string[]).includes(code)

/** Speed as a fraction of the camera ↔ target distance per second (close up – slow, far away – fast). */
export const KEY_MOVE_SPEED = 0.6
/** Shift held → this many times faster. */
export const KEY_MOVE_FAST = 3
/** Minimum speed [mm/s], so the camera still moves when it is very close to its target. */
export const KEY_MOVE_MIN_SPEED = 150

/**
 * Where keys typed by the user must NOT move the camera: text fields, drop-downs, editable content and
 * the 2D editor windows (they use the keys themselves).
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  return el.isContentEditable || !!el.closest('input, textarea, select, .shape-editor, .shape-window')
}

/**
 * Movement [mm] of the camera (and its target) for the held keys over `dt` seconds.
 * `viewDir` = where the camera looks; its horizontal part is "forward" (when looking straight down, the
 * camera's up vector is used instead), "right" is perpendicular to it in the floor plane, Q / E move
 * straight down / up (world Y).
 */
export function keyboardMove(
  held: ReadonlySet<string>,
  viewDir: Vector3,
  cameraUp: Vector3,
  distance: number,
  dt: number,
  fast = false,
): Vector3 {
  const f = (held.has('KeyW') ? 1 : 0) - (held.has('KeyS') ? 1 : 0)
  const r = (held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0)
  const u = (held.has('KeyE') ? 1 : 0) - (held.has('KeyQ') ? 1 : 0)
  if (!f && !r && !u) return new Vector3()
  const forward = new Vector3(viewDir.x, 0, viewDir.z)
  if (forward.lengthSq() < 1e-6) forward.set(cameraUp.x, 0, cameraUp.z) // looking straight down / up
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1)
  forward.normalize()
  const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize()
  const move = forward.multiplyScalar(f).add(right.multiplyScalar(r)).add(new Vector3(0, u, 0))
  if (move.lengthSq() === 0) return move
  const speed = Math.max(KEY_MOVE_MIN_SPEED, distance * KEY_MOVE_SPEED) * (fast ? KEY_MOVE_FAST : 1)
  return move.normalize().multiplyScalar(speed * dt)
}
