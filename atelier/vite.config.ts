/// <reference types="vitest" />
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { creerApi } from './serveur/api.mjs'
import react from '@vitejs/plugin-react'

// En développement, l'API de stockage tourne dans le serveur Vite (aucun second processus).
// Données dans atelier/donnees/ (ATELIER_DONNEES pour changer), jeton optionnel (ATELIER_JETON).
function pluginStockage(): Plugin {
  return {
    name: 'atelier-stockage',
    apply: 'serve',
    configureServer(server) {
      const api = creerApi({ dossier: process.env.ATELIER_DONNEES ?? path.resolve('donnees'), jeton: process.env.ATELIER_JETON || undefined })
      server.middlewares.use((req, res, next) => { void api(req, res, next) })
    },
  }
}

// Le proxy /ollama évite les problèmes de CORS avec l'Ollama local d'Élise (:11434).
export default defineConfig({
  plugins: [react(), pluginStockage()],
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
