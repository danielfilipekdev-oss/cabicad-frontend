import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  // cabicad-backend (Spring Boot) address used by the dev/preview proxy
  const backendUrl = env.VITE_BACKEND_URL || 'http://localhost:8080'
  const apiProxy = {
    // Forward /api/** to cabicad-backend, so the browser talks to one origin (no CORS needed)
    '/api': { target: backendUrl, changeOrigin: true },
  }

  return {
    plugins: [react()],
    build: {
      // three.js is large by nature; keep the warning for really oversized bundles only
      chunkSizeWarningLimit: 1500,
    },
    server: { port: 5173, strictPort: true, proxy: apiProxy },
    preview: { port: 4173, strictPort: true, proxy: apiProxy },
  }
})
