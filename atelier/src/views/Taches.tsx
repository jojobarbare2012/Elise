import { useState } from 'react'
import { useStore, aujourdhui } from '../lib/store'
import { SelecteurPage } from '../components/SelecteurSource'
import type { Priorite, Statut, Tache } from '../lib/types'

const COLONNES: { statut: Statut; titre: string }[] = [
  { statut: 'a_faire', titre: 'À faire' },
  { statut: 'en_cours', titre: 'En cours' },
  { statut: 'fait', titre: 'Fait' },
]

function Carte({ t }: { t: Tache }) {
  const { pages, majTache, supprimerTache, aller } = useStore()
  const page = pages.find((p) => p.id === t.pageId)
  const enRetard = t.echeance && t.statut !== 'fait' && t.echeance < aujourdhui()
  return (
    <div className={'tache prio-' + t.priorite} draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}>
      <div className="tache-titre">{t.titre}</div>
      <div className="tache-meta">
        {t.echeance && <span className={enRetard ? 'retard' : ''}>📅 {new Date(t.echeance + 'T00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>}
        {page && <button className="lien" onClick={() => aller({ type: 'page', pageId: page.id })}>{page.icone} {page.titre}</button>}
        <select value={t.priorite} onChange={(e) => majTache(t.id, { priorite: e.target.value as Priorite })}>
          <option value="basse">Basse</option><option value="normale">Normale</option><option value="haute">Haute</option>
        </select>
        <button className="icone-btn" onClick={() => supprimerTache(t.id)}>🗑</button>
      </div>
    </div>
  )
}

export function Taches() {
  const { taches, ajouterTache, deplacerTache } = useStore()
  const [titre, setTitre] = useState('')
  const [echeance, setEcheance] = useState('')
  const [pageId, setPageId] = useState<string | null>(null)
  const [priorite, setPriorite] = useState<Priorite>('normale')

  const ajouter = () => {
    if (!titre.trim()) return
    ajouterTache({ titre: titre.trim(), statut: 'a_faire', priorite, echeance: echeance || null, pageId })
    setTitre(''); setEcheance('')
  }
  const ordre = { haute: 0, normale: 1, basse: 2 }

  return (
    <section className="vue large">
      <header className="vue-entete"><h1>Tâches</h1></header>
      <div className="formulaire">
        <input placeholder="Nouvelle tâche…" value={titre} onChange={(e) => setTitre(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ajouter()} />
        <input type="date" value={echeance} onChange={(e) => setEcheance(e.target.value)} />
        <select value={priorite} onChange={(e) => setPriorite(e.target.value as Priorite)}>
          <option value="basse">Basse</option><option value="normale">Normale</option><option value="haute">Haute</option>
        </select>
        <SelecteurPage valeur={pageId} onChange={setPageId} vide="Sans matière" />
        <button className="bouton principal" onClick={ajouter}>Ajouter</button>
      </div>
      <div className="kanban">
        {COLONNES.map((col) => (
          <div key={col.statut} className="colonne"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { const id = e.dataTransfer.getData('text/plain'); if (id) deplacerTache(id, col.statut) }}>
            <h3>{col.titre} <span className="badge">{taches.filter((t) => t.statut === col.statut).length}</span></h3>
            {taches
              .filter((t) => t.statut === col.statut)
              .sort((a, b) => ordre[a.priorite] - ordre[b.priorite] || (a.echeance ?? '9').localeCompare(b.echeance ?? '9'))
              .map((t) => <Carte key={t.id} t={t} />)}
          </div>
        ))}
      </div>
    </section>
  )
}
