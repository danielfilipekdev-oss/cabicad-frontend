import { useEffect, useMemo } from 'react'
import { Line } from '@react-three/drei'
import { AdditiveBlending, CanvasTexture, SRGBColorSpace, Vector3 } from 'three'
import { lightDirection, type LightSettings } from './lighting.ts'
import type { Furniture } from '../furniture/furniture.ts'

const noRaycast = () => null

/** Soft round glow (white centre fading to transparent) for the sun's halo sprite. */
function glowTexture(): CanvasTexture {
  const S = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = S
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(255, 236, 170, 1)')
  g.addColorStop(0.25, 'rgba(255, 200, 80, 0.55)')
  g.addColorStop(0.6, 'rgba(255, 180, 40, 0.15)')
  g.addColorStop(1, 'rgba(255, 170, 30, 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  const t = new CanvasTexture(canvas)
  t.colorSpace = SRGBColorSpace
  return t
}

interface Props {
  furniture: Furniture
  light: LightSettings
  /** Draw the dashed ray from the sun to the furniture ("Pokaż promienie" in the "Światło" panel, off by default). */
  showRay?: boolean
}

/**
 * Imitation of the sun in the scene – shows where the key light (`KeyLight`, "Światło" widget) comes
 * from: a glowing ball on the light direction, above / around the furniture at a distance that grows
 * with its size, and – with "Pokaż promienie" – a dashed ray to the furniture centre. Only a
 * marker: it casts no shadow and cannot be clicked.
 */
export default function SunMarker({ furniture, light, showRay = false }: Props) {
  const { width: W, height: H, depth: D } = furniture
  const diag = Math.hypot(W, H, D)
  const center = useMemo(() => new Vector3(W / 2, H / 2, D / 2), [W, H, D])
  // far away from the furniture (like a real sun), the ball grows with the distance so it stays visible
  const distance = diag * 1.6 + 800
  const pos = useMemo(
    () => center.clone().addScaledVector(lightDirection(light), distance),
    [center, distance, light],
  )
  const radius = distance * 0.03
  const texture = useMemo(glowTexture, [])
  useEffect(() => () => texture.dispose(), [texture])
  // the dashed ray stops at the sun's rim and a bit before the furniture centre
  const rayFrom = useMemo(() => pos.clone().lerp(center, radius * 1.6 / pos.distanceTo(center)), [pos, center, radius])
  const rayTo = useMemo(() => center.clone().lerp(pos, 0.25), [center, pos])

  return (
    <group>
      <mesh position={pos} raycast={noRaycast} renderOrder={5}>
        <sphereGeometry args={[radius, 32, 16]} />
        <meshBasicMaterial color="#FFC21A" toneMapped={false} />
      </mesh>
      <sprite position={pos} scale={[radius * 7, radius * 7, 1]} raycast={noRaycast} renderOrder={4}>
        <spriteMaterial map={texture} blending={AdditiveBlending} depthWrite={false} transparent toneMapped={false} />
      </sprite>
      {showRay && (
        <Line
          points={[rayFrom, rayTo]}
          color="#E39A00"
          lineWidth={2}
          dashed
          dashSize={radius * 0.9}
          gapSize={radius * 0.6}
          transparent
          opacity={0.8}
          raycast={noRaycast}
        />
      )}
    </group>
  )
}
