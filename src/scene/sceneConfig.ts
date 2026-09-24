import { Vector3 } from 'three'

/**
 * Scene configuration for the single-furniture design workspace.
 * Units: millimetres (1 scene unit = 1 mm) – the same base unit as board dimensions.
 */

/** Size of the working area (floor) in which a single piece of furniture is designed. */
export const WORKSPACE_SIZE = { width: 4000, depth: 4000, height: 2500 }

/** Grid: 100 mm (10 cm) cells, 1000 mm (1 m) sections. */
export const GRID_CELL_SIZE = 100
export const GRID_SECTION_SIZE = 1000
/** Distance from the camera [mm] at which the grid fully fades out. */
export const GRID_FADE_DISTANCE = 40000

/** Colours of the X / Y / Z axes (red / green / blue) – also used by the dimension labels of a board. */
export const AXIS_COLORS: [string, string, string] = ['#e53935', '#43a047', '#1e63d6']

/** Length [mm] of the X / Y / Z axes drawn from the furniture origin (red dot). */
export const AXIS_LENGTH = 300

/**
 * Direction (from the furniture centre) from which the default view looks at the furniture: straight
 * at its front, centred, slightly from above – the red dot is then at the back, bottom left.
 */
export const DEFAULT_VIEW_DIRECTION = new Vector3(0, 0.3, 1).normalize()

export const CAMERA_FOV = 50

/** Zoom limits (distance camera ↔ target). */
export const MIN_CAMERA_DISTANCE = 200
export const MAX_CAMERA_DISTANCE = 50000

/** Camera clipping planes [mm]. */
export const CAMERA_NEAR = 10
export const CAMERA_FAR = 500000
