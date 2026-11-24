/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Le proxy /ollama évite les problèmes de CORS avec l'Ollama local d'Élise (:11434).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/ollama': {
        target: 'http://localhost:11434',
        changeOrigin: true,
        rewrite: (chemin) => chemin.replace(/^\/ollama/, ''),
      },
    },
  },
  test: { environment: 'node' },
})
