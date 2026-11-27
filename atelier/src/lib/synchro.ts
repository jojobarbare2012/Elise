import { create } from 'zustand'
import { useStore } from './store'

/** Les données qui vont sur le disque. Disposition, espace de travail et vue restent propres à chaque appareil. */
export const CLES_DONNEES = ['pages', 'cartes', 'qcms', 'taches', 'examens', 'sessions', 'depensesIA', 'reglages'] as const
type Cle = (typeof CLES_DONNEES)[number]

export type Statut = 'init' | 'ok' | 'envoi' | 'hors-ligne' | 'conflit' | 'jeton' | 'local'
export type Decision = 'rien' | 'pousser' | 'adopter' | 'conflit'

/**
 * Que faire en comparant le disque et cet appareil ?
 * - disque vide : on y envoie ce qu'on a ;
 * - même révision : rien (ou envoi si on a des modifications en attente) ;
 * - révision différente : on adopte le disque, sauf si on a des modifications non envoyées (conflit).
 *   Un appareil jamais synchronisé mais déjà rempli est traité comme ayant des modifications.
 */
export function decider(p: {
  disqueVide: boolean
  revisionDisque: number
  revisionConnue: number
  sale: boolean
  localVierge: boolean
}): Decision {
  if (p.disqueVide) return 'pousser'
  const modifie = p.sale || (p.revisionConnue === 0 && !p.localVierge)
  if (p.revisionDisque === p.revisionConnue) return modifie ? 'pousser' : 'rien'
  return modifie ? 'conflit' : 'adopter'
}

interface EtatSynchro {
  statut: Statut
  dossier: string | null
  derniere: number | null // dernier envoi ou réception réussi
  jetonRequis: boolean
}
export const useSynchro = create<EtatSynchro>(() => ({ statut: 'init', dossier: null, derniere: null, jetonRequis: false }))
const maj = (p: Partial<EtatSynchro>) => useSynchro.setState(p)

// ---------- métadonnées locales (révision connue + modifications non envoyées) ----------
const CLE_META = 'atelier-synchro'
const CLE_JETON = 'atelier-jeton'
interface Meta { revision: number; sale: boolean }
const lireMeta = (): Meta => {
  try { return { revision: 0, sale: false, ...JSON.parse(localStorage.getItem(CLE_META) ?? '{}') } } catch { return { revision: 0, sale: false } }
}
const ecrireMeta = (m: Meta) => { try { localStorage.setItem(CLE_META, JSON.stringify(m)) } catch { /* ignoré */ } }
let meta: Meta = { revision: 0, sale: false }

export const lireJeton = () => { try { return localStorage.getItem(CLE_JETON) ?? '' } catch { return '' } }
export function definirJeton(jeton: string) {
  try { localStorage.setItem(CLE_JETON, jeton.trim()) } catch { /* ignoré */ }
  void reconcilier()
}

// ---------- accès au serveur ----------
class ErreurReseau extends Error {}
class ErreurAcces extends Error { constructor(public statut: number) { super('accès') } }

async function appel<T>(methode: 'GET' | 'PUT', chemin: string, corps?: unknown): Promise<{ statut: number; json: T }> {
  const entetes: Record<string, string> = {}
  const jeton = lireJeton()
  if (jeton) entetes.Authorization = `Bearer ${jeton}`
  if (corps !== undefined) entetes['Content-Type'] = 'application/json'
  let r: Response
  try {
    r = await fetch(chemin, { method: methode, headers: entetes, body: corps === undefined ? undefined : JSON.stringify(corps), cache: 'no-store' })
  } catch {
    throw new ErreurReseau()
  }
  if (r.status === 401) throw new ErreurAcces(401)
  const type = r.headers.get('content-type') ?? ''
  if (!type.includes('application/json')) throw new ErreurAcces(404) // pas de serveur d'Atelier (hébergement statique)
  return { statut: r.status, json: (await r.json()) as T }
}

type Donnees = Pick<ReturnType<typeof useStore.getState>, Cle>
const extraire = (): Donnees => {
  const s = useStore.getState()
  return Object.fromEntries(CLES_DONNEES.map((k) => [k, s[k]])) as Donnees
}
const localVierge = () => {
  const s = useStore.getState()
  return s.pages.length <= 1 && !s.cartes.length && !s.qcms.length && !s.taches.length && !s.examens.length && !s.sessions.length
}

let adoption = false
function adopter(donnees: Partial<Donnees>) {
  adoption = true
  const defauts = useStore.getState().reglages
  useStore.setState({
    pages: donnees.pages ?? [],
    cartes: donnees.cartes ?? [],
    qcms: donnees.qcms ?? [],
    taches: donnees.taches ?? [],
    examens: donnees.examens ?? [],
    sessions: donnees.sessions ?? [],
    depensesIA: donnees.depensesIA ?? [],
    reglages: { ...defauts, ...(donnees.reglages ?? {}) },
  })
  adoption = false
}

function traiterErreur(e: unknown) {
  if (e instanceof ErreurReseau) maj({ statut: 'hors-ligne' })
  else if (e instanceof ErreurAcces && e.statut === 401) maj({ statut: 'jeton', jetonRequis: true })
  else if (e instanceof ErreurAcces) maj({ statut: 'local' })
  else maj({ statut: 'hors-ligne' })
}

// ---------- envoi / réception ----------
let versionLocale = 0
let enCours = false

async function pousser(baseForcee?: number) {
  if (enCours) return
  enCours = true
  maj({ statut: 'envoi' })
  const version = versionLocale
  try {
    const { statut, json } = await appel<{ revision: number }>('PUT', '/api/etat', { base: baseForcee ?? meta.revision, donnees: extraire() })
    if (statut === 409) { maj({ statut: 'conflit' }); return }
    meta = { revision: json.revision, sale: versionLocale !== version }
    ecrireMeta(meta)
    maj({ statut: 'ok', derniere: Date.now() })
    if (meta.sale) planifier()
  } catch (e) {
    traiterErreur(e)
  } finally {
    enCours = false
  }
}

async function recevoir(): Promise<boolean> {
  const { json } = await appel<{ revision: number; donnees: Partial<Donnees> | null; dossier: string }>('GET', '/api/etat')
  if (!json.donnees) return false
  adopter(json.donnees)
  meta = { revision: json.revision, sale: false }
  ecrireMeta(meta)
  maj({ statut: 'ok', derniere: Date.now(), dossier: json.dossier })
  return true
}

/** Compare avec le disque et agit selon `decider`. */
export async function reconcilier() {
  if (enCours) return
  try {
    const { json: info } = await appel<{ revision: number; vide: boolean; dossier: string }>('GET', '/api/revision')
    maj({ dossier: info.dossier, jetonRequis: false })
    const decision = decider({
      disqueVide: info.vide, revisionDisque: info.revision, revisionConnue: meta.revision,
      sale: meta.sale, localVierge: localVierge(),
    })
    if (decision === 'conflit') return maj({ statut: 'conflit' })
    if (decision === 'adopter') return void (await recevoir())
    if (decision === 'pousser') return void (await pousser(info.vide ? 0 : info.revision))
    maj({ statut: 'ok' })
  } catch (e) {
    traiterErreur(e)
  }
}

let minuteur: number | undefined
function planifier() {
  window.clearTimeout(minuteur)
  minuteur = window.setTimeout(() => {
    if (useSynchro.getState().statut === 'conflit') return
    void pousser()
  }, 800)
}

// ---------- résolution d'un conflit ----------
/** Garder cette version : elle écrase celle du disque (qui reste dans les sauvegardes quotidiennes). */
export async function garderLocal() {
  try {
    const { json } = await appel<{ revision: number }>('GET', '/api/revision')
    await pousser(json.revision)
  } catch (e) { traiterErreur(e) }
}
/** Prendre la version du disque : remplace cet appareil. */
export async function prendreDisque() {
  try { await recevoir() } catch (e) { traiterErreur(e) }
}

// ---------- démarrage ----------
let demarre = false
export function demarrerSynchro() {
  if (demarre) return
  demarre = true
  meta = lireMeta()
  useStore.subscribe((s, prec) => {
    if (adoption) return
    if (!CLES_DONNEES.some((k) => s[k] !== prec[k])) return
    versionLocale++
    meta = { ...meta, sale: true }
    ecrireMeta(meta)
    const st = useSynchro.getState().statut
    if (st !== 'conflit' && st !== 'jeton' && st !== 'local') planifier()
  })
  void reconcilier()
  window.setInterval(() => { if (document.visibilityState === 'visible') void reconcilier() }, 15_000)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void reconcilier() })
  window.addEventListener('online', () => void reconcilier())
}
