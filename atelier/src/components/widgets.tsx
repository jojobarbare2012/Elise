import { useMemo, useState } from 'react'
import { dateLocale, useStore } from '../lib/store'
import { formaterDuree, useMinuteur } from '../lib/minuteur'
import { SelecteurPage } from './SelecteurSource'
import { Icone } from './Icone'

export function Minuteur({ compact = false }: { compact?: boolean }) {
  const { phase, actif, commence, finLe, restantMs, maintenant, demarrer, pause, reprendre, reinitialiser } = useMinuteur()
  const [pageId, setPageId] = useState<string | null>(null)
  const restant = actif && finLe ? finLe - maintenant : restantMs
  return (
    <div className={'minuteur ' + phase}>
      <div className="etiquette">{phase === 'travail' ? 'Session de travail' : 'Pause'}</div>
      <div className="minuteur-temps">{formaterDuree(restant)}</div>
      <div className="ligne centre">
        {!actif && !commence && (
          <button className="bouton principal" onClick={() => {
            if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission()
            demarrer(pageId)
          }}>Démarrer</button>
        )}
        {actif && <button className="bouton" onClick={pause}><Icone nom="pause" taille={14} /> Pause</button>}
        {!actif && commence && <button className="bouton principal" onClick={reprendre}>Reprendre</button>}
        <button className="bouton" onClick={reinitialiser}>Réinitialiser</button>
      </div>
      {!compact && phase === 'travail' && <SelecteurPage valeur={pageId} onChange={setPageId} vide="Matière travaillée (optionnel)" />}
    </div>
  )
}

export function useSemaine() {
  const sessions = useStore((s) => s.sessions)
  return useMemo(() => {
    const jours: { date: string; nom: string; minutes: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const cle = dateLocale(d)
      const minutes = sessions.filter((s) => dateLocale(new Date(s.date)) === cle).reduce((m, s) => m + s.minutes, 0)
      jours.push({ date: cle, nom: d.toLocaleDateString('fr-FR', { weekday: 'short' }), minutes })
    }
    return jours
  }, [sessions])
}

export function Histo() {
  const semaine = useSemaine()
  const max = Math.max(30, ...semaine.map((j) => j.minutes))
  return (
    <>
      <div className="histo">
        {semaine.map((j) => (
          <div key={j.date} className="histo-col" title={`${j.minutes} min`}>
            <div className="histo-barre" style={{ height: `${(j.minutes / max) * 100}%` }} />
            <span>{j.nom}</span>
          </div>
        ))}
      </div>
      <p className="aide">{semaine.reduce((m, j) => m + j.minutes, 0)} min de travail sur 7 jours</p>
    </>
  )
}
