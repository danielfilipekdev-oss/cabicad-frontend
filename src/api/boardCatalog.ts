import { apiGet } from './client.ts'
import { setBoardCatalog, setCatalogError, type BoardCatalog } from '../boards/boardCatalog.ts'

/** GET /api/boards/catalog – board types, brands and concrete boards (mockup now, Firebase later). */
export function fetchBoardCatalog(signal?: AbortSignal): Promise<BoardCatalog> {
  return apiGet<BoardCatalog>('/api/boards/catalog', { signal })
}

/** Loads the catalog into the board-model store (`boards/boardCatalog.ts`); on failure the built-in one stays. */
export async function loadBoardCatalog(signal?: AbortSignal): Promise<void> {
  try {
    setBoardCatalog(await fetchBoardCatalog(signal))
  } catch (err) {
    if (signal?.aborted) return
    setCatalogError(err instanceof Error ? err.message : String(err))
  }
}
