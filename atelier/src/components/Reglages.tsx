import { useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { reconcilier, useSynchro } from '../lib/synchro'
import { LIBELLES } from './BandeauSynchro'
import { etatClaude } from '../lib/llm'

export function Reglages({ onFermer }: { onFermer: () => void }) {
  const { reglages, majReglages, exporter, importer } = useStore()
  const fichier = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState('')
  const synchro = useSynchro()
  const [iaEtat, setIaEtat] = useState<boolean | null>(null)
  useEffect(() => { void etatClaude().then(setIaEtat) }, [])

  const telecharger = () => {
    const blob = new Blob([exporter()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `atelier-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const restaurer = async (f: File) => {
    if (!confirm('Remplacer toutes les données actuelles par cette sauvegarde ?')) return
    try {
      importer(await f.text())
      setMessage('Sauvegarde restaurée.')
    } catch (e) {
      setMessage((e as Error).message)
    }
  }

  return (
    <div className="voile" onMouseDown={onFermer}>
      <div className="dialogue" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Réglages</h2>
        <label>
          IA pour les QCM et les cartes
          <select value={reglages.fournisseur ?? 'claude'} onChange={(e) => majReglages({ fournisseur: e.target.value as 'claude' | 'ollama' })}>
            <option value="claude">Claude (API Anthropic, en ligne)</option>
            <option value="ollama">Ollama (local, sur ce PC)</option>
          </select>
        </label>
        {(reglages.fournisseur ?? 'claude') === 'claude' ? (
          <>
            <label>
              Modèle Claude
              <input value={reglages.modeleClaude ?? 'claude-opus-5-5'} onChange={(e) => majReglages({ modeleClaude: e.target.value.trim() })} />
            </label>
            <p className="aide">
              {iaEtat === null ? 'Vérification de la clé…' : iaEtat ? 'Clé API configurée sur le serveur.' : 'Aucune clé : ajoute ANTHROPIC_API_KEY dans atelier/.env puis relance.'}
              {' '}Le contenu des cours utilisés est envoyé à Anthropic.
            </p>
          </>
        ) : (
          <label>
            Modèle Ollama
            <input value={reglages.modele} onChange={(e) => majReglages({ modele: e.target.value })} />
          </label>
        )}
        <div className="ligne">
          <label>Travail (min)
            <input type="number" min={1} max={180} value={reglages.dureeTravail}
              onChange={(e) => majReglages({ dureeTravail: Math.max(1, Number(e.target.value) || 25) })} />
          </label>
          <label>Pause (min)
            <input type="number" min={1} max={60} value={reglages.dureePause}
              onChange={(e) => majReglages({ dureePause: Math.max(1, Number(e.target.value) || 5) })} />
          </label>
        </div>
        <label className="case">
          <input type="checkbox" checked={reglages.demarrage !== false} onChange={(e) => majReglages({ demarrage: e.target.checked })} />
          Écran de démarrage animé
        </label>
        <div className="etiquette">Couleur du système</div>
        <div className="ligne">
          {(['cyan', 'ambre', 'vert', 'magenta'] as const).map((a) => (
            <button key={a} data-accent={a} className={'pastille' + (reglages.accent === a ? ' actif' : '')} title={a} onClick={() => majReglages({ accent: a })} />
          ))}
        </div>
        <h3>Stockage</h3>
        <p className="aide">
          {synchro.statut === 'local'
            ? "Aucun serveur Atelier détecté : les données restent dans ce navigateur. Lance « npm start » pour les enregistrer sur disque."
            : <>État : <strong>{LIBELLES[synchro.statut]}</strong>{synchro.derniere ? ` (dernière synchro ${new Date(synchro.derniere).toLocaleTimeString('fr-FR')})` : ''}.
              {synchro.dossier && <> Dossier des données : <span className="mono">{synchro.dossier}</span></>}</>}
        </p>
        <div className="ligne"><button className="bouton" onClick={() => void reconcilier()}>Synchroniser maintenant</button></div>
        <h3>Export manuel</h3>
        <div className="ligne">
          <button className="bouton" onClick={telecharger}>Exporter (JSON)</button>
          <button className="bouton" onClick={() => fichier.current?.click()}>Importer…</button>
          <input ref={fichier} type="file" accept="application/json" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) restaurer(f); e.target.value = '' }} />
        </div>
        {message && <p className="aide">{message}</p>}
        <div className="ligne fin"><button className="bouton principal" onClick={onFermer}>Fermer</button></div>
      </div>
    </div>
  )
}
