import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import type { Furniture } from '../furniture/furniture.ts'

export const FURNITURE_EDGE_COLOR = '#2f6fd6'

type P = [number, number, number]

/**
 * Furniture cuboid drawn in the furniture coordinate system (origin = left-top corner of its bottom
 * plane, X → right, Y → up, Z → front) as an outline of its 12 edges. It shows the volume in which the
 * boards can be placed without leaving the furniture.
 */
export default function FurnitureBox({ furniture }: { furniture: Furniture }) {
  const { width: w, height: h, depth: d } = furniture

  const edges = useMemo<P[]>(() => {
    const c = (x: number, y: number, z: number): P => [x, y, z]
    const [a, b, e, f] = [c(0, 0, 0), c(w, 0, 0), c(w, 0, d), c(0, 0, d)]
    const [a2, b2, e2, f2] = [c(0, h, 0), c(w, h, 0), c(w, h, d), c(0, h, d)]
    // pairs of points = line segments: bottom, top, vertical edges
    return [a, b, b, e, e, f, f, a, a2, b2, b2, e2, e2, f2, f2, a2, a, a2, b, b2, e, e2, f, f2]
  }, [w, h, d])

  return <Line points={edges} segments color={FURNITURE_EDGE_COLOR} lineWidth={2} raycast={() => null} />
}
