import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { ReactRenderer } from '@tiptap/react'
import { Icone } from './Icone'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'

export interface ElementMenu {
  titre: string
  detail?: string
  icone?: string
}

interface Props {
  items: ElementMenu[]
  command: (item: ElementMenu) => void
}
export interface RefMenu {
  onKeyDown: (p: SuggestionKeyDownProps) => boolean
}

const ListeMenu = forwardRef<RefMenu, Props>(({ items, command }, ref) => {
  const [actif, setActif] = useState(0)
  useEffect(() => setActif(0), [items])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false
      if (event.key === 'ArrowUp') { setActif((actif + items.length - 1) % items.length); return true }
      if (event.key === 'ArrowDown') { setActif((actif + 1) % items.length); return true }
      if (event.key === 'Enter') { command(items[actif]); return true }
      return false
    },
  }))

  if (!items.length) return <div className="menu-flottant"><div className="menu-vide">Aucun résultat</div></div>
  return (
    <div className="menu-flottant">
      {items.map((item, i) => (
        <button
          key={item.titre + i}
          className={'menu-item' + (i === actif ? ' actif' : '')}
          onMouseEnter={() => setActif(i)}
          onMouseDown={(e) => { e.preventDefault(); command(item) }}
        >
          <span className="menu-icone">{item.icone && <Icone nom={item.icone} taille={15} />}</span>
          <span>
            <span className="menu-titre">{item.titre}</span>
            {item.detail && <span className="menu-detail">{item.detail}</span>}
          </span>
        </button>
      ))}
    </div>
  )
})

/** Rendu générique d'un menu de suggestion (slash, mentions) sans dépendance popup. */
export function rendreMenu() {
  let composant: ReactRenderer<RefMenu, Props> | null = null
  const placer = (props: SuggestionProps) => {
    const rect = props.clientRect?.()
    if (!rect || !composant) return
    const el = composant.element as HTMLElement
    el.style.position = 'fixed'
    el.style.left = `${Math.min(rect.left, window.innerWidth - 300)}px`
    el.style.top = `${rect.bottom + 6}px`
    el.style.zIndex = '60'
  }
  return {
    onStart: (props: SuggestionProps) => {
      composant = new ReactRenderer(ListeMenu, { props, editor: props.editor })
      document.body.appendChild(composant.element)
      placer(props)
    },
    onUpdate: (props: SuggestionProps) => {
      composant?.updateProps(props)
      placer(props)
    },
    onKeyDown: (props: SuggestionKeyDownProps) => {
      if (props.event.key === 'Escape') { composant?.element.remove(); return true }
      return composant?.ref?.onKeyDown(props) ?? false
    },
    onExit: () => {
      composant?.element.remove()
      composant?.destroy()
      composant = null
    },
  }
}
