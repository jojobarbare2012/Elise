// API HTTP d'Atelier : /api/revision, /api/etat (et /ollama/* en option). Aucune dépendance.
// Privé par défaut : si un jeton est défini il est exigé ; sinon seuls les noms d'hôte locaux sont acceptés.
import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import { creerStockage } from './stockage.mjs'

const LIMITE_CORPS = 64 * 1024 * 1024
const HOTES_LOCAUX = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const COLLECTIONS = ['pages', 'cartes', 'qcms', 'taches', 'examens', 'sessions']

export function donneesValides(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d) || !Array.isArray(d.pages)) return false
  return COLLECTIONS.every((c) => d[c] === undefined || Array.isArray(d[c]))
}

function egal(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

function lireCorps(req) {
  return new Promise((resolve, reject) => {
    let taille = 0
    const morceaux = []
    req.on('data', (c) => {
      taille += c.length
      if (taille > LIMITE_CORPS) { reject(Object.assign(new Error('trop gros'), { statut: 413 })); req.destroy(); return }
      morceaux.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(morceaux).toString('utf8')))
    req.on('error', reject)
  })
}

function repondre(res, statut, corps) {
  const texte = JSON.stringify(corps)
  res.writeHead(statut, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(texte) })
  res.end(texte)
}

/**
 * @param {{ dossier: string, jeton?: string, ollama?: string }} options
 * `ollama` (ex. http://127.0.0.1:11434) active le relais /ollama/* pour les appareils distants.
 */
export function creerApi({ dossier, jeton, ollama }) {
  const stockage = creerStockage(path.resolve(dossier))

  return async function api(req, res, next) {
    const url = new URL(req.url ?? '/', 'http://x')
    const chemin = url.pathname
    const estApi = chemin.startsWith('/api/')
    const estOllama = Boolean(ollama) && chemin.startsWith('/ollama/')
    if (!estApi && !estOllama) return next ? next() : repondre(res, 404, { erreur: 'introuvable' })

    if (jeton) {
      const fourni = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? ''
      if (!egal(fourni, jeton)) return repondre(res, 401, { erreur: 'jeton requis' })
    } else {
      const hote = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase()
      if (!HOTES_LOCAUX.has(hote)) return repondre(res, 403, { erreur: 'hôte refusé' })
    }

    try {
      if (estOllama) return relayerOllama(req, res, ollama, chemin.replace(/^\/ollama/, '') + url.search)

      if (chemin === '/api/revision' && req.method === 'GET') {
        const doc = await stockage.lire()
        return repondre(res, 200, { revision: doc?.revision ?? 0, vide: !doc, dossier: stockage.dossier })
      }
      if (chemin === '/api/etat' && req.method === 'GET') {
        const doc = await stockage.lire()
        return repondre(res, 200, { revision: doc?.revision ?? 0, modifieLe: doc?.modifieLe ?? null, donnees: doc?.donnees ?? null, dossier: stockage.dossier })
      }
      if (chemin === '/api/etat' && req.method === 'PUT') {
        let corps
        try { corps = JSON.parse(await lireCorps(req)) } catch (e) {
          if (e.statut === 413) return repondre(res, 413, { erreur: 'données trop volumineuses' })
          return repondre(res, 400, { erreur: 'JSON invalide' })
        }
        if (!Number.isInteger(corps?.base) || !donneesValides(corps?.donnees)) return repondre(res, 400, { erreur: 'format invalide' })
        const r = await stockage.ecrire(corps.base, corps.donnees)
        return repondre(res, r.conflit ? 409 : 200, { revision: r.revision })
      }
      return repondre(res, 404, { erreur: 'introuvable' })
    } catch (e) {
      console.error('[ATELIER] erreur API :', e)
      return repondre(res, 500, { erreur: 'erreur serveur' })
    }
  }
}

function relayerOllama(req, res, cible, chemin) {
  const dest = new URL(chemin, cible)
  const entetes = { ...req.headers, host: dest.host }
  delete entetes.authorization
  const sortant = http.request(dest, { method: req.method, headers: entetes }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers)
    r.pipe(res)
  })
  sortant.on('error', () => repondre(res, 502, { erreur: 'Ollama injoignable' }))
  req.pipe(sortant)
}
