import { useState } from 'react'
import { useStore, aujourdhui } from '../lib/store'
import { estDue } from '../lib/sm2'
import { descendantes } from '../lib/texte'
import { Minuteur, Histo } from '../components/widgets'
import { GrilleModules, type DefModule } from '../components/GrilleModules'
import { PlanRevision } from '../components/PlanRevision'
import type { ModuleDispo } from '../lib/types'
import { Icone } from '../components/Icone'
import { SelecteurPage } from '../components/SelecteurSource'

export const joursRestants = (date: string, depuis = aujourdhui()) =>
  Math.round((new Date(date + 'T00:00').getTime() - new Date(depuis + 'T00:00').getTime()) / 86_400_000)

function ContenuExamens() {
  const { examens, pages, cartes, taches, ajouterExamen, supprimerExamen, aller } = useStore()
  const [titre, setTitre] = useState('')
  const [date, setDate] = useState('')
  const [pageId, setPageId] = useState<string | null>(null)

  const examensTries = [...examens].sort((a, b) => a.date.localeCompare(b.date))

  const ajouter = () => {
    if (!titre.trim() || !date) return
    ajouterExamen({ titre: titre.trim(), date, pageId })
    setTitre(''); setDate('')
  }

  return (
    <>
      <div className="formulaire">
        <input placeholder="Ex. Partiel de maths" value={titre} onChange={(e) => setTitre(e.target.value)} />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <SelecteurPage valeur={pageId} onChange={setPageId} vide="Matière (optionnel)" />
        <button className="bouton principal" onClick={ajouter}>Ajouter</button>
      </div>
      {!examensTries.length && <p className="vide">Aucun examen planifié.</p>}
      {examensTries.map((e) => {
        const j = joursRestants(e.date)
        const ids = e.pageId ? new Set(descendantes(pages, e.pageId).map((p) => p.id)) : null
        const cartesMatiere = ids ? cartes.filter((c) => c.pageId && ids.has(c.pageId)) : []
        const aReviser = cartesMatiere.filter((c) => estDue(c)).length
        const tachesOuvertes = taches.filter((t) => t.statut !== 'fait' && ids && t.pageId && ids.has(t.pageId)).length
        const parJour = j > 0 ? Math.ceil(cartesMatiere.length / Math.max(1, j)) : 0
        return (
          <div key={e.id} className={'item-carte examen' + (j < 0 ? ' passe' : j <= 7 ? ' proche' : '')}>
            <div>
              <strong>{e.titre}</strong>
              <div className="aide">
                {new Date(e.date + 'T00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                {e.pageId && <> · <button className="lien" onClick={() => aller({ type: 'page', pageId: e.pageId! })}>{pages.find((p) => p.id === e.pageId)?.titre}</button></>}
              </div>
              {e.pageId && j >= 0 && (
                <div className="aide">
                  {cartesMatiere.length} cartes ({aReviser} à réviser) · {tachesOuvertes} tâche(s) ouverte(s)
                  {parJour > 0 && <> · ≈ {parJour} carte(s)/jour pour tout revoir</>}
                </div>
              )}
            </div>
            <div className="ligne">
              <span className="compte">{j < 0 ? 'passé' : j === 0 ? 'Aujourd’hui' : `J-${j}`}</span>
              <button className="icone-btn" onClick={() => supprimerExamen(e.id)}><Icone nom="corbeille" taille={15} /></button>
            </div>
          </div>
        )
      })}
    </>
  )
}

const DEFS: Record<string, DefModule> = {
  minuteur: { titre: 'Minuteur', icone: 'planning', rendu: () => <Minuteur /> },
  examens: { titre: 'Examens et échéances', icone: 'calendrier', rendu: () => <ContenuExamens /> },
  semaine: { titre: '7 derniers jours', icone: 'graphique', rendu: () => <Histo /> },
  plan: { titre: 'Plan de révision', icone: 'cible', rendu: () => <PlanRevision /> },
}
const DEFAUT: ModuleDispo[] = [
  { id: 'minuteur', visible: true, taille: 1 },
  { id: 'examens', visible: true, taille: 2 },
  { id: 'semaine', visible: true, taille: 1 },
  { id: 'plan', visible: true, taille: 2 },
]

export function Planning() {
  return (
    <section className="vue large">
      <header className="vue-entete"><h1>Planning</h1></header>
      <GrilleModules cle="planning" defs={DEFS} defaut={DEFAUT} />
    </section>
  )
}
