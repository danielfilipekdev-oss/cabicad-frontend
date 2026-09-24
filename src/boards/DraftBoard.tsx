import { useEffect, useMemo } from 'react'
import { Edges } from '@react-three/drei'
import { boardShape, boardTransform } from './boardGeometry.ts'
import { extrude } from './extrude.ts'
import type { Board } from './board.ts'
import DimensionLabels from './DimensionLabels.tsx'

export const DRAFT_COLOR = '#00c853'
const noRaycast = () => null

/**
 * Preview of a board before it is added – the single board of the "Dodaj płytę" form (in the centre of
 * the furniture, with its dimensions) or a hovered carcass board (where its joints will put it): a green
 * wireframe of its outline (with the cut-outs) and a faint green fill. Not clickable – it never gets in the way of the scene.
 */
export default function DraftBoard({ board, showDimensions = true }: { board: Board; showDimensions?: boolean }) {
  const shape = useMemo(() => boardShape(board), [board])
  const key = JSON.stringify(shape.outer)
  const geometry = useMemo(() => extrude(shape.outer, shape.thickness), [key, shape.thickness])
  useEffect(() => () => geometry.dispose(), [geometry])
  const transform = boardTransform(board)
  return (
    <group>
      <group position={transform.position} rotation={transform.rotation}>
        <mesh geometry={geometry} raycast={noRaycast} renderOrder={2} userData={{ draft: true }}>
          <meshBasicMaterial color={DRAFT_COLOR} transparent opacity={0.12} depthWrite={false} />
          <Edges color={DRAFT_COLOR} lineWidth={2} />
        </mesh>
        {/* the same outline once more, dashed and on top, so the preview is visible inside other boards */}
        <mesh geometry={geometry} raycast={noRaycast} renderOrder={3}>
          <meshBasicMaterial visible={false} />
          <Edges color={DRAFT_COLOR} lineWidth={1} depthTest={false} transparent opacity={0.5} />
        </mesh>
      </group>
      {showDimensions && <DimensionLabels board={board} />}
    </group>
  )
}
