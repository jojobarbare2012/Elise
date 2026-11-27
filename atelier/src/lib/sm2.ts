import type { Carte, EtatRevision, Sens } from './types'

export type Note = 'encore' | 'difficile' | 'bien' | 'facile'

const QUALITE: Record<Note, number> = { encore: 1, difficile: 3, bien: 4, facile: 5 }
const JOUR = 24 * 60 * 60 * 1000
const DIX_MINUTES = 10 * 60 * 1000

export function nouvelleCarte(
  id: string,
  pageId: string | null,
  recto: string,
  verso: string,
  maintenant = Date.now(),
): Carte {
  return { id, pageId, recto, verso, facilite: 2.5, intervalle: 0, repetitions: 0, echeance: maintenant }
}

/** Algorithme SM-2 : renvoie la carte mise à jour après une révision. */
export function reviser(carte: Carte, note: Note, maintenant = Date.now()): Carte {
  const q = QUALITE[note]
  if (q < 3) {
    return { ...carte, repetitions: 0, intervalle: 0, echeance: maintenant + DIX_MINUTES, oublis: (carte.oublis ?? 0) + 1 }
  }
  let intervalle: number
  if (carte.repetitions === 0) intervalle = 1
  else if (carte.repetitions === 1) intervalle = 6
  else intervalle = Math.round(carte.intervalle * carte.facilite)
  if (note === 'difficile') intervalle = Math.max(1, Math.round(intervalle * 0.8))
  if (note === 'facile') intervalle = Math.round(intervalle * 1.3)
  const facilite = Math.max(1.3, carte.facilite + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  return {
    ...carte,
    facilite,
    intervalle,
    repetitions: carte.repetitions + 1,
    echeance: maintenant + intervalle * JOUR,
  }
}

export function estDue(carte: Carte, maintenant = Date.now()): boolean {
  return carte.echeance <= maintenant
}

/** Libellé de l'intervalle prévu pour chaque réponse (affiché sur les boutons). */
export function libelleIntervalle(carte: Carte, note: Note): string {
  const suivant = reviser(carte, note, 0)
  if (suivant.intervalle === 0) return '10 min'
  return suivant.intervalle === 1 ? '1 jour' : `${suivant.intervalle} jours`
}

const ETAT_NEUF: EtatRevision = { facilite: 2.5, intervalle: 0, repetitions: 0, echeance: 0 }

/** La carte vue dans un sens : en sens inverse, on utilise son suivi séparé (neuf = à réviser tout de suite). */
export function selonSens(carte: Carte, sens: Sens): Carte {
  if (sens === 'normal') return carte
  return { ...carte, ...(carte.inverse ?? ETAT_NEUF), recto: carte.verso, verso: carte.recto }
}

/** Note une carte dans un sens donné, sans toucher au suivi de l'autre sens. */
export function reviserSelonSens(carte: Carte, sens: Sens, note: Note, maintenant = Date.now()): Carte {
  if (sens === 'normal') return reviser(carte, note, maintenant)
  const r = reviser(selonSens(carte, 'inverse'), note, maintenant)
  return { ...carte, inverse: { facilite: r.facilite, intervalle: r.intervalle, repetitions: r.repetitions, echeance: r.echeance, oublis: r.oublis } }
}
