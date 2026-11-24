import { useState } from 'react'
import { useStore } from '../lib/store'
import { definirJeton, garderLocal, prendreDisque, reconcilier, useSynchro, type Statut } from '../lib/synchro'
import { Icone } from './Icone'

export const LIBELLES: Record<Statut, string> = {
  init: 'Connexion au disque…',
  ok: 'Disque à jour',
  envoi: 'Enregistrement…',
  'hors-ligne': 'Hors ligne, en attente',
  conflit: 'Conflit à résoudre',
  jeton: 'Jeton requis',
  local: 'Navigateur seul',
}

/** Petit voyant d'état du stockage, dans la barre latérale. */
export function IndicateurDisque() {
  const statut = useSynchro((s) => s.statut)
  const voyant = statut === 'ok' ? 'ok' : statut === 'envoi' || statut === 'init' ? 'ok' : statut === 'local' ? 'inactif' : 'alerte'
  return (
    <button className="indicateur-disque" title="Forcer la synchronisation" onClick={() => void reconcilier()}>
      <span className={'voyant ' + voyant} />
      <span className="etiquette">{LIBELLES[statut]}</span>
    </button>
  )
}

/** Bandeau qui n'apparaît que lorsqu'une décision de l'utilisateur est nécessaire. */
export function BandeauSynchro() {
  const statut = useSynchro((s) => s.statut)
  const exporter = useStore((s) => s.exporter)
  const [jeton, setJeton] = useState('')

  const telecharger = () => {
    const blob = new Blob([exporter()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `atelier-version-locale-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (statut === 'conflit') {
    return (
      <div className="bandeau alerte" role="alert">
        <Icone nom="question" taille={18} />
        <div className="bandeau-texte">
          <strong>Les données ont été modifiées ailleurs</strong> pendant que cet appareil avait des changements non envoyés.
          Quelle version garder ?
        </div>
        <button className="bouton" onClick={telecharger}>Exporter ma version</button>
        <button className="bouton" onClick={() => { if (confirm("Remplacer cet appareil par la version du disque ? Tes changements non envoyés seront perdus.")) void prendreDisque() }}>Prendre le disque</button>
        <button className="bouton principal" onClick={() => { if (confirm("Écraser la version du disque par celle de cet appareil ? (L'ancienne reste dans les sauvegardes quotidiennes.)")) void garderLocal() }}>Garder cet appareil</button>
      </div>
    )
  }
  if (statut === 'jeton') {
    return (
      <form className="bandeau alerte" onSubmit={(e) => { e.preventDefault(); definirJeton(jeton) }}>
        <Icone nom="reglages" taille={18} />
        <div className="bandeau-texte"><strong>Jeton d'accès requis</strong> pour joindre le stockage de cet Atelier.</div>
        <input type="password" placeholder="Jeton" value={jeton} onChange={(e) => setJeton(e.target.value)} autoFocus />
        <button className="bouton principal" disabled={!jeton.trim()}>Valider</button>
      </form>
    )
  }
  return null
}
