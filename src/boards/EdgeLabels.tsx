import { Html, Line } from '@react-three/drei'
import { Color } from 'three'
import type { EdgeAnchor } from './boardGeometry.ts'

/** Length [mm] of the leader line going out of the edge, and extra distance of the letter behind its end. */
const LEADER_MM = 70
const LABEL_GAP_MM = 30
/** Colour of an edge without a band. */
const NO_BAND_COLOR = '#8a8a8a'

/** Darker shade of the band colour for the letter, so light decors stay readable on the light background. */
function textColor(color: string | null): string {
  return color ? `#${new Color(color).lerp(new Color('#000000'), 0.35).getHexString()}` : NO_BAND_COLOR
}

const along = (p: [number, number, number], d: [number, number, number], k: number): [number, number, number] => [
  p[0] + d[0] * k,
  p[1] + d[1] * k,
  p[2] + d[2] * k,
]

/**
 * Labels of the board edges (A–D, plus E, F… of the cut-out edges) – styled like the X / Y / Z axis labels at the origin:
 * a short line going out of the middle of the edge and the letter at its end, both in the colour of
 * the edge band (grey dashed line = edge without a band). Drawn on top of everything.
 */
export default function EdgeLabels({ anchors }: { anchors: EdgeAnchor[] }) {
  return (
    <>
      {anchors.map(({ edge, label, point, dir, color }, i) => (
        <group key={`${edge}#${i}`}>
          <Line
            points={[point, along(point, dir, LEADER_MM)]}
            color={color ?? NO_BAND_COLOR}
            lineWidth={color ? 3 : 1.5}
            dashed={!color}
            dashSize={8}
            gapSize={6}
            depthTest={false}
            transparent
            renderOrder={997}
            raycast={() => null}
          />
          <Html position={along(point, dir, LEADER_MM + LABEL_GAP_MM)} center zIndexRange={[9, 0]} className="axis-label">
            <span style={{ color: textColor(color) }} data-edge-label={label} data-edge-key={edge}>
              {label}
            </span>
          </Html>
        </group>
      ))}
    </>
  )
}
