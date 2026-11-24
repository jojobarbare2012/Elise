import { useEffect, useState } from 'react'
import { useStore } from './lib/store'
import { useMinuteur, formaterDuree } from './lib/minuteur'
import { Sidebar } from './components/Sidebar'
import { PageEditeur } from './components/PageEditeur'
import { Recherche } from './components/Recherche'
import { Reglages } from './components/Reglages'
import { Accueil } from './views/Accueil'
import { Cartes } from './views/Cartes'
import { Qcm } from './views/Qcm'
import { Taches } from './views/Taches'
import { Planning } from './views/Planning'

export default function App() {
  const vue = useStore((s) => s.vue)
  const aller = useStore((s) => s.aller)
  const page = useStore((s) => (s.vue.type === 'page' ? s.pages.find((p) => p.id === (s.vue as { pageId: string }).pageId) : undefined))
  const [recherche, setRecherche] = useState(false)
  const [reglages, setReglages] = useState(false)
  const { actif, finLe, maintenant, phase, tic } = useMinuteur()

  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setRecherche((r) => !r) }
    }
    window.addEventListener('keydown', surTouche)
    return () => window.removeEventListener('keydown', surTouche)
  }, [])

  useEffect(() => {
    const t = window.setInterval(tic, 500)
    return () => window.clearInterval(t)
  }, [tic])

  // Page supprimée ailleurs : retour à l'accueil.
  useEffect(() => { if (vue.type === 'page' && !page) aller({ type: 'accueil' }) }, [vue, page, aller])

  return (
    <div className="appli">
      <Sidebar onRecherche={() => setRecherche(true)} onReglages={() => setReglages(true)} />
      <main className="principal">
        {actif && finLe && (
          <button className="bandeau-minuteur" onClick={() => aller({ type: 'planning' })}>
            {phase === 'travail' ? '🎯' : '☕'} {formaterDuree(finLe - maintenant)}
          </button>
        )}
        {vue.type === 'accueil' && <Accueil />}
        {vue.type === 'page' && page && <PageEditeur key={page.id} page={page} />}
        {vue.type === 'cartes' && <Cartes />}
        {vue.type === 'qcm' && <Qcm />}
        {vue.type === 'taches' && <Taches />}
        {vue.type === 'planning' && <Planning />}
      </main>
      {recherche && <Recherche onFermer={() => setRecherche(false)} />}
      {reglages && <Reglages onFermer={() => setReglages(false)} />}
    </div>
  )
}
