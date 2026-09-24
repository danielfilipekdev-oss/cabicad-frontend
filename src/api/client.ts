/** Minimal HTTP client for cabicad-backend. All service calls should go through here. */
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    method: 'GET',
    headers: { Accept: 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    throw new ApiError(response.status, `GET ${path} failed: ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as T
}
