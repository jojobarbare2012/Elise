import { useState, type CSSProperties, type ReactNode } from 'react'
import { useStore } from '../lib/store'
import { Module } from './Module'
import { Icone } from './Icone'
import type { ModuleDispo } from '../lib/types'

export interface DefModule {
  titre: string
  icone: string
  rendu: () => ReactNode
  voyant?: () => 'ok' | 'alerte' | 'inactif'
}

/**
 * Grille de modules réorganisable (glisser, largeur 1 à 3, masquer), mémorisée par `cle`.
 * Utilisée par le tableau de bord, le planning, etc.
 */
export function GrilleModules({
  cle, defs, defaut,
}: { cle: string; defs: Record<string, DefModule>; defaut: ModuleDispo[] }) {
  const enregistree = useStore((s) => s.dispositions[cle])
  const majDisposition = useStore((s) => s.majDisposition)
  const [edition, setEdition] = useState(false)
  const [glisse, setGlisse] = useState<string | null>(null)

  // Ne garde que les modules connus ; ajoute ceux qui manqueraient (nouvelles versions).
  const base = enregistree ?? defaut
  const liste: ModuleDispo[] = [
    ...base.filter((d) => defs[d.id]),
    ...defaut.filter((d) => !base.some((x) => x.id === d.id)),
  ]
  const ecrire = (d: ModuleDispo[]) => majDisposition(cle, d)
  const maj = (id: string, champs: Partial<ModuleDispo>) => ecrire(liste.map((d) => (d.id === id ? { ...d, ...champs } : d)))
  const deplacer = (cibleId: string) => {
    if (!glisse || glisse === cibleId) return
    const source = liste.find((d) => d.id === glisse)!
    const sans = liste.filter((d) => d.id !== glisse)
    sans.splice(sans.findIndex((d) => d.id === cibleId), 0, source)
    ecrire(sans)
  }
  const visibles = liste.filter((d) => d.visible)
  const masques = liste.filter((d) => !d.visible)

  return (
    <>
      <div className="barre-modules">
        <button className={'bouton' + (edition ? ' principal' : '')} onClick={() => setEdition(!edition)}>
          <Icone nom="modules" taille={15} /> {edition ? 'Terminer' : 'Configurer les modules'}
        </button>
      </div>
      <div className={'grille-modules' + (edition ? ' edition' : '')}>
        {visibles.map((d, i) => {
          const def = defs[d.id]
          return (
            <div
              key={d.id}
              className={'cellule t' + d.taille + (glisse === d.id ? ' glisse' : '')}
              style={{ '--i': i } as CSSProperties}
              draggable={edition}
              onDragStart={() => setGlisse(d.id)}
              onDragEnd={() => setGlisse(null)}
              onDragOver={(e) => edition && e.preventDefault()}
              onDrop={() => deplacer(d.id)}
            >
              <Module
                titre={def.titre}
                icone={def.icone}
                voyant={def.voyant?.() ?? 'ok'}
                actions={edition && (
                  <>
                    {[1, 2, 3].map((t) => (
                      <button key={t} className={'mini' + (d.taille === t ? ' actif' : '')} title={`Largeur ${t}`} onClick={() => maj(d.id, { taille: t as 1 | 2 | 3 })}>{t}</button>
                    ))}
                    <button className="mini" title="Masquer" onClick={() => maj(d.id, { visible: false })}><Icone nom="oeil_barre" taille={14} /></button>
                    <span className="mini poignee" title="Glisser pour déplacer"><Icone nom="poignee" taille={14} /></span>
                  </>
                )}
              >
                {def.rendu()}
              </Module>
            </div>
          )
        })}
      </div>
      {edition && (
        <div className="plateau">
          <span className="etiquette">Modules masqués</span>
          {!masques.length && <span className="aide">aucun</span>}
          {masques.map((d) => (
            <button key={d.id} className="bouton" onClick={() => maj(d.id, { visible: true })}>
              <Icone nom="oeil" taille={14} /> {defs[d.id].titre}
            </button>
          ))}
          <button className="lien" onClick={() => ecrire(defaut)}>Disposition par défaut</button>
        </div>
      )}
    </>
  )
}
