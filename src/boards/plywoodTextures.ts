import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'

/**
 * Procedural textures of a raw furniture board without a veneer (plywood / sklejka):
 *  - face: light birch surface with wood grain,
 *  - edge: visible layers (plies) of the plywood.
 * Generated once on a canvas (no image files needed); every board uses clones with its own `repeat`
 * (clones share the image, so it is uploaded to the GPU only once).
 */

/** Real size [mm] covered by one tile of the face texture (keeps the grain scale independent of board size). */
export const FACE_TILE_MM = 400
/** Real length [mm] covered by one tile of the edge texture along the edge. */
export const EDGE_TILE_MM = 200
/** Approximate thickness of one plywood ply [mm] (18 mm plywood ≈ 13 plies). */
export const PLY_MM = 1.4

/** Deterministic pseudo-random generator, so the texture looks the same on every load. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return { canvas, ctx: canvas.getContext('2d')! }
}

function toTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(canvas)
  t.colorSpace = SRGBColorSpace
  t.wrapS = t.wrapT = RepeatWrapping
  t.anisotropy = 8
  return t
}

/** Birch face: grain lines run along U; they use whole sine periods so the tile repeats seamlessly along U. */
function drawFace(): HTMLCanvasElement {
  const S = 512
  const { canvas, ctx } = makeCanvas(S, S)
  const rand = rng(7)
  ctx.fillStyle = '#e6cfa3'
  ctx.fillRect(0, 0, S, S)
  for (let i = 0; i < 140; i++) {
    const y0 = rand() * S
    const amp = 1 + rand() * 5
    const periods = 1 + Math.floor(rand() * 3)
    const phase = rand() * Math.PI * 2
    const dark = rand() < 0.5
    ctx.strokeStyle = dark ? `rgba(150, 105, 55, ${0.05 + rand() * 0.12})` : `rgba(255, 245, 220, ${0.05 + rand() * 0.1})`
    ctx.lineWidth = 0.6 + rand() * 1.8
    // drawn 3× (y − S, y, y + S) so lines crossing the top / bottom border wrap around too
    for (const dy of [-S, 0, S]) {
      ctx.beginPath()
      for (let x = 0; x <= S; x += 4) {
        const y = y0 + dy + amp * Math.sin((x / S) * Math.PI * 2 * periods + phase)
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }
  return canvas
}

/**
 * Plywood edge: one tile = 2 plies (long-grain ply + slightly darker cross-grain ply) with thin glue lines.
 * `vertical` = plies stacked along U instead of V (for faces whose U axis is the board thickness).
 */
function drawEdge(vertical: boolean): HTMLCanvasElement {
  const L = 256 // along the edge
  const P = 32 // one ply
  const { canvas, ctx } = makeCanvas(vertical ? 2 * P : L, vertical ? L : 2 * P)
  const rand = rng(11)
  // draw in "horizontal" coordinates (x = along the edge, y = across the plies), rotate for vertical
  if (vertical) {
    ctx.translate(2 * P, 0)
    ctx.rotate(Math.PI / 2)
  }
  ctx.fillStyle = '#e8cd9c'
  ctx.fillRect(0, 0, L, P)
  ctx.fillStyle = '#cfa56f'
  ctx.fillRect(0, P, L, P)
  // long grain in the light ply
  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = `rgba(150, 105, 55, ${0.08 + rand() * 0.15})`
    ctx.fillRect(0, 2 + rand() * (P - 4), L, 0.7 + rand())
  }
  // cross grain (fibre ends) in the dark ply
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = `rgba(110, 70, 30, ${0.1 + rand() * 0.2})`
    ctx.fillRect(rand() * L, P + 2 + rand() * (P - 4), 1 + rand() * 2, 1 + rand() * 3)
  }
  // glue lines between the plies
  ctx.fillStyle = 'rgba(90, 60, 30, 0.55)'
  ctx.fillRect(0, 0, L, 1.5)
  ctx.fillRect(0, P - 0.75, L, 1.5)
  ctx.fillRect(0, 2 * P - 1.5, L, 1.5)
  return canvas
}

let cache: { face: CanvasTexture; edgeH: CanvasTexture; edgeV: CanvasTexture } | null = null

/** Shared base textures (created lazily on first use). */
function baseTextures() {
  cache ??= { face: toTexture(drawFace()), edgeH: toTexture(drawEdge(false)), edgeV: toTexture(drawEdge(true)) }
  return cache
}

function withRepeat(base: Texture, u: number, v: number): Texture {
  const t = base.clone()
  t.repeat.set(u, v)
  t.needsUpdate = true
  return t
}

/** Face texture for a face of `uMm` × `vMm` millimetres. */
export function plywoodFaceTexture(uMm: number, vMm: number): Texture {
  return withRepeat(baseTextures().face, uMm / FACE_TILE_MM, vMm / FACE_TILE_MM)
}

/** Odd number of plies for a board thickness (plywood always has an odd number of plies). */
export function plyCount(thicknessMm: number): number {
  const n = Math.max(1, Math.round(thicknessMm / PLY_MM))
  return n % 2 === 1 ? n : n + 1
}

/**
 * Edge texture for an edge face of `uMm` × `vMm` millimetres; `thicknessAlongU` tells which texture axis
 * runs across the board thickness (the plies are stacked along it).
 */
export function plywoodEdgeTexture(uMm: number, vMm: number, thicknessMm: number, thicknessAlongU: boolean): Texture {
  const tiles = plyCount(thicknessMm) / 2 // one tile = 2 plies
  const { edgeH, edgeV } = baseTextures()
  return thicknessAlongU ? withRepeat(edgeV, tiles, vMm / EDGE_TILE_MM) : withRepeat(edgeH, uMm / EDGE_TILE_MM, tiles)
}
