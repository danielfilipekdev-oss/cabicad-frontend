import { useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import type { BoardHinge } from '../layout/hinges.ts'

/**
 * Turns its content (a board with a hinge joint – `layout/hinges.ts`) around the hinge axis when `open` – animated towards the opening
 * angle / back to closed. Render only: the board itself (and its joints) stays where the layout put it.
 */
export default function HingedGroup({ hinge, open, children }: { hinge: BoardHinge; open: boolean; children: ReactNode }) {
  const turn = useRef<Group>(null)
  const angle = useRef(0)
  useFrame((_, dt) => {
    const target = open ? hinge.angle : 0
    const diff = target - angle.current
    if (Math.abs(diff) < 1e-4) {
      angle.current = target
    } else {
      angle.current += diff * Math.min(1, dt * 6)
    }
    if (turn.current) {
      turn.current.rotation.x = hinge.axis === 'x' ? angle.current : 0
      turn.current.rotation.y = hinge.axis === 'y' ? angle.current : 0
      turn.current.rotation.z = hinge.axis === 'z' ? angle.current : 0
    }
  })
  const [px, py, pz] = hinge.pivot
  return (
    <group position={hinge.pivot}>
      <group ref={turn}>
        <group position={[-px, -py, -pz]}>{children}</group>
      </group>
    </group>
  )
}
