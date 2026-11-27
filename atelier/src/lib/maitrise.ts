import type { Carte, Page, Qcm } from './types'
import { estDue } from './sm2'

export const SEUIL_MAITRISE_JOURS = 21 // une carte revue avec un intervalle de 3 semaines est considérée maîtrisée

export interface MaitrisePage {
  page: Page
  cartes: number
  maitrisees: number
  dues: number
  oubliees: number
  qcmScore: number | null // moyenne de la dernière tentative de chaque QCM (0 à 1)
  qcmTentatives: number
  /** Indicateur global 0..1 : moyenne des signaux disponibles. */
  niveau: number | null
}

/** Maîtrise de chaque page (chapitre) qui possède des cartes ou des QCM qui lui sont rattachés directement. */
export function maitriseParPage(pages: Page[], cartes: Carte[], qcms: Qcm[], maintenant = Date.now()): MaitrisePage[] {
  const resultat: MaitrisePage[] = []
  for (const page of pages) {
    const cs = cartes.filter((c) => c.pageId === page.id)
    const qs = qcms.filter((q) => q.pageId === page.id && q.tentatives.length)
    if (!cs.length && !qs.length) continue
    const maitrisees = cs.filter((c) => c.intervalle >= SEUIL_MAITRISE_JOURS).length
    const scores = qs.map((q) => { const t = q.tentatives[q.tentatives.length - 1]; return t.total ? t.score / t.total : 0 })
    const qcmScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
    const signaux: number[] = []
    if (cs.length) signaux.push(maitrisees / cs.length)
    if (qcmScore !== null) signaux.push(qcmScore)
    resultat.push({
      page,
      cartes: cs.length,
      maitrisees,
      dues: cs.filter((c) => estDue(c, maintenant)).length,
      oubliees: cs.filter((c) => (c.oublis ?? 0) > 0).length,
      qcmScore,
      qcmTentatives: qs.reduce((n, q) => n + q.tentatives.length, 0),
      niveau: signaux.length ? signaux.reduce((a, b) => a + b, 0) / signaux.length : null,
    })
  }
  // Les plus faibles d'abord : c'est là qu'il faut travailler.
  return resultat.sort((a, b) => (a.niveau ?? 0) - (b.niveau ?? 0))
}

export interface PointFaible {
  notion: string
  reponse: string
  source: 'qcm' | 'carte'
}

/**
 * Notions à retravailler dans une portée (ensemble de pages) : questions ratées lors des 3 dernières tentatives
 * de chaque QCM, et cartes oubliées ou à facilité basse. Dédoublonné, au plus `max`.
 */
export function pointsFaibles(cartes: Carte[], qcms: Qcm[], portee: Set<string> | null, max = 25): PointFaible[] {
  const dans = (id: string | null) => portee === null || (id !== null && portee.has(id))
  const vus = new Set<string>()
  const sortie: PointFaible[] = []
  const ajouter = (p: PointFaible) => {
    const cle = p.notion.trim().toLowerCase()
    if (!cle || vus.has(cle)) return
    vus.add(cle)
    sortie.push(p)
  }
  for (const q of qcms.filter((x) => dans(x.pageId))) {
    for (const t of q.tentatives.slice(-3)) {
      for (const k of t.erreurs) {
        const question = q.questions[k]
        if (question) ajouter({ notion: question.enonce, reponse: question.choix[question.bonne] ?? '', source: 'qcm' })
      }
    }
  }
  cartes
    .filter((c) => dans(c.pageId) && ((c.oublis ?? 0) > 0 || c.facilite < 2.3))
    .sort((a, b) => (b.oublis ?? 0) - (a.oublis ?? 0) || a.facilite - b.facilite)
    .forEach((c) => ajouter({ notion: c.recto, reponse: c.verso, source: 'carte' }))
  return sortie.slice(0, max)
}
