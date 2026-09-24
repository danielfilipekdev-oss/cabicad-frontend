import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_BOARD_PARAMS, type Board } from './board.ts'
import { DEFAULT_FINISH, finishLabel, finishOf, withFinish } from './finish.ts'
import {
  DEFAULT_BOARD_MODEL,
  DEFAULT_BOARD_MODEL_ID,
  FALLBACK_CATALOG,
  RAW_BRAND,
  boardModelLabel,
  boardSwatchStyle,
  boardTree,
  fitThicknessToModel,
  hasGrain,
  setBoardCatalog,
  type BoardCatalog,
  type BoardModel,
} from './boardCatalog.ts'
import { textureRotation } from './boardTextures.ts'
import { createCarcassBoard } from '../carcass/carcass.ts'
import { addDivider, createRootSection, setSectionFinish } from '../sections/sections.ts'

const F = { width: 800, height: 720, depth: 560 }
const board: Board = { ...DEFAULT_BOARD_PARAMS, id: 'b', name: 'b', position: { x: 0, y: 0, z: 0 } }

const model = (m: Partial<BoardModel> & Pick<BoardModel, 'id' | 'brand' | 'type'>): BoardModel => ({
  seriesCode: m.id.toUpperCase(),
  name: m.id,
  textureUrl: `https://example.com/${m.id}.jpg`,
  textureSize: { width: 1300, height: 2800 },
  grainMatters: false,
  thicknesses: [10, 18, 25],
  color: '#aaaaaa',
  ...m,
})

/** Catalog like the backend mockup: raw boards + decors of two brands, 3 types. */
const CATALOG: BoardCatalog = {
  types: [
    { id: 'CHIPBOARD', name: 'Płyta wiórowa laminowana' },
    { id: 'MDF', name: 'MDF' },
    { id: 'HDF', name: 'HDF' },
  ],
  rawBrand: RAW_BRAND,
  defaultBoardId: DEFAULT_BOARD_MODEL_ID,
  boards: [
    DEFAULT_BOARD_MODEL,
    model({ id: 'raw-mdf', brand: RAW_BRAND, type: 'MDF', textureUrl: null, textureSize: null, thicknesses: [] }),
    model({ id: 'oak', brand: 'Egger', type: 'CHIPBOARD', seriesCode: 'H1145 ST10', name: 'Dąb Bardolino naturalny', grainMatters: true }),
    model({ id: 'white', brand: 'Egger', type: 'CHIPBOARD', seriesCode: 'W1000 ST9', thicknesses: [8, 16, 25] }),
    model({ id: 'craft', brand: 'Kronospan', type: 'CHIPBOARD', seriesCode: 'K003 PW', grainMatters: true }),
    model({ id: 'emerald', brand: 'Kronospan', type: 'MDF', seriesCode: 'K520 SU' }),
  ],
}

beforeAll(() => setBoardCatalog(CATALOG))
afterAll(() => setBoardCatalog(FALLBACK_CATALOG))

describe('board catalog (modele płyt)', () => {
  it('builds the tree type → brand → board, with the raw brand (and the default board) in every type', () => {
    const tree = boardTree()
    expect(tree.map((t) => t.type.id)).toEqual(['CHIPBOARD', 'MDF', 'HDF'])
    for (const t of tree) {
      expect(t.brands[0].brand).toBe(RAW_BRAND)
      expect(t.brands[0].boards[0].id).toBe(DEFAULT_BOARD_MODEL_ID)
    }
    expect(tree[0].brands.map((b) => b.brand)).toEqual([RAW_BRAND, 'Egger', 'Kronospan'])
    expect(tree[0].brands[1].boards.map((b) => b.seriesCode)).toEqual(['H1145 ST10', 'W1000 ST9'])
    expect(tree[1].brands[0].boards.map((b) => b.id)).toEqual([DEFAULT_BOARD_MODEL_ID, 'raw-mdf'])
    expect(tree[1].brands[1].boards.map((b) => b.id)).toEqual(['emerald'])
    expect(tree[2].brands).toHaveLength(1)
  })

  it('keeps the built-in default board when the source does not list it', () => {
    setBoardCatalog({ ...CATALOG, boards: CATALOG.boards.filter((b) => b.id !== DEFAULT_BOARD_MODEL_ID) })
    expect(boardTree()[0].brands[0].boards[0]).toEqual(DEFAULT_BOARD_MODEL)
    setBoardCatalog(CATALOG)
  })

  it('labels, and fits the thickness to the variants of a new model', () => {
    expect(boardModelLabel('oak')).toBe('Egger H1145 ST10 – Dąb Bardolino naturalny')
    expect(boardModelLabel(DEFAULT_BOARD_MODEL_ID)).toBe('Płyta wiórowa surowa')
    expect(fitThicknessToModel(25, 'oak')).toBe(25) // offered → kept
    expect(fitThicknessToModel(19, 'oak')).toBe(18) // not offered → 18 mm
    expect(fitThicknessToModel(10, 'white')).toBe(8) // no 18 → the nearest variant
    expect(fitThicknessToModel(13.5, 'raw-mdf')).toBe(13.5) // no variants → any thickness
  })
})

describe('grain direction (kierunek usłojenia)', () => {
  it('can be changed only for models whose grain matters', () => {
    expect(hasGrain('oak')).toBe(true)
    expect(hasGrain('white')).toBe(false)
    expect(hasGrain(DEFAULT_BOARD_MODEL_ID)).toBe(false)
    expect(hasGrain('unknown')).toBe(false)
    // the image grain runs along its height = from edge A to C → B–D (along the width) turns it by 90°;
    // no grain → never turned
    expect(boardSwatchStyle('oak', 'BD').transform).toBe('rotate(90deg)')
    expect(boardSwatchStyle('oak', 'AC').transform).toBeUndefined()
    expect(boardSwatchStyle('white', 'BD').transform).toBeUndefined()
    expect(textureRotation(CATALOG.boards[2], 'BD')).toBeCloseTo(Math.PI / 2)
    expect(textureRotation(CATALOG.boards[2], 'AC')).toBe(0)
    expect(textureRotation(CATALOG.boards[3], 'BD')).toBe(0)
  })

  it('is part of the finish – with the model and thickness: inherited, applied and described', () => {
    expect(DEFAULT_BOARD_PARAMS.grain).toBe('AC')
    expect(DEFAULT_BOARD_PARAMS.materialId).toBe(DEFAULT_BOARD_MODEL_ID)
    const oakBD = { ...DEFAULT_FINISH, materialId: 'oak', thickness: 25, grain: 'BD' as const }
    expect(withFinish(board, oakBD)).toMatchObject({ materialId: 'oak', thickness: 25, grain: 'BD' })
    expect(withFinish(board, { materialId: 'oak', thickness: 18, edgeBanding: DEFAULT_FINISH.edgeBanding }).grain).toBe('AC')
    expect(finishOf({ ...board, materialId: 'white', thickness: 16 })).toEqual({ ...DEFAULT_FINISH, materialId: 'white', thickness: 16 })
    expect(finishLabel(oakBD)).toContain('Egger H1145 ST10 – Dąb Bardolino naturalny 25 mm (usłojenie B–D)')
    expect(finishLabel(DEFAULT_FINISH)).not.toContain('usłojenie')
  })

  it('reaches the carcass boards and the shelves / partitions', () => {
    const left = createCarcassBoard('left', { thickness: 25, materialId: 'oak', grain: 'BD' }, F)
    expect([left.materialId, left.thickness, left.grain]).toEqual(['oak', 25, 'BD'])
    expect(createCarcassBoard('top', { thickness: 18 }, F)).toMatchObject({ materialId: DEFAULT_BOARD_MODEL_ID, grain: 'AC' })
    const sections = setSectionFinish(createRootSection(), 'root', { ...DEFAULT_FINISH, materialId: 'craft', thickness: 10, grain: 'BD' })
    const r = addDivider({ boards: [], constraints: [], sections }, 'root', 'partition', { ...DEFAULT_FINISH, thickness: 18 }, F)
    expect([r.added?.materialId, r.added?.thickness, r.added?.grain]).toEqual(['craft', 10, 'BD'])
  })
})
