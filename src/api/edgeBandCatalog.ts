import { apiGet } from './client.ts'
import { setBandCatalogError, setEdgeBandCatalog, type EdgeBandCatalog } from '../boards/edgeBandCatalog.ts'

/** GET /api/edge-bands/catalog – band types, brands and concrete edge bands (mockup now, Firebase later). */
export function fetchEdgeBandCatalog(signal?: AbortSignal): Promise<EdgeBandCatalog> {
  return apiGet<EdgeBandCatalog>('/api/edge-bands/catalog', { signal })
}

/** Loads the band catalog into its store (`boards/edgeBandCatalog.ts`); on failure it stays empty. */
export async function loadEdgeBandCatalog(signal?: AbortSignal): Promise<void> {
  try {
    setEdgeBandCatalog(await fetchEdgeBandCatalog(signal))
  } catch (err) {
    if (signal?.aborted) return
    setBandCatalogError(err instanceof Error ? err.message : String(err))
  }
}
