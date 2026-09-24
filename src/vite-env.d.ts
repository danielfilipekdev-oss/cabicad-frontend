/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of cabicad-backend used by the browser. Empty (default) = same origin, /api goes through the Vite proxy. */
  readonly VITE_API_BASE_URL?: string
  /** Backend address used by the Vite dev/preview proxy (default http://localhost:8080). */
  readonly VITE_BACKEND_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
