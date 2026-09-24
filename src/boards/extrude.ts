import { ExtrudeGeometry, Shape, Vector2 } from 'three'
import type { Vec2 } from './polygon.ts'

/** Polygon of the 2D frame extruded along +Z by `depth` (the board thickness). */
export function extrude(polygon: Vec2[], depth: number): ExtrudeGeometry {
  const shape = new Shape(polygon.map(([x, y]) => new Vector2(x, y)))
  return new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 })
}
