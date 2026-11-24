/// <reference types="vitest" />
import path from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { creerApi } from './serveur/api.mjs'
import react from '@vitejs/plugin-react'

// En développement, l'API de stockage tourne dans le serveur Vite (aucun second processus).
// Données dans atelier/donnees/ (ATELIER_DONNEES pour changer), jeton optionnel (ATELIER_JETON).
function pluginStockage(env: Record<string, string>): Plugin {
  return {
    name: 'atelier-stockage',
    apply: 'serve',
    configureServer(server) {
      const api = creerApi({
        dossier: env.ATELIER_DONNEES || path.resolve('donnees'),
        jeton: env.ATELIER_JETON || undefined,
        anthropic: { cle: env.ANTHROPIC_API_KEY || undefined },
      })
      server.middlewares.use((req, res, next) => { void api(req, res, next) })
    },
  }
}

// Le proxy /ollama évite les problèmes de CORS avec l'Ollama local d'Élise (:11434).
// .env (non versionné) + variables d'environnement : ANTHROPIC_API_KEY, ATELIER_JETON, ATELIER_DONNEES.
export default defineConfig(({ mode }) => ({
  plugins: [react(), pluginStockage({ ...loadEnv(mode, process.cwd(), ''), ...process.env } as Record<string, string>)],
  server: {
    port: 5174,
    strictPort: true, // échoue si le port est pris, au lieu de basculer en silence sur un autre
    proxy: {
      '/ollama': {
        target: 'http://localhost:11434',
        changeOrigin: true,
        rewrite: (chemin) => chemin.replace(/^\/ollama/, ''),
      },
    },
  },
  test: { environment: 'node' },
}))
