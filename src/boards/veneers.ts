/**
 * Veneer (okleina) catalog.
 * A veneer only changes the look of a board – it does NOT add any thickness (board dimensions stay as
 * entered). A board without a veneer (`veneerId = null`) shows the raw furniture board texture (chipboard / płyta wiórowa).
 *
 * For now the catalog is a static list of plain-colour veneers. Later it will be loaded from the texture
 * database – keep the rest of the app using only `VENEERS` / `findVeneer`, so only this module changes.
 */
export interface Veneer {
  /** Stable id stored on the board (`BoardParams.veneerId`). */
  id: string
  /** Display name in the drop-down list. */
  name: string
  /** Base colour of the veneer surface (CSS hex). A texture URL from the database will come later. */
  color: string
  /**
   * Wood-like veneer with a GRAIN (usłojenie): the colours of its light / dark growth rings. Such a veneer
   * is rendered with a procedural wood texture whose grain follows the board's grain direction
   * (`BoardParams.grain`, see `woodTextures.ts`); plain veneers have no grain.
   */
  wood?: { light: string; dark: string; seed: number }
}

export const VENEERS: Veneer[] = [
  { id: 'brown', name: 'Brązowa', color: '#c79d70' },
  { id: 'green', name: 'Zielona', color: '#8cc07c' },
  { id: 'blue', name: 'Niebieska', color: '#7ea6e0' },
  { id: 'oak', name: 'Dąb naturalny (drewnopodobna)', color: '#c9a36f', wood: { light: '#d8b683', dark: '#a8793f', seed: 3 } },
  { id: 'walnut', name: 'Orzech (drewnopodobna)', color: '#7a5234', wood: { light: '#936644', dark: '#5a3920', seed: 9 } },
]

/** Does the veneer have a grain (a direction matters)? */
export const hasGrain = (id: string | null | undefined): boolean => !!findVeneer(id)?.wood

/**
 * CSS background of a veneer swatch: the plain colour, or stripes along the grain for a wood veneer
 * ('AC' = along edges A / C → horizontal stripes, 'BD' = vertical).
 */
export function veneerSwatchBackground(id: string | null | undefined, grain: 'AC' | 'BD' = 'AC'): string | undefined {
  const v = findVeneer(id)
  if (!v) return undefined
  if (!v.wood) return v.color
  const angle = grain === 'AC' ? '0deg' : '90deg'
  return `repeating-linear-gradient(${angle}, ${v.wood.light} 0 2px, ${v.color} 2px 4px, ${v.wood.dark} 4px 5px)`
}

/** Label of the "no veneer" option – the board shows the raw chipboard texture. */
export const NO_VENEER_LABEL = 'Brak (płyta wiórowa)'

/** Veneer by id; `undefined` for `null` or an unknown id (rendered as a board without a veneer). */
export function findVeneer(id: string | null | undefined): Veneer | undefined {
  return id == null ? undefined : VENEERS.find((v) => v.id === id)
}

export function veneerLabel(id: string | null | undefined): string {
  return findVeneer(id)?.name ?? NO_VENEER_LABEL
}
