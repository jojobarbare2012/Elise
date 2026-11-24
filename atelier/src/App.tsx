import { useCallback, useEffect, useState } from 'react'
import { useStore } from './lib/store'
import { useMinuteur } from './lib/minuteur'
import { Sidebar } from './components/Sidebar'
import { PageEditeur } from './components/PageEditeur'
import { Recherche } from './components/Recherche'
import { Reglages } from './components/Reglages'
import { Accueil } from './views/Accueil'
import { Cartes } from './views/Cartes'
import { Qcm } from './views/Qcm'
import { Taches } from './views/Taches'
import { Planning } from './views/Planning'
import { Espace } from './views/Espace'
import { Demarrage } from './components/Demarrage'
import { BandeauSynchro } from './components/BandeauSynchro'

export default function App() {
  const vue = useStore((s) => s.vue)
  const aller = useStore((s) => s.aller)
  const page = useStore((s) => (s.vue.type === 'page' ? s.pages.find((p) => p.id === (s.vue as { pageId: string }).pageId) : undefined))
  const [recherche, setRecherche] = useState(false)
  const [reglages, setReglages] = useState(false)
  const demarrageActif = useStore((s) => s.reglages.demarrage !== false)
  const [boot, setBoot] = useState(() => demarrageActif)
  const finBoot = useCallback(() => setBoot(false), [])
  const tic = useMinuteur((m) => m.tic)
  const accent = useStore((s) => s.reglages.accent)
  useEffect(() => { document.documentElement.dataset.accent = accent }, [accent])

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
        <BandeauSynchro />
        <div key={'f-' + (vue.type === 'page' ? vue.pageId : vue.type)} className="faisceau" />
        <div key={vue.type === 'page' ? 'page-' + vue.pageId : vue.type} className={'vue-anim' + (vue.type === 'espace' ? ' plein' : '')}>
          {vue.type === 'accueil' && <Accueil />}
          {vue.type === 'page' && page && <PageEditeur key={page.id} page={page} />}
          {vue.type === 'cartes' && <Cartes />}
          {vue.type === 'qcm' && <Qcm />}
          {vue.type === 'taches' && <Taches />}
          {vue.type === 'planning' && <Planning />}
          {vue.type === 'espace' && <Espace />}
        </div>
      </main>
      {boot && <Demarrage onFin={finBoot} />}
      {recherche && <Recherche onFermer={() => setRecherche(false)} />}
      {reglages && <Reglages onFermer={() => setReglages(false)} />}
    </div>
  )
}
