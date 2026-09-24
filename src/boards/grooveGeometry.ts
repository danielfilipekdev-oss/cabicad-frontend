import type { BufferGeometry, Material } from 'three'
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'
import { extrude } from './extrude.ts'
import { grooveBox, type Groove } from './grooves.ts'

/**
 * Grooves cut out of the render geometry of a board (CSG – three-bvh-csg): the core and the band pieces
 * minus a box per groove. The walls / bottom of a groove get `wall` (raw chipboard). Geometry in the
 * board's local frame (2D frame + Z = thickness, as `extrude`).
 */

/** Box of a groove as an extrusion (UVs in mm, like the board) – a bit longer / out of the board, so the cut is clean. */
function grooveBrush(p: { width: number; height: number; thickness: number }, g: Groove, wall: Material): Brush {
  const { min, max } = grooveBox(p, g, 0.5)
  const geometry = extrude(
    [
      [min[0], min[1]],
      [max[0], min[1]],
      [max[0], max[1]],
      [min[0], max[1]],
    ],
    max[2] - min[2],
  )
  geometry.translate(0, 0, min[2])
  const brush = new Brush(geometry, [wall, wall])
  brush.updateMatrixWorld()
  return brush
}

const evaluator = new Evaluator()
evaluator.useGroups = true
evaluator.attributes = ['position', 'uv', 'normal']

/**
 * `geometry` (with `materials`, one per group) minus the grooves. Returns the new geometry and its
 * materials (the groove walls appended), or the input when there are no grooves.
 */
export function cutGrooves(
  geometry: BufferGeometry,
  materials: Material[],
  board: { width: number; height: number; thickness: number },
  grooves: Groove[],
  wall: Material,
): { geometry: BufferGeometry; materials: Material[] } {
  if (!grooves.length) return { geometry, materials }
  let result = new Brush(geometry, materials)
  result.updateMatrixWorld()
  for (const g of grooves) {
    const cutter = grooveBrush(board, g, wall)
    result = evaluator.evaluate(result, cutter, SUBTRACTION) as Brush
    cutter.geometry.dispose()
  }
  const mats = Array.isArray(result.material) ? result.material : [result.material]
  return { geometry: result.geometry, materials: mats }
}
