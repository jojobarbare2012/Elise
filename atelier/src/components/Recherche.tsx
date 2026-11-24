import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { extrait, texteDe } from '../lib/texte'

interface Resultat {
  cle: string
  icone: string
  titre: string
  detail: string
  ouvrir: () => void
}

export function Recherche({ onFermer }: { onFermer: () => void }) {
  const { pages, cartes, taches, qcms, aller } = useStore()
  const [q, setQ] = useState('')
  const [actif, setActif] = useState(0)
  const champ = useRef<HTMLInputElement>(null)
  useEffect(() => champ.current?.focus(), [])

  const resultats = useMemo<Resultat[]>(() => {
    const requete = q.trim()
    if (!requete) {
      return [...pages]
        .sort((a, b) => b.modifieLe - a.modifieLe)
        .slice(0, 8)
        .map((p) => ({ cle: p.id, icone: p.icone, titre: p.titre || 'Sans titre', detail: 'Récent', ouvrir: () => aller({ type: 'page', pageId: p.id }) }))
    }
    const minuscule = requete.toLowerCase()
    const sortie: Resultat[] = []
    for (const p of pages) {
      const texte = texteDe(p.contenu)
      const dansTitre = p.titre.toLowerCase().includes(minuscule)
      if (dansTitre || texte.toLowerCase().includes(minuscule)) {
        sortie.push({
          cle: p.id, icone: p.icone, titre: p.titre || 'Sans titre',
          detail: dansTitre ? 'Titre' : extrait(texte, requete),
          ouvrir: () => aller({ type: 'page', pageId: p.id }),
        })
      }
    }
    cartes.filter((c) => (c.recto + c.verso).toLowerCase().includes(minuscule)).slice(0, 5)
      .forEach((c) => sortie.push({ cle: c.id, icone: '🃏', titre: c.recto, detail: c.verso, ouvrir: () => aller({ type: 'cartes' }) }))
    taches.filter((t) => t.titre.toLowerCase().includes(minuscule)).slice(0, 5)
      .forEach((t) => sortie.push({ cle: t.id, icone: '🗂', titre: t.titre, detail: 'Tâche', ouvrir: () => aller({ type: 'taches' }) }))
    qcms.filter((x) => x.titre.toLowerCase().includes(minuscule)).slice(0, 3)
      .forEach((x) => sortie.push({ cle: x.id, icone: '✅', titre: x.titre, detail: 'QCM', ouvrir: () => aller({ type: 'qcm' }) }))
    return sortie.slice(0, 12)
  }, [q, pages, cartes, taches, qcms, aller])

  const choisir = (r?: Resultat) => { if (r) { r.ouvrir(); onFermer() } }

  return (
    <div className="voile" onMouseDown={onFermer}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={champ}
          value={q}
          placeholder="Chercher dans les pages, cartes, tâches, QCM…"
          onChange={(e) => { setQ(e.target.value); setActif(0) }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onFermer()
            else if (e.key === 'ArrowDown') { e.preventDefault(); setActif(Math.min(actif + 1, resultats.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActif(Math.max(actif - 1, 0)) }
            else if (e.key === 'Enter') choisir(resultats[actif])
          }}
        />
        <div className="palette-liste">
          {resultats.map((r, i) => (
            <button key={r.cle} className={'menu-item' + (i === actif ? ' actif' : '')} onMouseEnter={() => setActif(i)} onClick={() => choisir(r)}>
              <span className="menu-icone">{r.icone}</span>
              <span><span className="menu-titre">{r.titre}</span><span className="menu-detail">{r.detail}</span></span>
            </button>
          ))}
          {!resultats.length && <div className="menu-vide">Aucun résultat</div>}
        </div>
      </div>
    </div>
  )
}
