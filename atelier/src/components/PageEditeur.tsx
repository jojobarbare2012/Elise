import { useEffect, useMemo, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { useStore } from '../lib/store'
import { liensDe } from '../lib/texte'
import { CommandeSlash, mentionPages } from './extensions'
import type { Page } from '../lib/types'
import { Icone, ICONES_PAGE } from './Icone'


export function PageEditeur({ page }: { page: Page }) {
  const majContenu = useStore((s) => s.majContenu)
  const majPage = useStore((s) => s.majPage)
  const aller = useStore((s) => s.aller)
  const pages = useStore((s) => s.pages)
  const minuteur = useRef<number>()

  const extensions = useMemo(
    () => [
      StarterKit,
      Placeholder.configure({ placeholder: "Écris, ou tape « / » pour insérer un bloc…" }),
      Link.configure({ openOnClick: false, autolink: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      CommandeSlash,
      mentionPages(() => useStore.getState().pages.filter((p) => p.id !== page.id)),
    ],
    [page.id],
  )

  const editeur = useEditor(
    {
      extensions,
      content: page.contenu ?? undefined,
      onUpdate: ({ editor }) => {
        window.clearTimeout(minuteur.current)
        const json = editor.getJSON()
        minuteur.current = window.setTimeout(() => majContenu(page.id, json), 400)
      },
    },
    [page.id],
  )

  // Sauvegarde immédiate en quittant la page.
  useEffect(
    () => () => {
      if (minuteur.current && editeur && !editeur.isDestroyed) {
        window.clearTimeout(minuteur.current)
        majContenu(page.id, editeur.getJSON())
      }
    },
    [editeur, page.id, majContenu],
  )

  const retroliens = useMemo(
    () => pages.filter((p) => p.id !== page.id && liensDe(p.contenu).includes(page.id)),
    [pages, page.id],
  )

  const clicContenu = (e: React.MouseEvent) => {
    const cible = (e.target as HTMLElement).closest('[data-type="mention"]') as HTMLElement | null
    const lien = cible?.dataset.id
    if (lien && useStore.getState().pages.some((p) => p.id === lien)) aller({ type: 'page', pageId: lien })
  }

  return (
    <article className="page-editeur">
      <div className="page-entete">
        <button
          className="page-icone"
          title="Changer l'icône"
          onClick={() => majPage(page.id, { icone: ICONES_PAGE[(ICONES_PAGE.indexOf(page.icone) + 1) % ICONES_PAGE.length] })}
        >
          <Icone nom={page.icone} taille={34} />
        </button>
        <input
          className="page-titre"
          value={page.titre}
          placeholder="Sans titre"
          onChange={(e) => majPage(page.id, { titre: e.target.value })}
        />
      </div>
      <div onClick={clicContenu}>
        <EditorContent editor={editeur} className="zone-edition" />
      </div>
      {retroliens.length > 0 && (
        <footer className="retroliens">
          <h4>Mentionnée dans</h4>
          {retroliens.map((p) => (
            <button key={p.id} className="lien" onClick={() => aller({ type: 'page', pageId: p.id })}>
              <Icone nom={p.icone} taille={14} /> {p.titre || 'Sans titre'}
            </button>
          ))}
        </footer>
      )}
    </article>
  )
}
