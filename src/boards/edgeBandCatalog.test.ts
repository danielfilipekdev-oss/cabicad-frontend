import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  EMPTY_BAND_CATALOG,
  UNKNOWN_BAND_COLOR,
  bandWidthProblem,
  bandsMatchingBoard,
  edgeBandColor,
  edgeBandTree,
  fitBandThickness,
  setEdgeBandCatalog,
  type EdgeBandCatalog,
  type EdgeBandModel,
} from './edgeBandCatalog.ts'
import { edgeBandLabel, edgeBandThicknesses, resolveEdgeBand } from './edgeBanding.ts'

const band = (b: Partial<EdgeBandModel> & Pick<EdgeBandModel, 'id' | 'brand' | 'type' | 'seriesCode'>): EdgeBandModel => ({
  name: b.id,
  textureUrl: null,
  textureSize: null,
  grainMatters: false,
  thicknesses: [0.4, 0.8, 2],
  widths: [22, 43],
  color: '#123456',
  matchingBoardIds: [],
  ...b,
})

const CATALOG: EdgeBandCatalog = {
  types: [
    { id: 'ABS', name: 'ABS' },
    { id: 'PCV', name: 'PCV' },
    { id: 'MELAMINE', name: 'Melamina' },
  ],
  bands: [
    band({ id: 'oak', brand: 'Egger', type: 'ABS', seriesCode: 'H1145 ST10', name: 'Dąb Bardolino naturalny', matchingBoardIds: ['board-oak'] }),
    band({ id: 'white', brand: 'Egger', type: 'ABS', seriesCode: 'W1000 ST9' }),
    band({ id: 'craft', brand: 'Spander', type: 'ABS', seriesCode: 'K003 PW', thicknesses: [0.8, 1, 2], matchingBoardIds: ['board-craft'] }),
    band({ id: 'black', brand: 'Uniwersalne', type: 'PCV', seriesCode: 'CZ', thicknesses: [], widths: [22] }),
  ],
}

beforeAll(() => setEdgeBandCatalog(CATALOG))
afterAll(() => setEdgeBandCatalog(EMPTY_BAND_CATALOG))

describe('edge band catalog (okleiny krawędzi)', () => {
  it('builds the tree type → brand → band; types without bands are left out', () => {
    const tree = edgeBandTree()
    expect(tree.map((t) => t.type.id)).toEqual(['ABS', 'PCV'])
    expect(tree[0].brands.map((b) => b.brand)).toEqual(['Egger', 'Spander'])
    expect(tree[0].brands[0].bands.map((b) => b.seriesCode)).toEqual(['H1145 ST10', 'W1000 ST9'])
  })

  it('offers the bands of the board decor', () => {
    expect(bandsMatchingBoard('board-oak').map((b) => b.id)).toEqual(['oak'])
    expect(bandsMatchingBoard('other')).toEqual([])
  })

  it('fits the thickness to the variants of a new band', () => {
    expect(fitBandThickness(2, 'oak')).toBe(2) // offered → kept
    expect(fitBandThickness(1, 'oak')).toBe(0.8) // no 1 mm → 0.8 mm
    expect(fitBandThickness(0.4, 'craft')).toBe(1) // → 1 mm
    expect(fitBandThickness(1.3, 'black')).toBe(1.3) // no variants → any
  })

  it('warns when no roll is as wide as the board is thick', () => {
    expect(bandWidthProblem('oak', 38)).toBeNull()
    expect(bandWidthProblem('black', 25)).toContain('22 mm')
    expect(bandWidthProblem('unknown', 100)).toBeNull()
  })

  it('keeps a band whose model is unknown (catalog not loaded) – grey, with its thickness', () => {
    const banding = { common: { typeId: 'not-loaded', thickness: 2 }, overrides: {} }
    expect(resolveEdgeBand(banding, 'A')).toEqual({ typeId: 'not-loaded', thickness: 2 })
    expect(edgeBandThicknesses(banding).B).toBe(2)
    expect(edgeBandColor('not-loaded')).toBe(UNKNOWN_BAND_COLOR)
    expect(edgeBandLabel({ typeId: 'oak', thickness: 0.8 })).toBe('Egger H1145 ST10 – Dąb Bardolino naturalny 0,8 mm')
    expect(edgeBandLabel(null)).toBe('brak')
  })
})
