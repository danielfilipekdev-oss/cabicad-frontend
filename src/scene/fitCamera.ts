import { Box3, MathUtils, PerspectiveCamera, Sphere, Vector3 } from 'three'

/**
 * Computes a camera position that shows the whole `bounds` box, looking at its centre
 * from `direction`. Takes both the vertical and the horizontal field of view into account,
 * so the scene fits regardless of the viewport aspect ratio.
 */
export function computeFitView(
  camera: PerspectiveCamera,
  bounds: Box3,
  direction: Vector3,
  margin = 1.1,
): { position: Vector3; target: Vector3 } {
  const sphere = bounds.getBoundingSphere(new Sphere())
  const vFov = MathUtils.degToRad(camera.fov)
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect)
  const limitingFov = Math.min(vFov, hFov)
  const distance = (sphere.radius * margin) / Math.sin(limitingFov / 2)

  const target = sphere.center.clone()
  const position = target.clone().addScaledVector(direction.clone().normalize(), distance)
  return { position, target }
}
