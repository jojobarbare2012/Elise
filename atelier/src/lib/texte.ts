import type { JSONContent } from '@tiptap/react'
import type { Page } from './types'

const BLOCS = new Set([
  'paragraph', 'heading', 'listItem', 'taskItem', 'blockquote', 'codeBlock',
  'tableRow', 'horizontalRule',
])

/** Texte brut d'un document Tiptap (une ligne par bloc). */
export function texteDe(noeud: JSONContent | null | undefined): string {
  if (!noeud) return ''
  let sortie = ''
  const parcourir = (n: JSONContent) => {
    if (n.type === 'text') sortie += n.text ?? ''
    else if (n.type === 'mention') sortie += n.attrs?.label ?? ''
    else if (n.type === 'hardBreak') sortie += '\n'
    n.content?.forEach(parcourir)
    if (n.type && BLOCS.has(n.type)) sortie += '\n'
    else if (n.type === 'tableCell' || n.type === 'tableHeader') sortie += ' | '
  }
  parcourir(noeud)
  return sortie.replace(/\n{3,}/g, '\n\n').trim()
}

/** Identifiants des pages liées (mentions) dans un document. */
export function liensDe(noeud: JSONContent | null | undefined): string[] {
  const ids: string[] = []
  const parcourir = (n: JSONContent) => {
    if (n.type === 'mention' && n.attrs?.id) ids.push(String(n.attrs.id))
    n.content?.forEach(parcourir)
  }
  if (noeud) parcourir(noeud)
  return ids
}

/** La page et toutes ses descendantes. */
export function descendantes(pages: Page[], racineId: string): Page[] {
  const resultat: Page[] = []
  const pile = [racineId]
  while (pile.length) {
    const id = pile.pop()!
    const page = pages.find((p) => p.id === id)
    if (page) resultat.push(page)
    pages.filter((p) => p.parentId === id).forEach((p) => pile.push(p.id))
  }
  return resultat
}

/** Chaîne des parents d'une page, du plus lointain au plus proche (sans la page elle-même). */
export function ancetres(pages: Page[], pageId: string): Page[] {
  const chaine: Page[] = []
  const vus = new Set<string>([pageId])
  let courant = pages.find((p) => p.id === pageId)
  while (courant?.parentId && !vus.has(courant.parentId)) {
    vus.add(courant.parentId)
    courant = pages.find((p) => p.id === courant!.parentId)
    if (courant) chaine.unshift(courant)
  }
  return chaine
}

/** Texte concaténé d'une page et de ses sous-pages (cours d'une matière). */
export function coursDe(pages: Page[], racineId: string): string {
  return descendantes(pages, racineId)
    .map((p) => `# ${p.titre}\n${texteDe(p.contenu)}`)
    .join('\n\n')
    .trim()
}

/** Cartes écrites dans une page au format « Question :: Réponse ». */
export function cartesEcrites(texte: string): { recto: string; verso: string }[] {
  const cartes: { recto: string; verso: string }[] = []
  for (const ligne of texte.split('\n')) {
    const i = ligne.indexOf('::')
    if (i < 1) continue
    const recto = ligne.slice(0, i).trim()
    const verso = ligne.slice(i + 2).trim()
    if (recto && verso) cartes.push({ recto, verso })
  }
  return cartes
}

export function extrait(texte: string, requete: string, largeur = 60): string {
  const i = texte.toLowerCase().indexOf(requete.toLowerCase())
  if (i < 0) return texte.slice(0, largeur * 2)
  const debut = Math.max(0, i - largeur)
  return (debut > 0 ? '…' : '') + texte.slice(debut, i + requete.length + largeur).replace(/\n/g, ' ')
}
