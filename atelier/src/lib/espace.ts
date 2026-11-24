import type { Pane, TypePane } from './types'

export const MAX_PANES = 4
export const POIDS_MIN = 0.14 // part minimale d'un panneau (fraction de la largeur)

export const TYPES_PANE: Record<TypePane, { titre: string; icone: string }> = {
  page: { titre: 'Page', icone: 'page' },
  cartes: { titre: 'Cartes', icone: 'cartes' },
  qcm: { titre: 'QCM', icone: 'qcm' },
  taches: { titre: 'Tâches', icone: 'taches' },
  minuteur: { titre: 'Minuteur', icone: 'planning' },
  planning: { titre: 'Planning', icone: 'calendrier' },
  accueil: { titre: 'Tableau de bord', icone: 'accueil' },
}

/** Ramène des poids quelconques à une somme de 1. */
export function normaliser(poids: number[]): number[] {
  const somme = poids.reduce((a, b) => a + b, 0)
  return somme > 0 ? poids.map((p) => p / somme) : poids.map(() => 1 / Math.max(1, poids.length))
}

/** Déplace le séparateur `i` (entre les panneaux i et i+1) de `delta` (fraction de largeur). */
export function redimensionner(poids: number[], i: number, delta: number, min = POIDS_MIN): number[] {
  if (i < 0 || i >= poids.length - 1) return poids
  const p = normaliser(poids)
  const total = p[i] + p[i + 1]
  const gauche = Math.min(total - min, Math.max(min, p[i] + delta))
  const resultat = [...p]
  resultat[i] = gauche
  resultat[i + 1] = total - gauche
  return resultat
}

/** Ajoute un panneau qui prend sa place en réduisant les autres proportionnellement. */
export function avecNouveau(panes: Pane[], nouveau: Omit<Pane, 'poids'>): Pane[] {
  if (panes.length >= MAX_PANES) return panes
  const part = 1 / (panes.length + 1)
  const reduits = panes.map((p) => ({ ...p, poids: p.poids * (1 - part) }))
  return [...reduits, { ...nouveau, poids: part }]
}

/** Retire un panneau et redistribue sa place. */
export function sans(panes: Pane[], id: string): Pane[] {
  const reste = panes.filter((p) => p.id !== id)
  const poids = normaliser(reste.map((p) => p.poids))
  return reste.map((p, i) => ({ ...p, poids: poids[i] }))
}

/** Échange un panneau avec son voisin (dir = -1 vers la gauche, 1 vers la droite), poids inclus. */
export function deplacer(panes: Pane[], id: string, dir: -1 | 1): Pane[] {
  const i = panes.findIndex((p) => p.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= panes.length) return panes
  const copie = [...panes]
  ;[copie[i], copie[j]] = [copie[j], copie[i]]
  return copie
}
