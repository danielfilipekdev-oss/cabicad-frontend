import { useEffect, useState } from 'react'
import { RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture } from 'three'
import { boardTextureUrl, type BoardModel } from './boardCatalog.ts'
import type { GrainDirection } from './board.ts'

/**
 * Face textures of the board models made from the manufacturers' images (loaded through the backend
 * proxy – same origin, so WebGL may use them). Each image is loaded once; boards use clones with their
 * own scale and rotation.
 *
 * The board faces have UVs in millimetres in the board's 2D frame (U = along the width, edges A / C;
 * V = along the height, edges B / D – see `boardGeometry.ts`). The grain / pattern of a catalog image
 * runs along its HEIGHT (image V), so:
 *   grain 'AC' (from edge A to edge C = along the board height) → the image as it is,
 *   grain 'BD' (from edge B to edge D = along the board width)  → the image turned by 90°.
 * A model whose grain does not matter is always laid as it is.
 */

/** Fallback real size [mm] of an image without `textureSize`. */
const DEFAULT_TEXTURE_SIZE = { width: 600, height: 900 }

const loaded = new Map<string, Texture>()
const pending = new Map<string, Promise<Texture | null>>()

/** Loads (once) a texture image by URL; null when loading fails. Shared by board and edge band textures. */
export function loadTextureUrl(url: string): Promise<Texture | null> {
  const done = loaded.get(url)
  if (done) return Promise.resolve(done)
  let p = pending.get(url)
  if (!p) {
    p = new TextureLoader()
      .loadAsync(url)
      .then((t) => {
        t.colorSpace = SRGBColorSpace
        t.wrapS = t.wrapT = RepeatWrapping
        t.anisotropy = 8
        loaded.set(url, t)
        return t
      })
      .catch((err: unknown) => {
        console.warn(`[CabiCAD] Nie udało się wczytać tekstury ${url}:`, err)
        return null
      })
    pending.set(url, p)
  }
  return p
}

/** Loads (once) the base texture of a model; null for a model without an image or when loading fails. */
export const loadBoardTexture = (model: BoardModel): Promise<Texture | null> => {
  const url = boardTextureUrl(model)
  return url ? loadTextureUrl(url) : Promise.resolve(null)
}

/** Loaded textures of the given URLs (a URL is missing from the map until its image is loaded / if it fails). */
export function useTextures(urls: string[]): Map<string, Texture> {
  const key = [...new Set(urls)].sort().join('\n')
  const [, setVersion] = useState(0)
  useEffect(() => {
    let alive = true
    for (const url of key ? key.split('\n') : []) {
      if (!loaded.has(url)) loadTextureUrl(url).then((t) => alive && t && setVersion((v) => v + 1))
    }
    return () => {
      alive = false
    }
  }, [key])
  const out = new Map<string, Texture>()
  for (const url of key ? key.split('\n') : []) {
    const t = loaded.get(url)
    if (t) out.set(url, t)
  }
  return out
}

/** Base texture of the model (null until it is loaded / when it has no image). */
export function useBoardTexture(model: BoardModel): Texture | null {
  const url = boardTextureUrl(model)
  return useTextures(url ? [url] : []).get(url ?? '') ?? null
}

/** Rotation of the image on the board face for the grain direction (see the module comment). */
export const textureRotation = (model: BoardModel, grain: GrainDirection): number =>
  model.grainMatters && grain === 'BD' ? Math.PI / 2 : 0

/** Texture of the large faces of a board of the model, scaled to the real size and turned by the grain. */
export function boardFaceTexture(base: Texture, model: BoardModel, grain: GrainDirection): Texture {
  const size = model.textureSize ?? DEFAULT_TEXTURE_SIZE
  const t = base.clone()
  // UVs are in mm; the uv transform is scale ∘ rotation, so the image axes keep their own scale
  t.repeat.set(1 / size.width, 1 / size.height)
  t.rotation = textureRotation(model, grain)
  t.needsUpdate = true
  return t
}

/**
 * Texture of an edge band strip. The strip is an extruded polygon: its outer face gets UVs (along the
 * edge [mm], across = the board thickness [mm]) from the extrusion, so the decor image – whose pattern
 * runs along its height – is turned by 90° to run ALONG the edge.
 */
export function edgeBandTexture(base: Texture, size: { width: number; height: number } | null): Texture {
  const s = size ?? DEFAULT_TEXTURE_SIZE
  const t = base.clone()
  t.repeat.set(1 / s.width, 1 / s.height)
  t.rotation = Math.PI / 2
  t.needsUpdate = true
  return t
}
