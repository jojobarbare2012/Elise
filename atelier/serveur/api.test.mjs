import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import http from 'node:http'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { creerApi } from './api.mjs'

let dossier, serveur, url
const demarrer = async (options = {}) => {
  dossier = await mkdtemp(path.join(tmpdir(), 'atelier-'))
  const api = creerApi({ dossier, ...options })
  serveur = http.createServer((req, res) => api(req, res))
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${serveur.address().port}`
}
const put = (corps, entetes = {}) => fetch(url + '/api/etat', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...entetes }, body: typeof corps === 'string' ? corps : JSON.stringify(corps) })
const donnees = (n = 1) => ({ pages: Array.from({ length: n }, (_, i) => ({ id: 'p' + i })), cartes: [] })

afterEach(async () => { await new Promise((r) => serveur.close(r)); await rm(dossier, { recursive: true, force: true }) })

describe('API de stockage', () => {
  beforeEach(() => demarrer())

  it('démarre vide puis enregistre avec incrément de révision', async () => {
    expect(await (await fetch(url + '/api/etat')).json()).toMatchObject({ revision: 0, donnees: null })
    const r1 = await put({ base: 0, donnees: donnees() })
    expect(r1.status).toBe(200)
    expect((await r1.json()).revision).toBe(1)
    const lu = await (await fetch(url + '/api/etat')).json()
    expect(lu.revision).toBe(1)
    expect(lu.donnees.pages).toHaveLength(1)
  })

  it('refuse une écriture basée sur une révision périmée (409) sans rien écraser', async () => {
    await put({ base: 0, donnees: donnees(1) })
    const r = await put({ base: 0, donnees: donnees(5) })
    expect(r.status).toBe(409)
    expect((await r.json()).revision).toBe(1)
    expect((await (await fetch(url + '/api/etat')).json()).donnees.pages).toHaveLength(1)
  })

  it('rejette les formats invalides', async () => {
    expect((await put('pas du json')).status).toBe(400)
    expect((await put({ base: 'x', donnees: donnees() })).status).toBe(400)
    expect((await put({ base: 0, donnees: { pages: 'non' } })).status).toBe(400)
    expect((await put({ base: 0, donnees: { pages: [], cartes: 3 } })).status).toBe(400)
  })

  it('écritures concurrentes : une seule gagne, aucune corruption', async () => {
    const rs = await Promise.all([1, 2, 3, 4, 5].map((n) => put({ base: 0, donnees: donnees(n) })))
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1)
    expect(rs.filter((r) => r.status === 409)).toHaveLength(4)
    JSON.parse(await readFile(path.join(dossier, 'atelier.json'), 'utf8'))
  })

  it('crée .bak et une sauvegarde du jour (une seule par jour)', async () => {
    await put({ base: 0, donnees: donnees(1) })
    await put({ base: 1, donnees: donnees(2) })
    await put({ base: 2, donnees: donnees(3) })
    const sauv = await readdir(path.join(dossier, 'sauvegardes'))
    expect(sauv).toHaveLength(1)
    const bak = JSON.parse(await readFile(path.join(dossier, 'atelier.json.bak'), 'utf8'))
    expect(bak.revision).toBe(2)
  })

  it('se rétablit depuis .bak si le fichier principal est corrompu', async () => {
    await put({ base: 0, donnees: donnees(1) })
    await put({ base: 1, donnees: donnees(2) })
    await writeFile(path.join(dossier, 'atelier.json'), '{ corrompu', 'utf8')
    const lu = await (await fetch(url + '/api/etat')).json()
    expect(lu.revision).toBe(1)
  })

  it('refuse un nom d’hôte non local sans jeton (anti DNS-rebinding)', async () => {
    const r = await fetch(url + '/api/etat', { headers: { Host: 'evil.example' } }).catch(() => null)
    // fetch interdit parfois de forcer Host : on teste via http brut
    const statut = await new Promise((resolve) => {
      http.get(url + '/api/etat', { headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode) })
    })
    expect(statut).toBe(403)
    void r
  })
})

describe('jeton', () => {
  beforeEach(() => demarrer({ jeton: 'secret-123' }))
  it('exige le bon jeton', async () => {
    expect((await fetch(url + '/api/etat')).status).toBe(401)
    expect((await fetch(url + '/api/etat', { headers: { Authorization: 'Bearer faux' } })).status).toBe(401)
    expect((await fetch(url + '/api/etat', { headers: { Authorization: 'Bearer secret-123' } })).status).toBe(200)
    expect((await put({ base: 0, donnees: donnees() })).status).toBe(401)
    expect((await put({ base: 0, donnees: donnees() }, { Authorization: 'Bearer secret-123' })).status).toBe(200)
  })
})
