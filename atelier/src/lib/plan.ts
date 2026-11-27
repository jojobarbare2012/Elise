import { dateLocale } from './store'

export interface ChapitrePlan {
  id: string
  titre: string
  niveau: number | null // maîtrise 0..1 (null = jamais travaillé)
}

export type TypeSeance = 'apprendre' | 'revoir' | 'examen-blanc'

export interface Seance {
  type: TypeSeance
  pageId: string | null // null pour l'examen blanc de toute la matière
  titre: string
}

export interface JourPlan {
  date: string // YYYY-MM-DD
  seances: Seance[]
}

const ajouterJours = (date: string, n: number) => {
  const d = new Date(date + 'T00:00')
  d.setDate(d.getDate() + n)
  return dateLocale(d)
}

/** Nombre de passages selon la maîtrise : un chapitre faible ou jamais travaillé est revu 3 fois. */
export const passagesNecessaires = (niveau: number | null) => (niveau === null || niveau < 0.5 ? 3 : niveau < 0.8 ? 2 : 1)

/**
 * Plan de révision jusqu'à la veille de l'examen. Les chapitres les plus faibles passent en premier, et chaque
 * chapitre revient plusieurs fois, espacé (tous les premiers passages avant les deuxièmes, etc.).
 * La veille : examen blanc. Recalculé chaque jour, il s'adapte à la progression.
 */
export function planifier(chapitres: ChapitrePlan[], aujourdhui: string, examen: string): JourPlan[] {
  const jours: string[] = []
  for (let d = aujourdhui; d < examen; d = ajouterJours(d, 1)) jours.push(d)
  if (!jours.length || !chapitres.length) return []

  const tries = [...chapitres].sort((a, b) => (a.niveau ?? -1) - (b.niveau ?? -1))
  const passes: Seance[][] = [[], [], []]
  for (const c of tries) {
    const n = passagesNecessaires(c.niveau)
    for (let k = 0; k < n; k++) {
      passes[k].push({ type: k === 0 && (c.niveau === null || c.niveau < 0.5) ? 'apprendre' : 'revoir', pageId: c.id, titre: c.titre })
    }
  }
  const seances = passes.flat()
  const plan: JourPlan[] = jours.map((date) => ({ date, seances: [] }))

  // La veille est réservée à l'examen blanc dès qu'on a au moins 2 jours.
  const joursTravail = jours.length >= 2 ? plan.slice(0, -1) : plan
  if (jours.length >= 2) plan[plan.length - 1].seances.push({ type: 'examen-blanc', pageId: null, titre: 'Examen blanc' })

  // Répartition uniforme sur toute la période (espacement), en gardant l'ordre des passages :
  // la séance k vise le jour k × (jours / séances), puis avance si ce jour est plein ou contient déjà ce chapitre.
  const n = joursTravail.length
  const capacite = Math.max(1, Math.ceil(seances.length / n))
  seances.forEach((s, k) => {
    let j = Math.min(n - 1, Math.floor((k * n) / seances.length))
    let essais = 0
    while (essais < n && (joursTravail[j].seances.length >= capacite || joursTravail[j].seances.some((x) => x.pageId === s.pageId))) {
      j = (j + 1) % n
      essais++
    }
    joursTravail[j].seances.push(s)
  })
  return plan
}

export const cleSeance = (date: string, s: Seance) => `${date}|${s.type}|${s.pageId ?? ''}`
