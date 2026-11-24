import { useState } from 'react'
import { useStore } from '../lib/store'
import type { Page, Vue } from '../lib/types'

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
          {enfants.length ? (ouvert ? '▾' : '▸') : ''}
        </button>
        <button className="noeud-titre" onClick={() => aller({ type: 'page', pageId: page.id })}>
          {page.icone} {page.titre || 'Sans titre'}
        </button>
        <span className="noeud-actions">
          <button title="Sous-page" onClick={() => { setOuvert(true); creerPage(page.id) }}>＋</button>
          <button
            title="Supprimer"
            onClick={() => {
              const n = enfants.length
              if (confirm(`Supprimer « ${page.titre || 'Sans titre'} »${n ? ` et ses ${n} sous-page(s)` : ''} ?`)) supprimerPage(page.id)
            }}
          >
            🗑
          </button>
        </span>
      </div>
      {ouvert && enfants.map((e) => <NoeudPage key={e.id} page={e} niveau={niveau + 1} />)}
    </div>
  )
}

const NAV: { vue: Vue; icone: string; titre: string }[] = [
  { vue: { type: 'accueil' }, icone: '🏠', titre: 'Aujourd’hui' },
  { vue: { type: 'cartes' }, icone: '🃏', titre: 'Cartes' },
  { vue: { type: 'qcm' }, icone: '✅', titre: 'QCM' },
  { vue: { type: 'taches' }, icone: '🗂', titre: 'Tâches' },
  { vue: { type: 'planning' }, icone: '⏱', titre: 'Planning' },
]

export function Sidebar({ onRecherche, onReglages }: { onRecherche: () => void; onReglages: () => void }) {
  const pages = useStore((s) => s.pages)
  const vue = useStore((s) => s.vue)
  const aller = useStore((s) => s.aller)
  const creerPage = useStore((s) => s.creerPage)
  const racines = pages.filter((p) => p.parentId === null)

  return (
    <aside className="sidebar">
      <button className="recherche-btn" onClick={onRecherche}>🔍 Rechercher <kbd>Ctrl K</kbd></button>
      <nav>
        {NAV.map((n) => (
          <button
            key={n.vue.type}
            className={'nav-item' + (vue.type === n.vue.type ? ' actif' : '')}
            onClick={() => aller(n.vue)}
          >
            {n.icone} {n.titre}
          </button>
        ))}
      </nav>
      <div className="sidebar-section">
        <span>Pages & matières</span>
        <button title="Nouvelle page" onClick={() => creerPage(null)}>＋</button>
      </div>
      <div className="arbre">
        {racines.map((p) => <NoeudPage key={p.id} page={p} niveau={0} />)}
        {!racines.length && <p className="vide">Aucune page.</p>}
      </div>
      <button className="nav-item reglages" onClick={onReglages}>⚙️ Réglages & sauvegarde</button>
    </aside>
  )
}
