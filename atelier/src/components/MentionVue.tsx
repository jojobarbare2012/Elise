import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useStore } from '../lib/store'

/** Lien « @ » vers une page : affiche toujours son titre actuel (et signale une page supprimée). */
export function MentionVue({ node }: NodeViewProps) {
  const id = String(node.attrs.id ?? '')
  const page = useStore((s) => s.pages.find((p) => p.id === id))
  const titre = page ? page.titre || 'Sans titre' : `${node.attrs.label ?? 'Page'} (supprimée)`
  return (
    <NodeViewWrapper as="span" className={'mention-page' + (page ? '' : ' cassee')} data-type="mention" data-id={id} contentEditable={false}>
      {titre}
    </NodeViewWrapper>
  )
}
