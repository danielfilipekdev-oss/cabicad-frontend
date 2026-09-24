import { apiGet } from './client.ts'

export interface HelloResponse {
  message: string
}

/** GET /api/hello – test endpoint verifying frontend ↔ backend integration. */
export function fetchHello(signal?: AbortSignal): Promise<HelloResponse> {
  return apiGet<HelloResponse>('/api/hello', { signal })
}
