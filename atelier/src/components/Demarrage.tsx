import { useEffect, useState } from 'react'
import { useStore } from '../lib/store'
import { estDue } from '../lib/sm2'
import { configIA, etatClaude } from '../lib/llm'

type Ia = 'attente' | 'ok' | 'ko'

/** Écran d'initialisation : affiche l'état réel du système, se ferme tout seul (ou au clic). */
export function Demarrage({ onFin }: { onFin: () => void }) {
  const pages = useStore((s) => s.pages.length)
  const cartes = useStore((s) => s.cartes)
  const ia = configIA(useStore.getState().reglages)
  const [etape, setEtape] = useState(0)
  const [iaEtat, setIa] = useState<Ia>('attente')
  const [sortie, setSortie] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) onFin()
  }, [onFin])

  // Sonde réelle d'Ollama (courte), pour dire la vérité à l'écran.
  useEffect(() => {
    if (ia.fournisseur === 'claude') {
      void etatClaude().then((ok) => setIa(ok ? 'ok' : 'ko'))
      return
    }
    const ctrl = new AbortController()
    const t = window.setTimeout(() => ctrl.abort(), 1500)
    fetch('/ollama/api/tags', { signal: ctrl.signal })
      .then((r) => setIa(r.ok ? 'ok' : 'ko'))
      .catch(() => setIa('ko'))
      .finally(() => window.clearTimeout(t))
    return () => { ctrl.abort(); window.clearTimeout(t) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const lignes: { texte: string; etat: 'ok' | 'avert' | 'attente' }[] = [
    { texte: 'Noyau interface', etat: 'ok' },
    { texte: `Mémoire locale : ${pages} page(s), ${cartes.length} carte(s)`, etat: 'ok' },
    { texte: `Révisions en attente : ${cartes.filter((c) => estDue(c)).length}`, etat: 'ok' },
    { texte: ia.fournisseur === 'claude' ? `IA : ${ia.modele}` : 'IA locale (Ollama)', etat: iaEtat === 'ok' ? 'ok' : iaEtat === 'ko' ? 'avert' : 'attente' },
    { texte: 'Interface prête', etat: 'ok' },
  ]

  useEffect(() => {
    if (etape >= lignes.length) return
    // Ne reste pas bloqué sur la sonde IA : 1,6 s maximum.
    const t = window.setTimeout(() => setEtape((e) => e + 1), etape === 3 && iaEtat === 'attente' ? 700 : 330)
    return () => window.clearTimeout(t)
  }, [etape, iaEtat, lignes.length])

  useEffect(() => {
    if (etape < lignes.length) return
    const t = window.setTimeout(() => setSortie(true), 450)
    return () => window.clearTimeout(t)
  }, [etape, lignes.length])

  useEffect(() => {
    if (!sortie) return
    const t = window.setTimeout(onFin, 600)
    return () => window.clearTimeout(t)
  }, [sortie, onFin])

  useEffect(() => {
    const passer = () => setSortie(true)
    window.addEventListener('keydown', passer)
    return () => window.removeEventListener('keydown', passer)
  }, [])

  return (
    <div className={'demarrage' + (sortie ? ' sortie' : '')} onClick={() => setSortie(true)}>
      <div className="demarrage-coeur">
        <svg className="demarrage-anneaux" viewBox="0 0 400 400" aria-hidden="true">
          <circle className="a1" cx="200" cy="200" r="190" />
          <circle className="a2" cx="200" cy="200" r="160" />
          <circle className="a3" cx="200" cy="200" r="125" />
          <circle className="a4" cx="200" cy="200" r="92" />
        </svg>
        <div className="demarrage-marque">ATELIER</div>
      </div>
      <ul className="demarrage-journal">
        {lignes.slice(0, etape + 1).map((l, i) => {
          const fait = i < etape
          const etat = fait ? l.etat : 'attente'
          return (
            <li key={i} className={etat}>
              <span className="mono">[{etat === 'ok' ? ' OK ' : etat === 'avert' ? 'HORS' : ' .. '}]</span> {l.texte}
              {fait && l.etat === 'avert' && <em> — {ia.fournisseur === 'claude' ? 'clé API absente (atelier/.env)' : 'hors ligne'}, QCM et cartes IA indisponibles</em>}
            </li>
          )
        })}
      </ul>
      <div className="demarrage-barre"><div style={{ width: `${Math.min(100, (etape / lignes.length) * 100)}%` }} /></div>
      <div className="etiquette demarrage-aide">Cliquer ou appuyer sur une touche pour passer</div>
    </div>
  )
}
