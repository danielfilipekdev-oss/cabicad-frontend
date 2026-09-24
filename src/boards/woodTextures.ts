import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'
import type { Veneer } from './veneers.ts'
import type { GrainDirection } from './board.ts'

/**
 * Procedural wood texture of a wood-like veneer (okleina drewnopodobna): long growth rings (light / dark
 * bands) running along the texture's U axis, gently waving, with fine fibres. Seamless in both
 * directions (every wave has a whole number of periods over the tile). Generated once per veneer on a
 * canvas; boards use clones with their own repeat / rotation.
 *
 * The board faces have UVs in millimetres in the board's 2D frame (U = along the width, edges A / C;
 * V = along the height, edges B / D – see `boardGeometry.ts`), so:
 *   grain 'AC' → the rings run along U (along the width, parallel to edges A and C),
 *   grain 'BD' → the texture is turned by 90° – the rings run along V (parallel to edges B and D).
 */

/** Real size [mm] of one texture tile (along and across the grain). */
export const WOOD_TILE_MM = 600

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const hex = (c: string): [number, number, number] => {
  const n = parseInt(c.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function drawWood(v: Veneer): HTMLCanvasElement {
  const S = 1024
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = S
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(S, S)
  const rand = rng(v.wood!.seed)
  const light = hex(v.wood!.light)
  const base = hex(v.color)
  const dark = hex(v.wood!.dark)
  const TAU = Math.PI * 2
  // slow waves of the rings along the grain (whole periods over the tile → seamless); small amplitude –
  // the rings stay long and nearly straight, like sliced wood
  const waves = Array.from({ length: 4 }, (_, i) => ({ k: 1 + i + Math.floor(rand() * 2), a: (0.3 + rand() * 0.5) / (i + 1), p: rand() * TAU }))
  const rings = 30 + Math.floor(rand() * 10)
  // per-row fibre tone (rows wrap with the tile): fine lines along the grain
  const fibre = Float32Array.from({ length: S }, () => rand() - 0.5)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S
      let w = 0
      for (const { k, a, p } of waves) w += a * Math.sin(TAU * k * u + p + (2 * TAU * y) / S)
      const r = (rings * y) / S + 0.6 * w
      const s = 0.5 + 0.5 * Math.sin(TAU * r)
      const late = Math.pow(s, 6) * 0.8 // narrow, soft dark latewood lines
      const early = 0.5 + 0.5 * Math.sin(TAU * r * 3.0 + 1.3) // finer secondary rings
      const f = fibre[y] * 0.1 + (rand() - 0.5) * 0.04 + (early - 0.5) * 0.06
      const i = (y * S + x) * 4
      for (let c = 0; c < 3; c++) {
        const mid = light[c] + (base[c] - light[c]) * (0.35 + 0.65 * (1 - s))
        const val = mid + (dark[c] - mid) * late + f * 45
        img.data[i + c] = Math.max(0, Math.min(255, val))
      }
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

const cache = new Map<string, CanvasTexture>()

function baseTexture(v: Veneer): CanvasTexture {
  let t = cache.get(v.id)
  if (!t) {
    t = new CanvasTexture(drawWood(v))
    t.colorSpace = SRGBColorSpace
    t.wrapS = t.wrapT = RepeatWrapping
    t.anisotropy = 8
    cache.set(v.id, t)
  }
  return t
}

/** Texture of the large faces of a board with a wood veneer, oriented by the grain direction. */
export function woodFaceTexture(v: Veneer, grain: GrainDirection): Texture {
  const t = baseTexture(v).clone()
  t.repeat.set(1 / WOOD_TILE_MM, 1 / WOOD_TILE_MM)
  t.rotation = grain === 'BD' ? Math.PI / 2 : 0
  t.needsUpdate = true
  return t
}
