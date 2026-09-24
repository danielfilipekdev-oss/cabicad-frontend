import type { GrainDirection } from './board.ts'

/**
 * Catalog of board models (modele płyt) – a concrete furniture board of a manufacturer, e.g. Egger
 * H1145 ST10. The model of a board decides the look of its faces (the texture made from the
 * manufacturer's image), whether the grain direction matters, and the thicknesses it comes in. It
 * replaced the former veneer (okleina) list – the "veneer" now follows from the chosen board.
 *
 * The catalog is loaded from cabicad-backend (`GET /api/boards/catalog`, see `api/boardCatalog.ts`);
 * until then (or when the backend is not reachable) only the built-in default raw chipboard is
 * available. The rest of the app reads the catalog only through this module (`findBoardModel`,
 * `useBoardCatalog` …), so switching the backend source (Firebase) does not touch it.
 */

/** Board type – 1st level of the picker tree (płyta wiórowa, MDF, HDF …). */
export interface BoardType {
  id: string
  name: string
}

export interface BoardModel {
  /** Stable id stored on the board (`BoardParams.materialId`). */
  id: string
  /** Brand – 2nd level of the tree (Egger, Kronospan … or the raw-boards brand). */
  brand: string
  /** Id of the `BoardType`. */
  type: string
  /** Series (decor) code of the manufacturer, e.g. "H1145 ST10" – 3rd level of the tree. */
  seriesCode: string
  /** Decor name, e.g. "Dąb Bardolino naturalny". */
  name: string
  /**
   * Link to the image the face texture is made from (null = raw board: procedural chipboard texture or
   * a plain colour). The grain / pattern of the image runs along its HEIGHT. The browser loads it via
   * the backend proxy (`boardTextureUrl`).
   */
  textureUrl: string | null
  /** Real size [mm] of the area the image shows (texture scale). */
  textureSize: { width: number; height: number } | null
  /** Does the grain direction matter? false → the direction is locked in the UI. */
  grainMatters: boolean
  /** Available thicknesses [mm]; empty → the thickness is entered by hand. */
  thicknesses: number[]
  /** Average colour of the decor (CSS hex) – swatch and fallback while the texture loads. */
  color: string
}

export interface BoardCatalog {
  types: BoardType[]
  /** Name of the raw-boards brand – every type has it, with the default board inside. */
  rawBrand: string
  /** The board used by default (raw chipboard) – selected unless overridden in the inheritance chain. */
  defaultBoardId: string
  boards: BoardModel[]
}

export const DEFAULT_BOARD_MODEL_ID = 'raw-chipboard'
export const RAW_BRAND = 'Surowe (sklejki, płyty wiórowe...)'

/** The default raw chipboard – always available, also before / without the backend catalog. */
export const DEFAULT_BOARD_MODEL: BoardModel = {
  id: DEFAULT_BOARD_MODEL_ID,
  brand: RAW_BRAND,
  type: 'CHIPBOARD',
  seriesCode: 'PW',
  name: 'Płyta wiórowa surowa',
  textureUrl: null,
  textureSize: null,
  grainMatters: false,
  thicknesses: [8, 10, 12, 16, 18, 22, 25, 28, 38],
  color: '#d8c29a',
}

/** Built-in catalog used until the backend one is loaded. */
export const FALLBACK_CATALOG: BoardCatalog = {
  types: [{ id: 'CHIPBOARD', name: 'Płyta wiórowa laminowana' }],
  rawBrand: RAW_BRAND,
  defaultBoardId: DEFAULT_BOARD_MODEL_ID,
  boards: [DEFAULT_BOARD_MODEL],
}

export type CatalogStatus = 'loading' | 'ready' | 'error'

interface CatalogState {
  catalog: BoardCatalog
  status: CatalogStatus
  error?: string
}

let state: CatalogState = { catalog: FALLBACK_CATALOG, status: 'loading' }
const listeners = new Set<() => void>()

/** Current catalog state (for `useSyncExternalStore`). */
export const getCatalogState = (): CatalogState => state
export function subscribeCatalog(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Replaces the catalog (after loading it from the backend; tests use it too). The default board is
 * always kept – if the source does not list it, the built-in one is added.
 */
export function setBoardCatalog(catalog: BoardCatalog, status: CatalogStatus = 'ready', error?: string) {
  const hasDefault = catalog.boards.some((b) => b.id === catalog.defaultBoardId)
  const boards = hasDefault ? catalog.boards : [DEFAULT_BOARD_MODEL, ...catalog.boards]
  const defaultBoardId = hasDefault ? catalog.defaultBoardId : DEFAULT_BOARD_MODEL_ID
  const types = catalog.types.length ? catalog.types : FALLBACK_CATALOG.types
  state = { catalog: { ...catalog, types, boards, defaultBoardId }, status, error }
  listeners.forEach((l) => l())
}

/** Marks the loading as failed – the built-in catalog stays. */
export function setCatalogError(error: string) {
  state = { ...state, status: 'error', error }
  listeners.forEach((l) => l())
}

export const boardCatalog = (): BoardCatalog => state.catalog
export const defaultBoardModelId = (): string => state.catalog.defaultBoardId

/** Board model by id; `undefined` for an unknown id (e.g. before the catalog is loaded). */
export function findBoardModel(id: string | null | undefined): BoardModel | undefined {
  return id == null ? undefined : state.catalog.boards.find((b) => b.id === id)
}

/** Model used to draw a board: its own, else the default raw chipboard. */
export const boardModelOrDefault = (id: string | null | undefined): BoardModel =>
  findBoardModel(id) ?? findBoardModel(defaultBoardModelId()) ?? DEFAULT_BOARD_MODEL

/** Does the grain direction matter for the model (the grain field is locked otherwise)? */
export const hasGrain = (id: string | null | undefined): boolean => !!findBoardModel(id)?.grainMatters

export const isRawModel = (m: BoardModel): boolean => m.brand === state.catalog.rawBrand

/** "Egger H1145 ST10 – Dąb Bardolino naturalny"; raw boards only by their name. */
export function boardModelLabel(id: string | null | undefined): string {
  const m = findBoardModel(id)
  if (!m) return id ? `nieznana płyta (${id})` : DEFAULT_BOARD_MODEL.name
  return isRawModel(m) ? m.name : `${m.brand} ${m.seriesCode} – ${m.name}`
}

/** URL of the model's texture image served by the backend proxy (same origin → usable as a WebGL texture). */
export function boardTextureUrl(m: BoardModel): string | null {
  if (!m.textureUrl) return null
  const base = (import.meta.env?.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')
  return `${base}/api/boards/${encodeURIComponent(m.id)}/texture`
}

/**
 * Thickness a board gets when its model changes: the current one if the new model offers it (or any
 * thickness is allowed), else 18 mm if available, else the nearest variant.
 */
export function fitThicknessToModel(thickness: number, id: string | null | undefined): number {
  const variants = findBoardModel(id)?.thicknesses ?? []
  if (!variants.length || variants.includes(thickness)) return thickness
  if (variants.includes(18)) return 18
  return variants.reduce((best, t) => (Math.abs(t - thickness) < Math.abs(best - thickness) ? t : best), variants[0])
}

// ---- picker tree ----------------------------------------------------------------------------------

export interface BrandNode {
  brand: string
  raw: boolean
  boards: BoardModel[]
}

export interface TypeNode {
  type: BoardType
  brands: BrandNode[]
}

/**
 * Tree of the board picker: type → brand → board. Every type gets the raw-boards brand (first), which
 * always contains the default board (raw chipboard) and the raw boards of that type; the other brands
 * follow alphabetically, their boards by series code.
 */
export function boardTree(catalog: BoardCatalog = boardCatalog()): TypeNode[] {
  const def = catalog.boards.find((b) => b.id === catalog.defaultBoardId) ?? DEFAULT_BOARD_MODEL
  return catalog.types.map((type) => {
    const ofType = catalog.boards.filter((b) => b.type === type.id)
    const raw = ofType.filter((b) => b.brand === catalog.rawBrand && b.id !== def.id)
    const brands = [...new Set(ofType.filter((b) => b.brand !== catalog.rawBrand).map((b) => b.brand))].sort((a, b) => a.localeCompare(b))
    return {
      type,
      brands: [
        { brand: catalog.rawBrand, raw: true, boards: [def, ...raw] },
        ...brands.map((brand) => ({
          brand,
          raw: false,
          boards: ofType.filter((b) => b.brand === brand).sort((a, b) => a.seriesCode.localeCompare(b.seriesCode)),
        })),
      ],
    }
  })
}

/**
 * CSS for the swatch of a model: the texture image (or the average colour). The swatch element is
 * turned by 90° for the grain B–D (along the board width), since the image grain runs along its height
 * (= from edge A to edge C).
 */
export function boardSwatchStyle(id: string | null | undefined, grain: GrainDirection = 'AC'): Record<string, string> {
  const m = boardModelOrDefault(id)
  const url = boardTextureUrl(m)
  const style: Record<string, string> = { backgroundColor: m.color }
  if (url) {
    style.backgroundImage = `url("${url}")`
    style.backgroundSize = 'cover'
    style.backgroundPosition = 'center'
    if (m.grainMatters && grain === 'BD') style.transform = 'rotate(90deg)'
  } else if (m.type === 'CHIPBOARD') {
    // raw chipboard: speckled beige, like its procedural 3D texture
    style.backgroundImage =
      'radial-gradient(rgba(110, 75, 40, 0.45) 0.6px, transparent 0.8px), radial-gradient(rgba(255, 248, 230, 0.7) 0.6px, transparent 0.8px)'
    style.backgroundSize = '4px 4px, 5px 5px'
    style.backgroundPosition = '0 0, 2px 1px'
  }
  return style
}
