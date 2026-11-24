import type { ReactNode } from 'react'
import { Icone } from './Icone'

/** Panneau HUD : cadre à coins, en-tête à voyant, contenu. Brique de base de toute l'interface. */
export function Module({
  titre, icone, voyant = 'ok', actions, children, className = '',
}: {
  titre: string
  icone?: string
  voyant?: 'ok' | 'alerte' | 'inactif'
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={'module ' + className}>
      <header className="module-entete">
        <span className={'voyant ' + voyant} />
        {icone && <Icone nom={icone} taille={15} />}
        <h2>{titre}</h2>
        <span className="module-actions">{actions}</span>
      </header>
      <div className="module-corps">{children}</div>
    </section>
  )
}
