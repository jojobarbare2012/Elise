import { useState } from 'react'
import { useStore } from '../lib/store'
import { descendantes } from '../lib/texte'
import type { Page, Vue } from '../lib/types'
import { Icone } from './Icone'
import { formaterDuree, useMinuteur } from '../lib/minuteur'
import { IndicateurDisque } from './BandeauSynchro'
import { ImportCours } from './ImportCours'
import { useState as useEtat } from 'react'

function NoeudPage({ page, niveau }: { page: Page; niveau: number }) {
  const pages = useStore((s) => s.pages)
  const vue = useStore((s) => s.vue)
  const aller = useStore((s) => s.aller)
  const creerPage = useStore((s) => s.creerPage)
  const supprimerPage = useStore((s) => s.supprimerPage)
  const [ouvert, setOuvert] = useState(true)
  const enfants = pages.filter((p) => p.parentId === page.id)
  const actif = vue.type === 'page' && vue.pageId === page.id

  return (
    <div>
      <div className={'noeud' + (actif ? ' actif' : '')} style={{ paddingLeft: 8 + niveau * 14 }}>
        <button className="noeud-fleche" onClick={() => setOuvert(!ouvert)} aria-label="Déplier">
          {enfants.length ? <Icone nom={ouvert ? 'fleche_bas' : 'fleche'} taille={12} /> : null}
        </button>
        <button className="noeud-titre" onClick={() => aller({ type: 'page', pageId: page.id })}>
          <Icone nom={page.icone} taille={15} /> {page.titre || 'Sans titre'}
        </button>
        <span className="noeud-actions">
          <button title="Sous-page" onClick={() => { setOuvert(true); creerPage(page.id) }}><Icone nom="plus" taille={13} /></button>
          <button
            title="Supprimer"
            onClick={() => {
              const n = descendantes(pages, page.id).length - 1 // toutes les sous-pages, pas seulement les directes
              if (confirm(`Supprimer « ${page.titre || 'Sans titre'} »${n ? ` et ses ${n} sous-page(s)` : ''} ?`)) supprimerPage(page.id)
            }}
          >
            <Icone nom="corbeille" taille={13} />
          </button>
        </span>
      </div>
      {ouvert && enfants.map((e) => <NoeudPage key={e.id} page={e} niveau={niveau + 1} />)}
    </div>
  )
}

const NAV: { vue: Vue; icone: string; titre: string }[] = [
  { vue: { type: 'accueil' }, icone: 'accueil', titre: 'Aujourd’hui' },
  { vue: { type: 'cartes' }, icone: 'cartes', titre: 'Cartes' },
  { vue: { type: 'qcm' }, icone: 'qcm', titre: 'QCM' },
  { vue: { type: 'taches' }, icone: 'taches', titre: 'Tâches' },
  { vue: { type: 'planning' }, icone: 'planning', titre: 'Planning' },
  { vue: { type: 'espace' }, icone: 'modules', titre: 'Espace de travail' },
]

export function Sidebar({ onRecherche, onReglages }: { onRecherche: () => void; onReglages: () => void }) {
  const pages = useStore((s) => s.pages)
  const vue = useStore((s) => s.vue)
  const aller = useStore((s) => s.aller)
  const creerPage = useStore((s) => s.creerPage)
  const racines = pages.filter((p) => p.parentId === null)
  const { actif, finLe, maintenant, phase } = useMinuteur()
  const [importer, setImporter] = useEtat(false)

  return (
    <aside className="sidebar">
      <div className="marque"><span className="reacteur" /><span>ATELIER</span></div>
      <button className="recherche-btn" onClick={onRecherche}><Icone nom="recherche" /> Rechercher <kbd>Ctrl K</kbd></button>
      <nav>
        {NAV.map((n) => (
          <button
            key={n.vue.type}
            className={'nav-item' + (vue.type === n.vue.type ? ' actif' : '')}
            onClick={() => aller(n.vue)}
          >
            <Icone nom={n.icone} /> {n.titre}
          </button>
        ))}
      </nav>
      <button className="nav-item" onClick={() => setImporter(true)}>
        <Icone nom="livre" /> Importer un cours
      </button>
      <div className="sidebar-section">
        <span>Pages & matières</span>
        <span>
          <button title="Importer un cours (PDF, photos)" onClick={() => setImporter(true)}><Icone nom="livre" taille={15} /></button>
          <button title="Nouvelle page" onClick={() => creerPage(null)}><Icone nom="plus" taille={15} /></button>
        </span>
      </div>
      <div className="arbre">
        {racines.map((p) => <NoeudPage key={p.id} page={p} niveau={0} />)}
        {!racines.length && <p className="vide">Aucune page.</p>}
      </div>
      {actif && finLe && (
        <button className="minuteur-mini" onClick={() => aller({ type: 'planning' })}>
          <span className="voyant" />
          <span className="etiquette">{phase === 'travail' ? 'Travail' : 'Pause'}</span>
          <span className="mono">{formaterDuree(finLe - maintenant)}</span>
        </button>
      )}
      {importer && <ImportCours parentInitial={vue.type === 'page' ? vue.pageId : null} onFermer={() => setImporter(false)} />}
      <IndicateurDisque />
      <button className="nav-item reglages" onClick={onReglages}><Icone nom="reglages" /> Réglages et sauvegarde</button>
    </aside>
  )
}
