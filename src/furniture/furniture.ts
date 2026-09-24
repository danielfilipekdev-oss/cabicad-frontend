/**
 * Furniture (mebel) model – a cuboid that is also the working volume for the boards.
 *
 * Coordinate system of the furniture (all board positions are expressed in it), units: mm:
 *  - origin (0, 0, 0) = left-top corner of the furniture's bottom plane (seen from above, front
 *    at the bottom of the view) = left-back-bottom corner of the cuboid – marked with the red dot,
 *  - X → right (0…width), Y → up (0…height), Z → towards the front (0…depth).
 */
export interface Furniture {
  /** Szerokość [mm] – along X */
  width: number
  /** Wysokość [mm] – along Y */
  height: number
  /** Głębokość [mm] – along Z */
  depth: number
}

export type FurnitureDimension = keyof Furniture

/** Allowed range [mm] of a numeric value. */
export interface NumericLimits {
  min: number
  max: number
}

export const DEFAULT_FURNITURE: Furniture = { width: 800, height: 720, depth: 560 }

/** Static limits of the furniture dimensions [mm] – the cuboid must fit in the 4000 × 4000 mm workspace. */
export const FURNITURE_LIMITS: Record<FurnitureDimension, NumericLimits> = {
  width: { min: 50, max: 4000 },
  height: { min: 50, max: 3000 },
  depth: { min: 50, max: 4000 },
}

export const FURNITURE_DIMENSION_LABELS: Record<FurnitureDimension, string> = {
  width: 'Szerokość',
  height: 'Wysokość',
  depth: 'Głębokość',
}

/** Furniture size as [x, y, z] (scene units = mm). */
export function furnitureSize(f: Furniture): [number, number, number] {
  return [f.width, f.height, f.depth]
}
