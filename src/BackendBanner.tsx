import { useEffect, useState } from 'react'
import { fetchHello } from './api/hello.ts'

type State =
  | { status: 'loading' }
  | { status: 'ok'; message: string }
  | { status: 'error'; error: string }

/** Top-of-screen banner showing the message returned by the backend (GET /api/hello). */
export default function BackendBanner() {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    fetchHello(controller.signal)
      .then((res) => setState({ status: 'ok', message: res.message }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', error: err instanceof Error ? err.message : String(err) })
      })
    return () => controller.abort()
  }, [])

  return (
    <div className={`backend-banner backend-banner--${state.status}`} role="status" data-testid="backend-banner">
      {state.status === 'loading' && 'Łączenie z backendem…'}
      {state.status === 'ok' && state.message}
      {state.status === 'error' && `Brak połączenia z backendem (${state.error})`}
    </div>
  )
}
