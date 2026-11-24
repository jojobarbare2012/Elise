import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import http from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { creerApi } from './api.mjs'

// Fausse API Anthropic : enregistre la requête reçue et renvoie la réponse programmée.
let recu, reponseProgrammee, fausse, urlFausse, atelier, urlAtelier, dossier
const message = (contenu, stop = 'end_turn') => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: stop, stop_sequence: null,
  content: [{ type: 'text', text: contenu }], usage: { input_tokens: 10, output_tokens: 10 },
})

beforeAll(async () => {
  fausse = http.createServer((req, res) => {
    let corps = ''
    req.on('data', (c) => (corps += c))
    req.on('end', () => {
      recu = { url: req.url, entetes: req.headers, corps: JSON.parse(corps || '{}') }
      const { statut, json } = reponseProgrammee
      res.writeHead(statut, { 'Content-Type': 'application/json', 'x-should-retry': 'false' })
      res.end(JSON.stringify(json))
    })
  })
  await new Promise((r) => fausse.listen(0, '127.0.0.1', r))
  urlFausse = `http://127.0.0.1:${fausse.address().port}`
  dossier = await mkdtemp(path.join(tmpdir(), 'atelier-ia-'))
  const api = creerApi({ dossier, anthropic: { cle: 'sk-test-secret', baseURL: urlFausse } })
  atelier = http.createServer((req, res) => api(req, res))
  await new Promise((r) => atelier.listen(0, '127.0.0.1', r))
  urlAtelier = `http://127.0.0.1:${atelier.address().port}`
})
afterAll(async () => {
  await new Promise((r) => fausse.close(r)); await new Promise((r) => atelier.close(r))
  await rm(dossier, { recursive: true, force: true })
})
beforeEach(() => { recu = null })

const demander = (corps) => fetch(urlAtelier + '/api/ia/json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) })
const SCHEMA = { type: 'object', properties: { questions: { type: 'array', items: { type: 'string' } } }, required: ['questions'], additionalProperties: false }
const base = { modele: 'claude-opus-5-5', systeme: 'Tu es prof.', utilisateur: 'Cours…', schema: SCHEMA, effort: 'high' }

describe('relais Claude', () => {
  it('envoie une requête conforme et renvoie le JSON structuré', async () => {
    reponseProgrammee = { statut: 200, json: message('{"questions":["a","b"]}') }
    const r = await demander(base)
    expect(r.status).toBe(200)
    expect((await r.json()).donnees).toEqual({ questions: ['a', 'b'] })
    expect(recu.url).toMatch(/^\/v1\/messages/)
    // Le SDK transmet la clé (x-api-key ou Authorization: Bearer selon sa version)
    expect(recu.entetes['x-api-key'] ?? recu.entetes.authorization?.replace(/^Bearer /, '')).toBe('sk-test-secret')
    expect(recu.entetes['anthropic-beta']).toContain('server-side-fallback-2026-07-01')
    expect(recu.corps).toMatchObject({
      model: 'claude-opus-5-5', max_tokens: 16000, fallbacks: 'default', system: 'Tu es prof.',
      output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: 'Cours…' }],
    })
    // Interdits sur Opus 5.5 : désactiver la réflexion, température, outil forcé
    expect(recu.corps.thinking).toBeUndefined()
    expect(recu.corps.temperature).toBeUndefined()
    expect(recu.corps.tool_choice).toBeUndefined()
  })
  it('la clé n’est jamais renvoyée au navigateur', async () => {
    const etat = await (await fetch(urlAtelier + '/api/ia/etat')).text()
    expect(etat).toBe('{"cle":true}')
    expect(etat).not.toContain('sk-test')
  })
  it('refus du modèle -> 422 avec message', async () => {
    reponseProgrammee = { statut: 200, json: message('', 'refusal') }
    const r = await demander(base)
    expect(r.status).toBe(422)
  })
  it('réponse tronquée -> 502 explicite', async () => {
    reponseProgrammee = { statut: 200, json: message('{"questions":["a', 'max_tokens') }
    const r = await demander(base)
    expect(r.status).toBe(502)
    expect((await r.json()).erreur).toMatch(/tronquée/)
  })
  it('clé refusée -> message clair (sans fuite de clé)', async () => {
    reponseProgrammee = { statut: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }
    const r = await demander(base)
    const corps = await r.json()
    expect(r.status).toBe(502)
    expect(corps.erreur).toMatch(/Clé API/)
    expect(JSON.stringify(corps)).not.toContain('sk-test')
  })
  it('limite atteinte -> 429', async () => {
    reponseProgrammee = { statut: 429, json: { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } } }
    expect((await demander(base)).status).toBe(429)
  })
  it('rejette un modèle ou une demande invalide sans appeler l’API', async () => {
    expect((await demander({ ...base, modele: 'gpt-4' })).status).toBe(400)
    expect((await demander({ ...base, schema: 'non' })).status).toBe(400)
    expect(recu).toBeNull()
  })
  it('effort inconnu -> high par défaut', async () => {
    reponseProgrammee = { statut: 200, json: message('{"questions":[]}') }
    await demander({ ...base, effort: 'turbo' })
    expect(recu.corps.output_config.effort).toBe('high')
  })
})
