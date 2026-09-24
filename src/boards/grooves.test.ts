import { describe, expect, it } from 'vitest'
import { MeshBasicMaterial, Vector3, type BufferGeometry } from 'three'
import { DEFAULT_BOARD_PARAMS, type BoardParams } from './board.ts'
import { extrude } from './extrude.ts'
import { cutGrooves } from './grooveGeometry.ts'
import {
  boardGrooves,
  createGroove,
  grooveBox,
  grooveProblem,
  grooveRange,
  grooveSpan,
  withGrooveParam,
  type Groove,
} from './grooves.ts'

const board = (p: Partial<BoardParams> = {}): BoardParams => ({ ...DEFAULT_BOARD_PARAMS, width: 600, height: 720, thickness: 18, ...p })

/** Volume of a closed triangle mesh [mm³]. */
function volume(g: BufferGeometry): number {
  const pos = g.getAttribute('position')
  const idx = g.getIndex()
  const n = idx ? idx.count : pos.count
  const at = (i: number) => new Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i)
  let v = 0
  for (let i = 0; i < n; i += 3) v += at(i).dot(at(i + 1).cross(at(i + 2))) / 6
  return Math.abs(v)
}

describe('grooves (frezowania)', () => {
  it('a new face groove runs through the whole board, 4 × 8 mm, 10 mm from edge C', () => {
    const p = board()
    const g = createGroove(p, 'front')
    expect(g).toMatchObject({ side: 'front', dir: 'AC', width: 4, depth: 8, offset: 10, through: true, start: 0, length: 600 })
    expect(grooveBox(p, g)).toEqual({ min: [0, 10, 10], max: [600, 14, 18] })
    const back = createGroove(p, 'back', 'BD')
    expect(back).toMatchObject({ start: 0, length: 720 })
    expect(grooveBox(p, back)).toEqual({ min: [10, 0, 0], max: [14, 720, 8] })
  })

  it('an edge groove sits in the middle of the thickness, along its straight part(s)', () => {
    const p = board({ cutouts: [{ id: 'r', kind: 'radius', corner: 'DA', x: 50, y: 50 }] })
    const g = createGroove(p, 'A')
    expect(g).toMatchObject({ offset: 7, width: 4, start: 50, length: 550 })
    expect(grooveSpan(p, g)).toEqual([50, 600])
    expect(grooveBox(p, g)).toEqual({ min: [50, 712, 7], max: [600, 720, 11] })
  })

  it('only a bare edge can be milled', () => {
    const banded = board({ edgeBanding: { common: { typeId: 'brown', thickness: 0.8 }, overrides: {} } as BoardParams['edgeBanding'] })
    expect(grooveProblem(banded, { side: 'B' })).toMatch(/obrzeże/)
    expect(grooveProblem(banded, { side: 'front' })).toBeNull()
    expect(grooveProblem(board(), { side: 'B' })).toBeNull()
  })

  it('values stay valid: depth leaves 1 mm, the groove stays on the board, fitted when the board shrinks', () => {
    const p = board()
    let g: Groove = { ...createGroove(p, 'front'), through: false, start: 100, length: 200 }
    expect(grooveRange(p, g, 'depth')).toEqual({ min: 1, max: 17 })
    g = withGrooveParam(p, g, 'depth', 40)
    expect(g.depth).toBe(17)
    g = withGrooveParam(p, g, 'length', 9999)
    expect(g.length).toBe(500)
    const small = { ...p, width: 250, grooves: [g] }
    expect(boardGrooves(small)[0]).toMatchObject({ start: 100, length: 150 })
  })

  it('the render geometry loses exactly the groove volume (CSG)', () => {
    const p = board()
    const core = extrude(
      [
        [0, 0],
        [600, 0],
        [600, 720],
        [0, 720],
      ],
      18,
    )
    const m = new MeshBasicMaterial()
    const face = createGroove(p, 'front') // 600 × 4 × 8
    const edge = createGroove(p, 'D') // 720 × 4 × 8 (along Y, in edge D)
    const out = cutGrooves(core, [m, m], p, [face, edge], m)
    const expected = 600 * 720 * 18 - 600 * 4 * 8 - 720 * 4 * 8 + 4 * 4 * 0 // they do not meet (face 10–14 mm from C, 0–8 deep at z 10–18; edge at z 7–11, x 0–8)
    const overlap = 4 * 8 * 1 // x 0–8 × y 10–14 × z 10–11 counted twice
    expect(volume(out.geometry)).toBeCloseTo(expected + overlap, 0)
  })

  it('a groove ACROSS an edge runs through the thickness, positioned along the edge', () => {
    const p = board()
    const g = createGroove(p, 'A', 'AC', true)
    // in the middle of edge A (600 mm), 4 wide, 8 deep, through the whole thickness
    expect(g).toMatchObject({ side: 'A', across: true, offset: 298, width: 4, depth: 8, through: true, start: 0, length: 18 })
    expect(grooveBox(p, g)).toEqual({ min: [298, 712, 0], max: [302, 720, 18] })
    // a pocket: not through, 10 mm of the thickness from strona 2 + 3 mm; position limited to the edge
    const pocket = withGrooveParam(p, withGrooveParam(p, { ...g, through: false }, 'length', 10), 'start', 3)
    expect(grooveBox(p, pocket)).toEqual({ min: [298, 712, 3], max: [302, 720, 13] })
    expect(grooveRange(p, g, 'offset')).toEqual({ min: 0, max: 596 })
    // edge B: along Y, offset from C
    const b = createGroove(p, 'B', 'AC', true)
    expect(grooveBox(p, b)).toEqual({ min: [592, 358, 0], max: [600, 362, 18] })
    // CSG: exactly the pocket volume goes
    const core = extrude(
      [
        [0, 0],
        [600, 0],
        [600, 720],
        [0, 720],
      ],
      18,
    )
    const m = new MeshBasicMaterial()
    const out = cutGrooves(core, [m, m], p, [pocket], m)
    expect(volume(out.geometry)).toBeCloseTo(600 * 720 * 18 - 4 * 8 * 10, 0)
  })
})
