import { Extension, type Editor, type Range } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import Mention from '@tiptap/extension-mention'
import { rendreMenu, type ElementMenu } from './menuSuggestion'
import type { Page } from '../lib/types'

interface CommandeBloc extends ElementMenu {
  mots: string
  executer: (editor: Editor, range: Range) => void
}

const COMMANDES: CommandeBloc[] = [
  { icone: 'H1', titre: 'Titre 1', mots: 'titre h1', executer: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 1 }).run() },
  { icone: 'H2', titre: 'Titre 2', mots: 'titre h2', executer: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 2 }).run() },
  { icone: 'H3', titre: 'Titre 3', mots: 'titre h3', executer: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 3 }).run() },
  { icone: '•', titre: 'Liste à puces', mots: 'liste puces', executer: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { icone: '1.', titre: 'Liste numérotée', mots: 'liste numerotee', executer: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { icone: '☑', titre: 'Liste de tâches', mots: 'taches todo cases', executer: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { icone: '❝', titre: 'Citation', mots: 'citation quote', executer: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { icone: '</>', titre: 'Bloc de code', mots: 'code', executer: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { icone: '▦', titre: 'Tableau', mots: 'tableau table', executer: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { icone: '—', titre: 'Séparateur', mots: 'separateur ligne', executer: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  { icone: '?', titre: 'Carte à retenir', detail: 'Ligne « Question :: Réponse »', mots: 'carte flashcard question', executer: (e, r) => e.chain().focus().deleteRange(r).insertContent('Question :: Réponse').run() },
]

const retirerAccents = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

export const CommandeSlash = Extension.create({
  name: 'commandeSlash',
  addProseMirrorPlugins() {
    return [
      Suggestion<CommandeBloc>({
        editor: this.editor,
        pluginKey: new PluginKey('slash'),
        char: '/',
        startOfLine: false,
        allowSpaces: false,
        items: ({ query }) => {
          const q = retirerAccents(query)
          return COMMANDES.filter((c) => retirerAccents(c.titre + ' ' + c.mots).includes(q)).slice(0, 10)
        },
        command: ({ editor, range, props }) => props.executer(editor, range),
        render: rendreMenu,
      }),
    ]
  },
})

/** Mentions « @ » : lien vers une autre page. `lirePages` renvoie les pages à jour. */
export function mentionPages(lirePages: () => Page[]) {
  return Mention.configure({
    HTMLAttributes: { class: 'mention-page' },
    renderHTML: ({ node, options }) => [
      'span',
      { ...options.HTMLAttributes, 'data-type': 'mention', 'data-id': node.attrs.id },
      `📄 ${node.attrs.label}`,
    ],
    suggestion: {
      char: '@',
      pluginKey: new PluginKey('mention-page'),
      items: ({ query }: { query: string }) => {
        const q = retirerAccents(query)
        return lirePages()
          .filter((p) => retirerAccents(p.titre || 'sans titre').includes(q))
          .slice(0, 8)
          .map((p) => ({ id: p.id, label: p.titre || 'Sans titre', titre: p.titre || 'Sans titre', icone: p.icone }))
      },
      render: rendreMenu,
      command: ({ editor, range, props }: { editor: Editor; range: Range; props: { id: string | null; label?: string | null } }) => {
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            { type: 'mention', attrs: { id: props.id, label: props.label } },
            { type: 'text', text: ' ' },
          ])
          .run()
      },
    },
  })
}
