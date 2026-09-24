import type { BoardOrientation } from './board.ts'
import type { ContourEdge, EdgeKey } from './cutouts.ts'
import { edgeBandModelLabel } from './edgeBandCatalog.ts'

/**
 * Edge banding (okleina krawędzi / obrzeże) of a board – the band models come from the catalog
 * (`edgeBandCatalog.ts`: type → brand → band, texture, thickness variants, roll widths).
 *
 * A board has 4 edges (the narrow faces around it), named A, B, C, D clockwise:
 *  - vertical board (seen from the front):  A – top,  B – right, C – bottom, D – left
 *  - horizontal board (seen from above, front at the bottom): A – back, B – right, C – front, D – left
 * Edges A / C run along the board width, edges B / D along the board height.
 *
 * The band has its own thickness, but it is INCLUDED in the board dimensions entered by the user (gross
 * / brutto dimensions): the render shrinks the board core by the band thickness, so the core + bands
 * together have exactly the entered size (see `boardGeometry.ts`).
 *
 * Configuration: one common band for all edges (or none) + optional per-edge overrides
 * (a different band, or no band on that edge).
 *
 * Cut-outs (see `cutouts.ts`) add new edges (E, F, G…). They are banded the same way: the common band
 * applies to them too and they can be overridden like A–D – overrides are stored under the stable edge
 * key (`A`…`D` or `<cutoutId>:s|x|y`), not under the display letter.
 */
export type EdgeId = 'A' | 'B' | 'C' | 'D'

export const EDGE_IDS: EdgeId[] = ['A', 'B', 'C', 'D']

/** Default band thickness [mm] when a band model is first chosen (then fitted to its variants). */
export const DEFAULT_EDGE_BAND_THICKNESS = 1
/** Allowed band thickness [mm] (typed by hand) and its precision. */
export const EDGE_BAND_THICKNESS_LIMITS = { min: 0.1, max: 10 }
export const EDGE_BAND_THICKNESS_STEP = 0.01

/** A band applied to an edge: the band model (okleina krawędzi) + thickness [mm]. */
export interface EdgeBand {
  /** Id of the band model from the catalog (`edgeBandCatalog.ts`). */
  typeId: string
  thickness: number
}

export interface EdgeBanding {
  /** Band on all edges, or null = no band (unless an edge overrides it). */
  common: EdgeBand | null
  /**
   * Per-edge overrides (key = edge key, see `EdgeKey`): key missing = the edge uses `common`;
   * `null` = no band on this edge; a band = this band instead of `common`.
   */
  overrides: Partial<Record<EdgeKey, EdgeBand | null>>
}

export const NO_EDGE_BANDING: EdgeBanding = { common: null, overrides: {} }

/**
 * Final band of one edge (null = no band). A band whose model is not in the catalog (not loaded yet)
 * still counts – it keeps its thickness, and is drawn in a neutral grey until the catalog arrives.
 */
export function resolveEdgeBand(banding: EdgeBanding, key: EdgeKey): EdgeBand | null {
  return key in banding.overrides ? banding.overrides[key] ?? null : banding.common
}

/** Final band of the edges A–D (null = no band). */
export function resolveEdgeBands(banding: EdgeBanding): Record<EdgeId, EdgeBand | null> {
  const out = {} as Record<EdgeId, EdgeBand | null>
  for (const e of EDGE_IDS) out[e] = resolveEdgeBand(banding, e)
  return out
}

/** Overrides that belong to existing edges (overrides of edges removed by a cut-out change are ignored). */
export function activeOverrideCount(banding: EdgeBanding, edges: ContourEdge[]): number {
  return edges.filter((e) => e.key in banding.overrides).length
}

/** Removes the overrides of the edges of a cut-out (after the cut-out was removed or its type changed). */
export function pruneCutoutOverrides(banding: EdgeBanding, cutoutId: string): EdgeBanding {
  const prefix = `${cutoutId}:`
  if (!Object.keys(banding.overrides).some((k) => k.startsWith(prefix))) return banding
  const overrides = Object.fromEntries(Object.entries(banding.overrides).filter(([k]) => !k.startsWith(prefix)))
  return { ...banding, overrides }
}

/** Band thickness [mm] of every edge (0 = no band). */
export function edgeBandThicknesses(banding: EdgeBanding): Record<EdgeId, number> {
  const bands = resolveEdgeBands(banding)
  return { A: bands.A?.thickness ?? 0, B: bands.B?.thickness ?? 0, C: bands.C?.thickness ?? 0, D: bands.D?.thickness ?? 0 }
}

/** Where the edge is on the board, e.g. "góra" – shown next to the letter in the panel. */
export function edgeSideLabel(orientation: BoardOrientation, edge: EdgeId): string {
  const sides: Record<BoardOrientation, Record<EdgeId, string>> = {
    vertical: { A: 'góra', B: 'prawo', C: 'dół', D: 'lewo' },
    side: { A: 'góra', B: 'tył', C: 'dół', D: 'przód' },
    horizontal: { A: 'tył', B: 'prawo', C: 'przód', D: 'lewo' },
  }
  return sides[orientation][edge]
}

/** E.g. "Egger H1145 ST10 – Dąb Bardolino naturalny 0,8 mm", or "brak". */
export function edgeBandLabel(band: EdgeBand | null): string {
  if (!band) return 'brak'
  return `${edgeBandModelLabel(band.typeId)} ${String(band.thickness).replace('.', ',')} mm`
}

/**
 * Validation: the bands on opposite edges must leave some board core
 * (A + C < height, B + D < width). Returns an error message or null.
 */
export function edgeBandingError(params: { width: number; height: number; edgeBanding: EdgeBanding }): string | null {
  const t = edgeBandThicknesses(params.edgeBanding)
  if (t.A + t.C >= params.height) return 'Obrzeża A + C są grubsze niż wysokość płyty.'
  if (t.B + t.D >= params.width) return 'Obrzeża B + D są grubsze niż szerokość płyty.'
  return null
}
