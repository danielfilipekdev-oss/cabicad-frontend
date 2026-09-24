import { describe, expect, it } from 'vitest'
import { DEFAULT_BOARD_PARAMS, DRAFT_BOARD_ID, boardBounds, centeredPosition, createBoard, draftBoard } from './board.ts'
import type { Furniture } from '../furniture/furniture.ts'

const F: Furniture = { width: 800, height: 720, depth: 560 }

describe('new board placement', () => {
  it('puts a new board in the centre of the furniture', () => {
    const b = createBoard({ ...DEFAULT_BOARD_PARAMS, width: 600, height: 500, thickness: 18 }, [], F)
    expect(b.position).toEqual({ x: 100, y: 110, z: 271 })
    const { min, max } = boardBounds(b)
    expect([(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]).toEqual([400, 360, 280])
  })

  it('centres every orientation and ignores the existing boards (collisions are allowed)', () => {
    const side = createBoard({ ...DEFAULT_BOARD_PARAMS, orientation: 'side', width: 400, height: 300 }, [], F)
    expect(side.position).toEqual({ x: 391, y: 210, z: 80 })
    const flat = { ...DEFAULT_BOARD_PARAMS, orientation: 'horizontal' as const, width: 500, height: 400 }
    const first = createBoard(flat, [], F)
    const second = createBoard(flat, [first], F)
    expect(second.position).toEqual(first.position)
    expect(second.name).toBe('Płyta 2')
  })

  it('a board as big as the furniture sits at 0 and a too big one is shrunk first', () => {
    expect(centeredPosition({ ...DEFAULT_BOARD_PARAMS, width: 800, height: 720 }, F)).toEqual({ x: 0, y: 0, z: 271 })
    const big = createBoard({ ...DEFAULT_BOARD_PARAMS, width: 2000, height: 2000 }, [], F)
    expect([big.width, big.height, big.position.x, big.position.y]).toEqual([800, 720, 0, 0])
  })

  it('rounds the centred position to 0.1 mm', () => {
    expect(centeredPosition({ ...DEFAULT_BOARD_PARAMS, width: 600.3, height: 500, thickness: 18.5 }, F)).toEqual({ x: 99.9, y: 110, z: 270.8 })
  })

  it('the draft preview is exactly where the board will be added', () => {
    const params = { ...DEFAULT_BOARD_PARAMS, width: 300, height: 200 }
    const draft = draftBoard(params, F)
    const board = createBoard(params, [], F)
    expect(draft.id).toBe(DRAFT_BOARD_ID)
    expect(draft.position).toEqual(board.position)
    expect([draft.width, draft.height]).toEqual([board.width, board.height])
  })
})
