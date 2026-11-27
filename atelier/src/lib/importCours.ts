import type { JSONContent } from '@tiptap/react'

/** Bloc de cours tel que Claude le transcrit depuis un PDF ou une photo. */
export interface BlocImporte {
  type: 'titre' | 'paragraphe' | 'liste' | 'liste_numerotee' | 'encadre' | 'tableau'
  niveau: number
  texte: string
  elements: string[]
  lignes: string[][]
}

const texte = (t: string): JSONContent[] => (t.trim() ? [{ type: 'text', text: t.trim() }] : [])
const paragraphe = (t: string): JSONContent => ({ type: 'paragraph', content: texte(t) })

/** Convertit les blocs importés en document Tiptap (ce que l'éditeur affiche). Ignore ce qui est vide ou mal formé. */
export function blocsVersDoc(blocs: unknown): JSONContent {
  const contenu: JSONContent[] = []
  for (const b of Array.isArray(blocs) ? (blocs as Partial<BlocImporte>[]) : []) {
    if (!b || typeof b !== 'object') continue
    const t = typeof b.texte === 'string' ? b.texte : ''
    const elements = Array.isArray(b.elements) ? b.elements.filter((e): e is string => typeof e === 'string' && e.trim() !== '') : []
    switch (b.type) {
      case 'titre':
        if (t.trim()) contenu.push({ type: 'heading', attrs: { level: Math.min(3, Math.max(1, Math.round(Number(b.niveau) || 2))) }, content: texte(t) })
        break
      case 'paragraphe':
        if (t.trim()) contenu.push(paragraphe(t))
        break
      case 'encadre':
        if (t.trim()) contenu.push({ type: 'blockquote', content: [paragraphe(t)] })
        break
      case 'liste':
      case 'liste_numerotee':
        if (t.trim()) contenu.push(paragraphe(t))
        if (elements.length) {
          contenu.push({
            type: b.type === 'liste' ? 'bulletList' : 'orderedList',
            content: elements.map((e) => ({ type: 'listItem', content: [paragraphe(e)] })),
          })
        }
        break
      case 'tableau': {
        const lignes = (Array.isArray(b.lignes) ? b.lignes : [])
          .filter((l): l is string[] => Array.isArray(l))
          .map((l) => l.map((c) => (typeof c === 'string' ? c : '')))
          .filter((l) => l.some((c) => c.trim()))
        if (!lignes.length) break
        const largeur = Math.max(...lignes.map((l) => l.length))
        if (t.trim()) contenu.push(paragraphe(t))
        contenu.push({
          type: 'table',
          content: lignes.map((l, i) => ({
            type: 'tableRow',
            content: Array.from({ length: largeur }, (_, k) => ({
              type: i === 0 ? 'tableHeader' : 'tableCell',
              content: [paragraphe(l[k] ?? '')],
            })),
          })),
        })
        break
      }
    }
  }
  return { type: 'doc', content: contenu.length ? contenu : [{ type: 'paragraph' }] }
}

/** Lit un fichier en base64 (sans l'en-tête data:). */
export function lireBase64(fichier: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader()
    lecteur.onload = () => resolve(String(lecteur.result).replace(/^data:[^,]*,/, ''))
    lecteur.onerror = () => reject(lecteur.error)
    lecteur.readAsDataURL(fichier)
  })
}
