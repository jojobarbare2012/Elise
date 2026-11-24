// Serveur autonome : sert l'appli compilée (dist/) + l'API de stockage. Lancer avec `npm start`.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { creerApi } from './api.mjs'

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.ATELIER_PORT ?? 5175)
const hote = process.env.ATELIER_HOTE ?? '127.0.0.1'
const jeton = process.env.ATELIER_JETON || undefined
const dossier = process.env.ATELIER_DONNEES ?? path.join(racine, 'donnees')
const ollama = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434'

if (!['127.0.0.1', 'localhost', '::1'].includes(hote) && !jeton) {
  console.error("[ATELIER] Écoute hors de cette machine sans ATELIER_JETON : refusé. Définis un jeton (et passe par un VPN).")
  process.exit(1)
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.ico': 'image/x-icon' }
const api = creerApi({ dossier, jeton, ollama })

http.createServer((req, res) => {
  api(req, res, async () => {
    const url = new URL(req.url ?? '/', 'http://x')
    let fichier = path.join(racine, 'dist', decodeURIComponent(url.pathname))
    if (!fichier.startsWith(path.join(racine, 'dist'))) { res.writeHead(403).end(); return }
    try {
      let contenu
      try { contenu = await readFile(fichier) } catch { fichier = path.join(racine, 'dist', 'index.html'); contenu = await readFile(fichier) }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(fichier)] ?? 'application/octet-stream' })
      res.end(contenu)
    } catch {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end("Appli non compilée : lance `npm start` (ou `npm run build`).")
    }
  })
}).listen(port, hote, () => {
  console.log(`[ATELIER] http://${hote === '0.0.0.0' ? 'localhost' : hote}:${port}  (données : ${path.resolve(dossier)})`)
  console.log(`[ATELIER] ${jeton ? 'jeton requis' : 'accès local uniquement'}`)
})
