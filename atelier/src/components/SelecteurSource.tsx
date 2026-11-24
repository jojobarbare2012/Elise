import { useStore } from '../lib/store'

/** Liste déroulante des pages, indentées selon leur profondeur. */
export function SelecteurPage({
  valeur, onChange, vide, exclure,
}: { valeur: string | null; onChange: (id: string | null) => void; vide: string; exclure?: Set<string> }) {
  const pages = useStore((s) => s.pages)
  const lignes: { id: string; libelle: string }[] = []
  const ajouter = (parentId: string | null, niveau: number) => {
    for (const p of pages.filter((x) => x.parentId === parentId && !exclure?.has(x.id))) {
      lignes.push({ id: p.id, libelle: `${'— '.repeat(niveau)}${p.titre || 'Sans titre'}` })
      ajouter(p.id, niveau + 1)
    }
  }
  ajouter(null, 0)
  return (
    <select value={valeur ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{vide}</option>
      {lignes.map((l) => <option key={l.id} value={l.id}>{l.libelle}</option>)}
    </select>
  )
}
