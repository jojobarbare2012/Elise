import { useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { configIA, ErreurLLM, etatClaude, importerCours, TAILLE_MAX_IMPORT, TYPES_IMPORT } from '../lib/llm'
import { lireBase64 } from '../lib/importCours'
import { SelecteurPage } from './SelecteurSource'
import { Icone } from './Icone'

/** Dialogue : un PDF ou des photos de pages -> une nouvelle page de cours, transcrite par Claude. */
export function ImportCours({ parentInitial, onFermer }: { parentInitial: string | null; onFermer: () => void }) {
  const reglages = useStore((s) => s.reglages)
  const creerPageImportee = useStore((s) => s.creerPageImportee)
  const [fichiers, setFichiers] = useState<File[]>([])
  const [parentId, setParentId] = useState<string | null>(parentInitial)
  const [etat, setEtat] = useState<'choix' | 'envoi' | 'erreur'>('choix')
  const [message, setMessage] = useState('')
  const entree = useRef<HTMLInputElement>(null)
  const ia = configIA(reglages)
  const taille = fichiers.reduce((n, f) => n + f.size, 0)

  const choisir = (liste: FileList | null) => {
    const ok = Array.from(liste ?? []).filter((f) => TYPES_IMPORT.includes(f.type))
    const refuses = (liste?.length ?? 0) - ok.length
    setFichiers((avant) => [...avant, ...ok].slice(0, 20))
    setMessage(refuses ? `${refuses} fichier(s) ignoré(s) : seuls les PDF et les images (JPEG, PNG, WebP) sont acceptés.` : '')
    setEtat('choix')
  }

  const lancer = async () => {
    if (!fichiers.length) return
    if (taille > TAILLE_MAX_IMPORT) { setEtat('erreur'); setMessage('Trop volumineux (24 Mo maximum) : importe le cours en plusieurs fois.'); return }
    setEtat('envoi')
    if (!(await etatClaude())) {
      setEtat('erreur')
      setMessage('Aucune clé API Anthropic configurée : crée le fichier atelier/.env contenant ANTHROPIC_API_KEY=sk-ant-…, puis relance « npm run dev ».')
      return
    }
    setMessage('Claude lit le document et le met en page… (de 30 s à quelques minutes pour un long PDF)')
    try {
      const documents = await Promise.all(fichiers.map(async (f) => ({ media_type: f.type, data: await lireBase64(f) })))
      const { titre, contenu } = await importerCours(ia, documents)
      creerPageImportee(titre, contenu, parentId)
      onFermer()
    } catch (e) {
      setEtat('erreur')
      setMessage(e instanceof ErreurLLM ? e.message : 'Lecture du fichier impossible.')
    }
  }

  return (
    <div className="voile" onMouseDown={etat === 'envoi' ? undefined : onFermer}>
      <div className="dialogue" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Importer un cours</h2>
        {ia.fournisseur !== 'claude' ? (
          <p className="erreur">L’import de PDF et de photos nécessite Claude (à choisir dans les Réglages).</p>
        ) : (
          <>
            <p className="aide">Un PDF ou des photos de pages : Claude transcrit le cours (titres, listes, tableaux, chiffres) dans une nouvelle page.</p>
            <div
              className="depot"
              onClick={() => entree.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); choisir(e.dataTransfer.files) }}
            >
              <Icone nom="plus" taille={20} />
              <span>Choisir ou déposer des fichiers</span>
              <span className="aide">PDF, JPEG, PNG, WebP · 24 Mo au total</span>
            </div>
            <input ref={entree} type="file" multiple accept={TYPES_IMPORT.join(',')} capture="environment" hidden
              onChange={(e) => { choisir(e.target.files); e.target.value = '' }} />
            {fichiers.length > 0 && (
              <ul className="liste-fichiers">
                {fichiers.map((f, i) => (
                  <li key={i}>
                    <span>{f.name}</span>
                    <span className="mono">{(f.size / 1024 / 1024).toFixed(1)} Mo</span>
                    {etat !== 'envoi' && <button className="icone-btn" title="Retirer" onClick={() => setFichiers(fichiers.filter((_, k) => k !== i))}><Icone nom="fermer" taille={13} /></button>}
                  </li>
                ))}
              </ul>
            )}
            <label>
              Ranger dans
              <SelecteurPage valeur={parentId} onChange={setParentId} vide="Racine (nouvelle matière)" />
            </label>
            <p className="aide">Le contenu des fichiers est envoyé à Anthropic.</p>
          </>
        )}
        {message && <p className={etat === 'erreur' ? 'erreur' : 'aide'}>{message}</p>}
        <div className="ligne fin">
          <button className="bouton" disabled={etat === 'envoi'} onClick={onFermer}>Annuler</button>
          {ia.fournisseur === 'claude' && (
            <button className="bouton principal" disabled={!fichiers.length || etat === 'envoi'} onClick={lancer}>
              {etat === 'envoi' ? 'Lecture en cours…' : 'Importer'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
