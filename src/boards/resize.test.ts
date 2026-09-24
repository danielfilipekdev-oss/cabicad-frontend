import { describe, expect, it } from 'vitest'
import { DEFAULT_BOARD_PARAMS, type Board, type BoardParams } from './board.ts'
import { boardEdges, resizeBoard } from './resize.ts'

const F = { width: 800, height: 720, depth: 560 }
const board = (p: Partial<BoardParams>, x: number, y: number, z: number): Board => ({
  ...DEFAULT_BOARD_PARAMS,
  thickness: 18,
  ...p,
  id: 'b',
  name: 'b',
  position: { x, y, z },
})

describe('boardEdges', () => {
  it('has 12 edges: 4 width, 4 height, 4 corners', () => {
    const edges = boardEdges(board({ orientation: 'horizontal', width: 764, height: 540 }, 18, 351, 0))
    expect(edges).toHaveLength(12)
    expect(edges.filter((e) => e.sides.length === 1 && e.sides[0].key === 'width')).toHaveLength(4)
    expect(edges.filter((e) => e.sides.length === 1 && e.sides[0].key === 'height')).toHaveLength(4)
    expect(edges.filter((e) => e.sides.length === 2)).toHaveLength(4)
  })

  it('maps width / height to the board orientation (horizontal: height = depth along Z)', () => {
    const edges = boardEdges(board({ orientation: 'horizontal', width: 764, height: 540 }, 18, 351, 0))
    const front = edges.find((e) => e.id === 'height:1|t:0')!
    expect(front.sides[0]).toEqual({ key: 'height', axis: 2, side: 1 })
    expect(front.a).toEqual([18, 351, 540])
    expect(front.b).toEqual([782, 351, 540])
  })
})

describe('resizeBoard', () => {
  const shelf = board({ orientation: 'horizontal', width: 500, height: 400 }, 100, 300, 50)

  it('max side grows the dimension, position stays', () => {
    const r = resizeBoard(shelf, [{ key: 'width', axis: 0, side: 1 }], [120.4, 0, 0], F)
    expect(r.width).toBe(620)
    expect(r.position).toEqual(shelf.position)
    expect(r.thickness).toBe(18)
  })

  it('min side moves the position, the opposite face stays', () => {
    const r = resizeBoard(shelf, [{ key: 'width', axis: 0, side: 0 }], [-60, 0, 0], F)
    expect(r.position.x).toBe(40)
    expect(r.width).toBe(560)
  })

  it('corner changes both, clamped to the furniture and to 1 mm', () => {
    const r = resizeBoard(
      shelf,
      [
        { key: 'width', axis: 0, side: 1 },
        { key: 'height', axis: 2, side: 0 },
      ],
      [1000, 0, 500],
      F,
    )
    expect(r.width).toBe(700) // up to the right furniture wall
    expect(r.height).toBe(1) // front face fixed at z = 450, back face stopped 1 mm before it
    expect(r.position.z).toBe(449)
  })

  it('side board: width = depth (Z)', () => {
    const side = board({ orientation: 'side', width: 500, height: 700 }, 0, 0, 0)
    const edge = boardEdges(side).find((e) => e.id === 'width:1|t:0')!
    const r = resizeBoard(side, edge.sides, [0, 0, 60], F)
    expect(r.width).toBe(560)
  })
})
