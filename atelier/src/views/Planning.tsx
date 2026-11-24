import { useMemo, useState } from 'react'
import { useStore, aujourdhui, dateLocale } from '../lib/store'
import { estDue } from '../lib/sm2'
import { descendantes } from '../lib/texte'
import { formaterDuree, useMinuteur } from '../lib/minuteur'
import { SelecteurPage } from '../components/SelecteurSource'

export const joursRestants = (date: string, depuis = aujourdhui()) =>
  Math.round((new Date(date + 'T00:00').getTime() - new Date(depuis + 'T00:00').getTime()) / 86_400_000)

function Minuteur() {
  const { phase, actif, commence, finLe, restantMs, maintenant, demarrer, pause, reprendre, reinitialiser } = useMinuteur()
  const [pageId, setPageId] = useState<string | null>(null)
  const restant = actif && finLe ? finLe - maintenant : restantMs
  return (
    <div className={'panneau minuteur ' + phase}>
      <div className="minuteur-phase">{phase === 'travail' ? '🎯 Travail' : '☕ Pause'}</div>
      <div className="minuteur-temps">{formaterDuree(restant)}</div>
      <div className="ligne">
        {!actif && !commence && <button className="bouton principal" onClick={() => {
          if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission()
          demarrer(pageId)
        }}>Démarrer</button>}
        {actif && <button className="bouton" onClick={pause}>Pause</button>}
        {!actif && commence && <button className="bouton principal" onClick={reprendre}>Reprendre</button>}
        <button className="bouton" onClick={reinitialiser}>Réinitialiser</button>
      </div>
      {phase === 'travail' && <SelecteurPage valeur={pageId} onChange={setPageId} vide="Matière travaillée (optionnel)" />}
    </div>
  )
}

export function Planning() {
  const { examens, pages, cartes, taches, sessions, ajouterExamen, supprimerExamen, aller } = useStore()
  const [titre, setTitre] = useState('')
  const [date, setDate] = useState('')
  const [pageId, setPageId] = useState<string | null>(null)

  const semaine = useMemo(() => {
    const jours: { date: string; nom: string; minutes: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const cle = dateLocale(d)
      const minutes = sessions.filter((s) => dateLocale(new Date(s.date)) === cle).reduce((m, s) => m + s.minutes, 0)
      jours.push({ date: cle, nom: d.toLocaleDateString('fr-FR', { weekday: 'short' }), minutes })
    }
    return jours
  }, [sessions])
  const maxMin = Math.max(30, ...semaine.map((j) => j.minutes))

  const examensTries = [...examens].sort((a, b) => a.date.localeCompare(b.date))

  const ajouter = () => {
    if (!titre.trim() || !date) return
    ajouterExamen({ titre: titre.trim(), date, pageId })
    setTitre(''); setDate('')
  }

  return (
    <section className="vue large">
      <header className="vue-entete"><h1>Planning</h1></header>
      <div className="deux-colonnes">
        <div>
          <h3>Minuteur</h3>
          <Minuteur />
          <h3>7 derniers jours</h3>
          <div className="panneau histo">
            {semaine.map((j) => (
              <div key={j.date} className="histo-col" title={`${j.minutes} min`}>
                <div className="histo-barre" style={{ height: `${(j.minutes / maxMin) * 100}%` }} />
                <span>{j.nom}</span>
              </div>
            ))}
          </div>
          <p className="aide">{semaine.reduce((m, j) => m + j.minutes, 0)} min de travail cette semaine.</p>
        </div>
        <div>
          <h3>Examens & échéances</h3>
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
                  <button className="icone-btn" onClick={() => supprimerExamen(e.id)}>🗑</button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
