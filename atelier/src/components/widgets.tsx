import { useMemo, useState } from 'react'
import { dateLocale, useStore } from '../lib/store'
import { formaterDuree, useMinuteur } from '../lib/minuteur'
import { SelecteurPage } from './SelecteurSource'
import { Icone } from './Icone'

/** Anneau de progression façon réacteur : graduations, arc lumineux, anneau extérieur tournant. */
function Anneau({ progression, actif, children }: { progression: number; actif: boolean; children: React.ReactNode }) {
  const R = 86
  const circ = 2 * Math.PI * R
  const graduations = Array.from({ length: 60 }, (_, i) => {
    const angle = (i / 60) * 2 * Math.PI
    const long = i % 5 === 0
    const r1 = 100, r2 = long ? 94 : 97
    return <line key={i} x1={110 + r1 * Math.sin(angle)} y1={110 - r1 * Math.cos(angle)} x2={110 + r2 * Math.sin(angle)} y2={110 - r2 * Math.cos(angle)} className={long ? 'grad long' : 'grad'} />
  })
  return (
    <div className={'anneau' + (actif ? ' actif' : '')}>
      <svg viewBox="0 0 220 220" aria-hidden="true">
        <g className="anneau-ext"><circle cx="110" cy="110" r="106" /></g>
        {graduations}
        <circle className="anneau-piste" cx="110" cy="110" r={R} />
        <circle
          className="anneau-arc" cx="110" cy="110" r={R}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - Math.min(1, Math.max(0, progression)))}
          transform="rotate(-90 110 110)"
        />
        <g className="anneau-int"><circle cx="110" cy="110" r="72" /></g>
      </svg>
      <div className="anneau-centre">{children}</div>
    </div>
  )
}

export function Minuteur({ compact = false }: { compact?: boolean }) {
  const { phase, actif, commence, finLe, restantMs, maintenant, demarrer, pause, reprendre, reinitialiser } = useMinuteur()
  const reglages = useStore((s) => s.reglages)
  const [pageId, setPageId] = useState<string | null>(null)
  const restant = actif && finLe ? finLe - maintenant : restantMs
  const total = (phase === 'travail' ? reglages.dureeTravail : reglages.dureePause) * 60_000
  const progression = commence ? 1 - restant / total : 0
  return (
    <div className={'minuteur ' + phase + (compact ? ' compact' : '')}>
      <Anneau progression={progression} actif={actif}>
        <div className="etiquette">{phase === 'travail' ? 'Travail' : 'Pause'}</div>
        <div className="minuteur-temps">{formaterDuree(restant)}</div>
      </Anneau>
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
