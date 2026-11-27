import { useEffect, useMemo, useRef, useState } from 'react'
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
import { ancetres, descendantes, liensDe } from '../lib/texte'
import { SelecteurPage } from './SelecteurSource'
import { ImportCours } from './ImportCours'
import { CommandeSlash, mentionPages } from './extensions'
import type { Page } from '../lib/types'
import { Icone, ICONES_PAGE } from './Icone'


export function PageEditeur({ page }: { page: Page }) {
  const majContenu = useStore((s) => s.majContenu)
  const majPage = useStore((s) => s.majPage)
  const aller = useStore((s) => s.aller)
  const ouvrirDansEspace = useStore((s) => s.ouvrirDansEspace)
  const creerPage = useStore((s) => s.creerPage)
  const [importer, setImporter] = useState(false)
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
      CommandeSlash.configure({ pageId: page.id }),
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

  const chemin = useMemo(() => ancetres(pages, page.id), [pages, page.id])
  const sousPages = useMemo(() => pages.filter((p) => p.parentId === page.id), [pages, page.id])
  // Une page ne peut pas être déplacée dans elle-même ni dans l'une de ses sous-pages.
  const interdits = useMemo(() => new Set(descendantes(pages, page.id).map((p) => p.id)), [pages, page.id])

  const clicContenu = (e: React.MouseEvent) => {
    const cible = (e.target as HTMLElement).closest('[data-type="mention"]') as HTMLElement | null
    const lien = cible?.dataset.id
    if (lien && useStore.getState().pages.some((p) => p.id === lien)) aller({ type: 'page', pageId: lien })
  }

  return (
    <article className="page-editeur">
      {chemin.length > 0 && (
        <nav className="fil" aria-label="Emplacement">
          {chemin.map((a) => (
            <span key={a.id}>
              <button className="lien" onClick={() => aller({ type: 'page', pageId: a.id })}>{a.titre || 'Sans titre'}</button>
              <span className="fil-sep">/</span>
            </span>
          ))}
          <span className="fil-courant">{page.titre || 'Sans titre'}</span>
        </nav>
      )}
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
        <button className="bouton" title="Ouvrir dans l'espace de travail" onClick={() => ouvrirDansEspace(page.id)}>
          <Icone nom="modules" taille={14} /> Espace
        </button>
      </div>
      <div className="sous-pages">
        <span className="etiquette">Sous-pages</span>
        {sousPages.map((p) => (
          <button key={p.id} className="puce" onClick={() => aller({ type: 'page', pageId: p.id })}>
            <Icone nom={p.icone} taille={14} /> {p.titre || 'Sans titre'}
          </button>
        ))}
        <button className="puce ajout" onClick={() => creerPage(page.id)}>
          <Icone nom="plus" taille={13} /> {sousPages.length ? 'Sous-page' : 'Ajouter une sous-page (chapitre…)'}
        </button>
        <button className="puce ajout" onClick={() => setImporter(true)}>
          <Icone nom="livre" taille={13} /> Importer un cours ici
        </button>
        {importer && <ImportCours parentInitial={page.id} onFermer={() => setImporter(false)} />}
        <span className="deplacer">
          <span className="etiquette">Dans</span>
          <SelecteurPage
            valeur={page.parentId}
            onChange={(v) => majPage(page.id, { parentId: v })}
            vide="Racine (matière)"
            exclure={interdits}
          />
        </span>
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
