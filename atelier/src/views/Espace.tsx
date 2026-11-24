import { useRef, useState, type CSSProperties } from 'react'
import { useStore } from '../lib/store'
import { MAX_PANES, TYPES_PANE, normaliser, redimensionner } from '../lib/espace'
import { Icone } from '../components/Icone'
import { PageEditeur } from '../components/PageEditeur'
import { SelecteurPage } from '../components/SelecteurSource'
import { Minuteur, Histo } from '../components/widgets'
import { Module } from '../components/Module'
import { Accueil } from './Accueil'
import { Cartes } from './Cartes'
import { Qcm } from './Qcm'
import { Taches } from './Taches'
import { Planning } from './Planning'
import type { Pane, TypePane } from '../lib/types'

const id = () => crypto.randomUUID()
const pane = (type: TypePane, poids: number): Pane => ({ id: id(), type, pageId: null, poids })

const PRESETS: { titre: string; panes: () => Pane[] }[] = [
  { titre: 'Révision', panes: () => [pane('page', 0.45), pane('cartes', 0.35), pane('minuteur', 0.2)] },
  { titre: 'Planification', panes: () => [pane('taches', 0.6), pane('planning', 0.4)] },
  { titre: 'Cours + QCM', panes: () => [pane('page', 0.5), pane('qcm', 0.5)] },
]

function ContenuPane({ p }: { p: Pane }) {
  const pages = useStore((s) => s.pages)
  const majPane = useStore((s) => s.majPane)
  switch (p.type) {
    case 'page': {
      const page = pages.find((x) => x.id === p.pageId)
      return page ? (
        <PageEditeur key={page.id} page={page} />
      ) : (
        <div className="pane-choix">
          <span className="etiquette">Page à afficher</span>
          <SelecteurPage valeur={null} onChange={(v) => majPane(p.id, { pageId: v })} vide="Choisir une page…" />
        </div>
      )
    }
    case 'cartes': return <Cartes />
    case 'qcm': return <Qcm />
    case 'taches': return <Taches />
    case 'planning': return <Planning />
    case 'accueil': return <Accueil />
    case 'minuteur':
      return (
        <div className="vue">
          <Module titre="Minuteur" icone="planning"><Minuteur /></Module>
          <Module titre="7 derniers jours" icone="graphique"><Histo /></Module>
        </div>
      )
  }
}

export function Espace() {
  const { espace, definirEspace, ajouterPane, retirerPane, majPane, deplacerPane, pages } = useStore()
  const conteneur = useRef<HTMLDivElement>(null)
  const [apercu, setApercu] = useState<number[] | null>(null) // poids pendant un glissement
  const [menu, setMenu] = useState(false)

  const poids = apercu ?? normaliser(espace.map((p) => p.poids))

  const commencerGlissement = (e: React.PointerEvent, i: number) => {
    e.preventDefault()
    const cible = e.currentTarget as HTMLElement
    cible.setPointerCapture(e.pointerId)
    const largeur = conteneur.current?.clientWidth || 1
    const depart = e.clientX
    const base = normaliser(espace.map((p) => p.poids))
    const bouger = (ev: PointerEvent) => setApercu(redimensionner(base, i, (ev.clientX - depart) / largeur))
    const finir = (ev: PointerEvent) => {
      cible.removeEventListener('pointermove', bouger)
      cible.removeEventListener('pointerup', finir)
      const final = redimensionner(base, i, (ev.clientX - depart) / largeur)
      definirEspace(useStore.getState().espace.map((p, k) => ({ ...p, poids: final[k] })))
      setApercu(null)
    }
    cible.addEventListener('pointermove', bouger)
    cible.addEventListener('pointerup', finir)
  }

  return (
    <section className="espace">
      <header className="espace-barre">
        <h1>Espace de travail</h1>
        <div className="espace-actions">
          <span className="etiquette">Préréglages</span>
          {PRESETS.map((pr) => (
            <button key={pr.titre} className="bouton" onClick={() => definirEspace(pr.panes())}>{pr.titre}</button>
          ))}
          <div className="menu-ajout">
            <button className="bouton principal" disabled={espace.length >= MAX_PANES} onClick={() => setMenu(!menu)}>
              <Icone nom="plus" taille={14} /> Module
            </button>
            {menu && (
              <div className="menu-flottant ancre" onMouseLeave={() => setMenu(false)}>
                {(Object.keys(TYPES_PANE) as TypePane[]).map((t) => (
                  <button key={t} className="menu-item" onClick={() => { ajouterPane(t, t === 'page' ? pages[0]?.id ?? null : null); setMenu(false) }}>
                    <span className="menu-icone"><Icone nom={TYPES_PANE[t].icone} taille={15} /></span>
                    <span className="menu-titre">{TYPES_PANE[t].titre}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {!espace.length ? (
        <div className="espace-vide">
          <p className="etiquette">Aucun module ouvert</p>
          <p className="aide">Compose ton poste de travail : plusieurs modules côte à côte, redimensionnables.</p>
          <div className="ligne centre">
            {PRESETS.map((pr) => (
              <button key={pr.titre} className="bouton principal" onClick={() => definirEspace(pr.panes())}>{pr.titre}</button>
            ))}
          </div>
        </div>
      ) : (
        <div className="espace-rangee" ref={conteneur}>
          {espace.map((p, i) => (
            <div key={p.id} className="pane-groupe" style={{ flexGrow: poids[i], '--i': i } as CSSProperties}>
              <div className="pane">
                <header className="pane-entete">
                  <span className="voyant" />
                  <Icone nom={TYPES_PANE[p.type].icone} taille={15} />
                  <span className="pane-titre">{TYPES_PANE[p.type].titre}</span>
                  {p.type === 'page' && p.pageId && (
                    <SelecteurPage valeur={p.pageId} onChange={(v) => majPane(p.id, { pageId: v })} vide="Aucune page" />
                  )}
                  <span className="module-actions">
                    <button className="mini" title="Vers la gauche" disabled={i === 0} onClick={() => deplacerPane(p.id, -1)}><Icone nom="fleche" taille={13} style={{ transform: 'scaleX(-1)' }} /></button>
                    <button className="mini" title="Vers la droite" disabled={i === espace.length - 1} onClick={() => deplacerPane(p.id, 1)}><Icone nom="fleche" taille={13} /></button>
                    <button className="mini" title="Fermer" onClick={() => retirerPane(p.id)}><Icone nom="fermer" taille={13} /></button>
                  </span>
                </header>
                <div className="pane-corps"><ContenuPane p={p} /></div>
              </div>
              {i < espace.length - 1 && (
                <div className={'separateur' + (apercu ? ' actif' : '')} onPointerDown={(e) => commencerGlissement(e, i)} title="Glisser pour redimensionner" />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
