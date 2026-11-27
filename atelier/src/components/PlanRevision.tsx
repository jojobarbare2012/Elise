import { useMemo } from 'react'
import { aujourdhui, useStore } from '../lib/store'
import { descendantes, texteDe } from '../lib/texte'
import { maitriseParPage } from '../lib/maitrise'
import { cleSeance, planifier, type JourPlan, type Seance } from '../lib/plan'
import { Icone } from './Icone'
import type { Examen } from '../lib/types'

const LIBELLE: Record<Seance['type'], string> = { apprendre: 'Apprendre', revoir: 'Revoir', 'examen-blanc': 'Examen blanc' }
const AIDE: Record<Seance['type'], string> = {
  apprendre: 'relire le cours, créer ou réviser les cartes',
  revoir: 'cartes dues + QCM du chapitre',
  'examen-blanc': 'QCM chronométré sur toute la matière',
}

/** Plan de chaque examen à venir rattaché à une matière ; recalculé chaque jour selon la maîtrise. */
export function usePlans(): { examen: Examen; jours: JourPlan[] }[] {
  const { examens, pages, cartes, qcms } = useStore()
  return useMemo(() => {
    const jour = aujourdhui()
    const niveaux = new Map(maitriseParPage(pages, cartes, qcms).map((m) => [m.page.id, m.niveau]))
    return examens
      .filter((e) => e.pageId && e.date > jour)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((examen) => {
        const sousPages = descendantes(pages, examen.pageId!)
        // Chapitres = pages de la matière qui ont du contenu ou des cartes (la matière elle-même si elle est seule).
        const avecContenu = sousPages.filter((p) => texteDe(p.contenu).length > 40 || cartes.some((c) => c.pageId === p.id))
        const chapitres = (avecContenu.length > 1 ? avecContenu.filter((p) => p.id !== examen.pageId) : avecContenu)
          .map((p) => ({ id: p.id, titre: p.titre || 'Sans titre', niveau: niveaux.get(p.id) ?? null }))
        return { examen, jours: planifier(chapitres, jour, examen.date) }
      })
  }, [examens, pages, cartes, qcms])
}

function LigneSeance({ examen, date, s }: { examen: Examen; date: string; s: Seance }) {
  const { aller, basculerSeance } = useStore()
  const cle = cleSeance(date, s)
  const fait = examen.faits?.includes(cle) ?? false
  return (
    <div className={'seance' + (fait ? ' faite' : '')}>
      <input type="checkbox" checked={fait} onChange={() => basculerSeance(examen.id, cle)} aria-label="Séance faite" />
      <span className={'badge-seance ' + s.type}>{LIBELLE[s.type]}</span>
      <button className="lien" onClick={() => aller(s.pageId ? { type: 'page', pageId: s.pageId } : { type: 'qcm' })}>{s.titre}</button>
      <span className="aide">{AIDE[s.type]}</span>
    </div>
  )
}

/** `compact` : seulement le programme du jour (accueil). Sinon : les 7 prochains jours. */
export function PlanRevision({ compact = false }: { compact?: boolean }) {
  const plans = usePlans()
  const jour = aujourdhui()
  if (!plans.length) {
    return <p className="vide">Ajoute un examen rattaché à une matière (module Échéances) : le plan se construit tout seul.</p>
  }
  return (
    <div className="plan">
      {plans.map(({ examen, jours }) => {
        const visibles = compact ? jours.filter((j) => j.date === jour) : jours.slice(0, 7)
        return (
          <div key={examen.id} className="plan-examen">
            <div className="plan-titre"><Icone nom="calendrier" taille={14} /> {examen.titre} <span className="compte">J-{Math.round((new Date(examen.date + 'T00:00').getTime() - new Date(jour + 'T00:00').getTime()) / 86_400_000)}</span></div>
            {!jours.length && <p className="aide">Aucun chapitre avec du contenu dans cette matière pour l’instant.</p>}
            {visibles.map((j) => (
              <div key={j.date} className="plan-jour">
                {!compact && <div className="etiquette">{j.date === jour ? 'Aujourd’hui' : new Date(j.date + 'T00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })}</div>}
                {j.seances.map((s, i) => <LigneSeance key={i} examen={examen} date={j.date} s={s} />)}
                {!j.seances.length && <p className="aide">Repos.</p>}
              </div>
            ))}
            {compact && !visibles.length && jours.length > 0 && <p className="aide">Rien de prévu aujourd’hui.</p>}
          </div>
        )
      })}
    </div>
  )
}
