import { useSyncExternalStore } from 'react'
import { getCatalogState, subscribeCatalog } from './boardCatalog.ts'

/** Current board catalog + loading status; re-renders when the catalog is loaded from the backend. */
export function useBoardCatalog() {
  return useSyncExternalStore(subscribeCatalog, getCatalogState)
}
