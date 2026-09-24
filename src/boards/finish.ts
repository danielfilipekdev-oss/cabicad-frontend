import { DEFAULT_BOARD_PARAMS, DEFAULT_GRAIN, type Board, type GrainDirection } from './board.ts'
import { NO_EDGE_BANDING, edgeBandLabel, activeOverrideCount, type EdgeBanding } from './edgeBanding.ts'
import { boardContour, uniqueEdges, type ContourEdge } from './cutouts.ts'
import { DEFAULT_BOARD_MODEL_ID, boardModelLabel, hasGrain } from './boardCatalog.ts'
import { formatNumber } from '../ui/format.ts'

/**
 * Finish (wykończenie) of a board: the board model (model płyty – decides the texture of the faces and
 * the thickness variants) with its thickness and grain direction + ABS edge banding (obrzeże) – the
 * same settings as in the form of an ordinary board. It is the unit of the inheritance chain:
 * furniture parameters → defaults of a helper panel (Płyty korpusu, Półki i Przedziały, Fronty) →
 * carcass role / section overrides.
 */
export interface BoardFinish {
  /** Id of the board model (`boardCatalog.ts`). */
  materialId: string
  /** Thickness [mm] – one of the model's variants, or any value when the model has none. */
  thickness: number
  edgeBanding: EdgeBanding
  /** Grain direction (undefined = the default, A–C); matters only for a model with a grain. */
  grain?: GrainDirection
}

/** The default finish: raw chipboard 18 mm, no edge banding. */
export const DEFAULT_FINISH: BoardFinish = {
  materialId: DEFAULT_BOARD_MODEL_ID,
  thickness: DEFAULT_BOARD_PARAMS.thickness,
  edgeBanding: NO_EDGE_BANDING,
  grain: DEFAULT_GRAIN,
}

/** Defaults for new boards of a helper panel – the finish (board model + thickness …). */
export type BoardDefaults = BoardFinish

/**
 * Defaults of a helper panel (Płyty korpusu, Półki i Przedziały): the board (model, thickness) and edge
 * banding of new boards, or null = inherited from the furniture parameters.
 */
export interface PanelDefaults {
  finish: BoardFinish | null
}

export const finishOf = (b: BoardFinish): BoardFinish => ({
  materialId: b.materialId,
  thickness: b.thickness,
  edgeBanding: b.edgeBanding,
  grain: b.grain ?? DEFAULT_GRAIN,
})

/** Applies the finish to a board – its model, thickness, grain and edge banding. */
export const withFinish = <T extends Board>(b: T, f: BoardFinish): T => ({
  ...b,
  materialId: f.materialId,
  thickness: f.thickness,
  edgeBanding: f.edgeBanding,
  grain: f.grain ?? DEFAULT_GRAIN,
})

/** The four sides A–D of a plain rectangular board – the edges a default configuration can override. */
export const RECT_EDGES: ContourEdge[] = uniqueEdges(boardContour(DEFAULT_BOARD_PARAMS))

/** Short description, e.g. "płyta: Egger H1145 ST10 – Dąb Bardolino naturalny 18 mm (usłojenie A–C) · obrzeże: brak". */
export function finishLabel(f: BoardFinish): string {
  const overrides = activeOverrideCount(f.edgeBanding, RECT_EDGES)
  const grain = hasGrain(f.materialId) ? ` (usłojenie ${(f.grain ?? DEFAULT_GRAIN) === 'AC' ? 'A–C' : 'B–D'})` : ''
  return `płyta: ${boardModelLabel(f.materialId)} ${formatNumber(f.thickness)} mm${grain} · obrzeże: ${edgeBandLabel(f.edgeBanding.common)}${
    overrides ? ` (+${overrides} ${overrides === 1 ? 'krawędź' : 'krawędzie'})` : ''
  }`
}
