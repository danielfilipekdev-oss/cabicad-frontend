import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { KEY_MOVE_FAST, KEY_MOVE_MIN_SPEED, KEY_MOVE_SPEED, isMoveKey, keyboardMove } from './cameraKeys.ts'

const UP = new Vector3(0, 1, 0)
// camera in front of the furniture, looking at it (towards −Z) and slightly down
const LOOK = new Vector3(0, -0.3, -1).normalize()

describe('WASD camera movement', () => {
  it('W / S move along the horizontal view direction, A / D sideways', () => {
    const w = keyboardMove(new Set(['KeyW']), LOOK, UP, 1000, 1)
    expect(w.y).toBe(0)
    expect(w.z).toBeCloseTo(-1000 * KEY_MOVE_SPEED)
    expect(keyboardMove(new Set(['KeyS']), LOOK, UP, 1000, 1).z).toBeCloseTo(1000 * KEY_MOVE_SPEED)
    expect(keyboardMove(new Set(['KeyD']), LOOK, UP, 1000, 1).x).toBeCloseTo(1000 * KEY_MOVE_SPEED)
    expect(keyboardMove(new Set(['KeyA']), LOOK, UP, 1000, 1).x).toBeCloseTo(-1000 * KEY_MOVE_SPEED)
  })

  it('diagonals keep the speed, opposite keys cancel, Shift is faster, a close camera still moves', () => {
    expect(keyboardMove(new Set(['KeyW', 'KeyD']), LOOK, UP, 1000, 1).length()).toBeCloseTo(1000 * KEY_MOVE_SPEED)
    expect(keyboardMove(new Set(['KeyW', 'KeyS']), LOOK, UP, 1000, 1).length()).toBe(0)
    expect(keyboardMove(new Set(['KeyW']), LOOK, UP, 1000, 1, true).length()).toBeCloseTo(1000 * KEY_MOVE_SPEED * KEY_MOVE_FAST)
    expect(keyboardMove(new Set(['KeyW']), LOOK, UP, 10, 1).length()).toBeCloseTo(KEY_MOVE_MIN_SPEED)
  })

  it('looking straight down: forward = the camera up vector in the floor plane', () => {
    const m = keyboardMove(new Set(['KeyW']), new Vector3(0, -1, 0), new Vector3(0, 0, -1), 1000, 0.5)
    expect(m.z).toBeCloseTo(-500 * KEY_MOVE_SPEED)
    expect(isMoveKey('KeyW') && isMoveKey('KeyQ') && !isMoveKey('KeyR')).toBe(true)
  })

  it('Q / E move straight down / up, combined with the others at the same speed', () => {
    const e = keyboardMove(new Set(['KeyE']), LOOK, UP, 1000, 1)
    expect([e.x, e.z]).toEqual([0, 0])
    expect(e.y).toBeCloseTo(1000 * KEY_MOVE_SPEED)
    expect(keyboardMove(new Set(['KeyQ']), LOOK, UP, 1000, 1).y).toBeCloseTo(-1000 * KEY_MOVE_SPEED)
    expect(keyboardMove(new Set(['KeyQ', 'KeyE']), LOOK, UP, 1000, 1).length()).toBe(0)
    expect(keyboardMove(new Set(['KeyW', 'KeyE']), LOOK, UP, 1000, 1).length()).toBeCloseTo(1000 * KEY_MOVE_SPEED)
  })
})
