import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'

/**
 * Procedural textures of a raw furniture board (the default raw chipboard model) (płyta wiórowa / chipboard):
 * a matte beige surface with fine wood-chip speckles and slightly mottled tone. The edges are a bit
 * lighter and more uniform, like a cut chipboard edge.
 * Generated once on a canvas (no image files needed); every board uses clones with its own `repeat`
 * (clones share the image, so it is uploaded to the GPU only once).
 */

/** Real size [mm] covered by one tile of the face texture (keeps the speckle scale independent of board size). */
export const FACE_TILE_MM = 250
/** Real size [mm] covered by one tile of the edge texture. */
export const EDGE_TILE_MM = 120

/** Deterministic pseudo-random generator, so the texture looks the same on every load. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

interface ChipStyle {
  base: string
  /** Number of soft light / dark blotches (mottled tone). */
  blotches: number
  /** Number of 1–2 px speckles. */
  specks: number
  /** Number of short darker fibres / chips. */
  fibres: number
  seed: number
}

function drawChipboard({ base, blotches, specks, fibres, seed }: ChipStyle): HTMLCanvasElement {
  const S = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = S
  const ctx = canvas.getContext('2d')!
  const rand = rng(seed)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, S, S)

  // every shape is drawn at its position shifted by ±S, so the tile repeats seamlessly
  const wrapped = (x: number, y: number, r: number, draw: (x: number, y: number) => void) => {
    for (const dx of [-S, 0, S]) {
      for (const dy of [-S, 0, S]) {
        const px = x + dx
        const py = y + dy
        if (px + r >= 0 && px - r <= S && py + r >= 0 && py - r <= S) draw(px, py)
      }
    }
  }

  // soft mottling
  for (let i = 0; i < blotches; i++) {
    const r = 30 + rand() * 90
    const light = rand() < 0.5
    const a = 0.02 + rand() * 0.03
    wrapped(rand() * S, rand() * S, r, (x, y) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, light ? `rgba(255, 245, 225, ${a})` : `rgba(140, 105, 65, ${a})`)
      g.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = g
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r)
    })
  }

  // fine speckles (wood chips / dust)
  for (let i = 0; i < specks; i++) {
    const x = Math.floor(rand() * S)
    const y = Math.floor(rand() * S)
    const size = rand() < 0.85 ? 1 : 2
    const t = rand()
    ctx.fillStyle =
      t < 0.55
        ? `rgba(135, 100, 60, ${0.08 + rand() * 0.18})` // darker chip
        : t < 0.9
          ? `rgba(255, 248, 230, ${0.15 + rand() * 0.3})` // light chip
          : `rgba(95, 65, 35, ${0.2 + rand() * 0.25})` // dark dot
    ctx.fillRect(x, y, size, size)
  }

  // short fibres
  for (let i = 0; i < fibres; i++) {
    const len = 2 + rand() * 6
    const ang = rand() * Math.PI
    const color = rand() < 0.7 ? `rgba(110, 75, 40, ${0.15 + rand() * 0.25})` : `rgba(255, 245, 225, ${0.2 + rand() * 0.3})`
    wrapped(rand() * S, rand() * S, len, (x, y) => {
      ctx.strokeStyle = color
      ctx.lineWidth = 0.6 + rand() * 0.8
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len)
      ctx.stroke()
    })
  }
  return canvas
}

function toTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(canvas)
  t.colorSpace = SRGBColorSpace
  t.wrapS = t.wrapT = RepeatWrapping
  t.anisotropy = 8
  return t
}

let cache: { face: CanvasTexture; edge: CanvasTexture } | null = null

/** Shared base textures (created lazily on first use). */
function baseTextures() {
  cache ??= {
    face: toTexture(drawChipboard({ base: '#e6d2b0', blotches: 30, specks: 7000, fibres: 350, seed: 7 })),
    edge: toTexture(drawChipboard({ base: '#eedcbd', blotches: 15, specks: 9000, fibres: 150, seed: 11 })),
  }
  return cache
}

function withRepeat(base: Texture, u: number, v: number): Texture {
  const t = base.clone()
  t.repeat.set(u, v)
  t.needsUpdate = true
  return t
}

/** Texture of a large board face of `uMm` × `vMm` millimetres. */
export function chipboardFaceTexture(uMm: number, vMm: number): Texture {
  return withRepeat(baseTextures().face, uMm / FACE_TILE_MM, vMm / FACE_TILE_MM)
}

/** Texture of a board edge of `uMm` × `vMm` millimetres. */
export function chipboardEdgeTexture(uMm: number, vMm: number): Texture {
  return withRepeat(baseTextures().edge, uMm / EDGE_TILE_MM, vMm / EDGE_TILE_MM)
}
