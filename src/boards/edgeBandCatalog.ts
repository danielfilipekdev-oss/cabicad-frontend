import { useSyncExternalStore, type CSSProperties } from 'react'
import type { BoardType } from './boardCatalog.ts'

/**
 * Catalog of edge bands (okleiny krawędzi / obrzeża) – the same idea as the board models
 * (`boardCatalog.ts`): a concrete band of a producer (e.g. Egger ABS H1145 ST10) decides the look of
 * the banded edges (texture from the decor image), the thicknesses it comes in and the roll widths.
 * Bands are linked to the boards of the same decor (`matchingBoardIds`) – the picker offers those first.
 *
 * Loaded from cabicad-backend (`GET /api/edge-bands/catalog`, `api/edgeBandCatalog.ts`); until then the
 * catalog is empty (a board keeps its bands – an unknown band is drawn in a neutral grey).
 */
export interface EdgeBandModel {
  /** Stable id stored in the banding (`EdgeBand.typeId`). */
  id: string
  brand: string
  /** Id of the band type (ABS, PCV, melamina). */
  type: string
  /** Decor code, e.g. "H1145 ST10". */
  seriesCode: string
  name: string
  /** Decor image (its pattern runs along the image height) – laid ALONG the edge; null = plain colour. */
  textureUrl: string | null
  textureSize: { width: number; height: number } | null
  /** The decor has a grain / pattern direction (always laid along the edge). */
  grainMatters: boolean
  /** Available thicknesses [mm]; empty → any thickness entered by hand. */
  thicknesses: number[]
  /** Widths [mm] of the rolls – the band must be wider than the board thickness. */
  widths: number[]
  /** Average colour (CSS hex) – swatch / fallback while the texture loads. */
  color: string
  /** Boards (`BoardModel.id`) of the same decor. */
  matchingBoardIds: string[]
}

export interface EdgeBandCatalog {
  types: BoardType[]
  bands: EdgeBandModel[]
}

export type CatalogStatus = 'loading' | 'ready' | 'error'
interface State {
  catalog: EdgeBandCatalog
  status: CatalogStatus
  error?: string
}

export const EMPTY_BAND_CATALOG: EdgeBandCatalog = { types: [], bands: [] }

let state: State = { catalog: EMPTY_BAND_CATALOG, status: 'loading' }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export const getBandCatalogState = (): State => state
export function subscribeBandCatalog(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export function setEdgeBandCatalog(catalog: EdgeBandCatalog, status: CatalogStatus = 'ready', error?: string) {
  state = { catalog, status, error }
  emit()
}
export function setBandCatalogError(error: string) {
  state = { ...state, status: 'error', error }
  emit()
}

/** Current band catalog + status; re-renders when it is loaded. */
export const useEdgeBandCatalog = () => useSyncExternalStore(subscribeBandCatalog, getBandCatalogState)

/** Colour of a band whose model is unknown (catalog not loaded yet / removed from the catalog). */
export const UNKNOWN_BAND_COLOR = '#9a9a9a'

export function findEdgeBandModel(id: string | null | undefined): EdgeBandModel | undefined {
  return id == null ? undefined : state.catalog.bands.find((b) => b.id === id)
}

export const edgeBandColor = (id: string | null | undefined): string => findEdgeBandModel(id)?.color ?? UNKNOWN_BAND_COLOR

/** "Egger H1145 ST10 – Dąb Bardolino naturalny" (the id when unknown). */
export function edgeBandModelLabel(id: string): string {
  const m = findEdgeBandModel(id)
  return m ? `${m.brand} ${m.seriesCode} – ${m.name}` : `nieznane obrzeże (${id})`
}

/** Bands of the same decor as the board model. */
export const bandsMatchingBoard = (materialId: string | null | undefined): EdgeBandModel[] =>
  materialId ? state.catalog.bands.filter((b) => b.matchingBoardIds.includes(materialId)) : []

/** URL of the band's decor image served by the backend proxy. */
export function edgeBandTextureUrl(m: EdgeBandModel): string | null {
  if (!m.textureUrl) return null
  const base = (import.meta.env?.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')
  return `${base}/api/edge-bands/${encodeURIComponent(m.id)}/texture`
}

/**
 * Thickness of a band after choosing a (new) band model: the current one if the model offers it (or
 * allows any), else 1 mm / 0.8 mm if offered, else the nearest variant.
 */
export function fitBandThickness(thickness: number, id: string | null | undefined): number {
  const variants = findEdgeBandModel(id)?.thicknesses ?? []
  if (!variants.length || variants.includes(thickness)) return thickness
  for (const t of [1, 0.8]) if (variants.includes(t)) return t
  return variants.reduce((best, t) => (Math.abs(t - thickness) < Math.abs(best - thickness) ? t : best), variants[0])
}

/**
 * A board thicker than the widest roll of the band cannot be banded with it – returns a warning or null.
 * (Bands are usually 2–5 mm wider than the board; the excess is trimmed.)
 */
export function bandWidthProblem(id: string, boardThickness: number): string | null {
  const m = findEdgeBandModel(id)
  if (!m || !m.widths.length) return null
  const max = Math.max(...m.widths)
  return boardThickness > max
    ? `Obrzeże ${m.seriesCode} ma rolki do ${String(max).replace('.', ',')} mm – węższe niż płyta (${String(boardThickness).replace('.', ',')} mm).`
    : null
}

export interface BandTypeNode {
  type: BoardType
  brands: { brand: string; bands: EdgeBandModel[] }[]
}

/** Tree of the band picker: type → brand (alphabetically) → band (by decor code). */
export function edgeBandTree(catalog: EdgeBandCatalog = state.catalog): BandTypeNode[] {
  return catalog.types
    .map((type) => {
      const ofType = catalog.bands.filter((b) => b.type === type.id)
      const brands = [...new Set(ofType.map((b) => b.brand))].sort((a, b) => a.localeCompare(b))
      return {
        type,
        brands: brands.map((brand) => ({
          brand,
          bands: ofType.filter((b) => b.brand === brand).sort((a, b) => a.seriesCode.localeCompare(b.seriesCode)),
        })),
      }
    })
    .filter((t) => t.brands.length)
}

/** Swatch of a band: its decor image (turned so the pattern runs along the swatch width) or colour. */
export function edgeBandSwatchStyle(id: string | null | undefined): CSSProperties {
  const m = findEdgeBandModel(id)
  if (!m) return { backgroundColor: UNKNOWN_BAND_COLOR }
  const url = edgeBandTextureUrl(m)
  return url
    ? { backgroundColor: m.color, backgroundImage: `url("${url}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { backgroundColor: m.color }
}

/** Style of an edge letter tag in the band colour – dark bands get white letters. */
export function edgeBandTagStyle(id: string | null | undefined): CSSProperties | undefined {
  if (!id) return undefined
  const hex = edgeBandColor(id)
  const n = parseInt(hex.slice(1), 16)
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return { background: hex, color: lum < 0.5 ? '#fff' : undefined }
}
