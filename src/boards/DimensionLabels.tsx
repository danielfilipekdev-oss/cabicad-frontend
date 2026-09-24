import { Html, Line } from '@react-three/drei'
import { dimensionAxis, type Board } from './board.ts'
import { localToWorld } from './boardGeometry.ts'
import { AXIS_COLORS } from '../scene/sceneConfig.ts'
import { formatNumber } from '../ui/format.ts'

type Vec3 = [number, number, number]

/**
 * Distance [mm] of the dimension line from the board edge – close to the board, INSIDE the leader lines
 * of the A–D letters (they end ~100 mm out, see `EdgeLabels`), so both stay readable.
 */
const OFFSET_MM = 45
/** Gap between the board and the extension line, and how far the extension line runs past the dimension line. */
const EXT_GAP_MM = 8
const EXT_OVER_MM = 15
/**
 * The value sits on the line, shifted from its middle (where the A / D letter is) – towards edge B on
 * the width line and towards edge C on the height line – so it never covers the letter.
 */
const TEXT_SHIFT = 0.3

/**
 * Dimensions of a board shown in the scene (selected board, preview of a new board) – styled like the
 * X / Y / Z axes at the origin: a line in the colour of the world axis the dimension runs along
 * (X red, Y green, Z blue) and the value in the same bold label, drawn on top of everything.
 *  - szerokość: a dimension line parallel to edge A (beyond it),
 *  - wysokość:  a dimension line parallel to edge D (beyond it),
 * both with thin extension lines from the board corners, in the plane of the board (middle of its
 * thickness). The value sits ON the line (off its middle, see `TEXT_SHIFT`), on a light pill. The values are the gross outline (with the edge bands, like the entered dimensions).
 */
export default function DimensionLabels({ board }: { board: Board }) {
  const W = board.width
  const H = board.height
  const t = board.thickness / 2
  const at = (x: number, y: number): Vec3 => localToWorld(board, [x, y, t])
  const dims = [
    {
      key: 'width',
      label: 'szer.',
      value: W,
      color: AXIS_COLORS[dimensionAxis(board.orientation, 'width')],
      line: [at(0, H + OFFSET_MM), at(W, H + OFFSET_MM)] as [Vec3, Vec3],
      ext: [
        [at(0, H + EXT_GAP_MM), at(0, H + OFFSET_MM + EXT_OVER_MM)],
        [at(W, H + EXT_GAP_MM), at(W, H + OFFSET_MM + EXT_OVER_MM)],
      ] as [Vec3, Vec3][],
      text: at(W * (1 - TEXT_SHIFT), H + OFFSET_MM),
    },
    {
      key: 'height',
      label: 'wys.',
      value: H,
      color: AXIS_COLORS[dimensionAxis(board.orientation, 'height')],
      line: [at(-OFFSET_MM, 0), at(-OFFSET_MM, H)] as [Vec3, Vec3],
      ext: [
        [at(-EXT_GAP_MM, 0), at(-OFFSET_MM - EXT_OVER_MM, 0)],
        [at(-EXT_GAP_MM, H), at(-OFFSET_MM - EXT_OVER_MM, H)],
      ] as [Vec3, Vec3][],
      text: at(-OFFSET_MM, H * TEXT_SHIFT),
    },
  ]
  return (
    <>
      {dims.map((d) => (
        <group key={d.key}>
          <Line points={d.line} color={d.color} lineWidth={2.5} depthTest={false} transparent renderOrder={998} raycast={() => null} />
          {d.ext.map((pts, i) => (
            <Line key={i} points={pts} color={d.color} lineWidth={1} depthTest={false} transparent renderOrder={998} raycast={() => null} />
          ))}
          <Html position={d.text} center zIndexRange={[10, 0]} className="axis-label">
            <span className="dimension-label" style={{ color: d.color }} data-dimension={d.key}>
              {formatNumber(d.value)}
              <small> mm</small>
            </span>
          </Html>
        </group>
      ))}
    </>
  )
}
