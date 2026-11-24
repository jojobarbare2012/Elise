import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { estDue, libelleIntervalle, type Note } from '../lib/sm2'
import { cartesEcrites, coursDe, descendantes, texteDe } from '../lib/texte'
import { genererCartes } from '../lib/llm'
import { SelecteurPage } from '../components/SelecteurSource'

const NOTES: { note: Note; titre: string }[] = [
  { note: 'encore', titre: 'À revoir' },
  { note: 'difficile', titre: 'Difficile' },
  { note: 'bien', titre: 'Bien' },
  { note: 'facile', titre: 'Facile' },
]

export function Cartes() {
  const { cartes, pages, reglages, ajouterCartes, noterCarte, supprimerCarte } = useStore()
  const [filtre, setFiltre] = useState<string | null>(null)
  const [revele, setRevele] = useState(false)
  const [mode, setMode] = useState<'revision' | 'gestion'>('revision')
  const [recto, setRecto] = useState('')
  const [verso, setVerso] = useState('')
  const [occupe, setOccupe] = useState(false)
  const [info, setInfo] = useState('')

  const portee = useMemo(() => {
    if (!filtre) return cartes
    const ids = new Set(descendantes(pages, filtre).map((p) => p.id))
    return cartes.filter((c) => c.pageId && ids.has(c.pageId))
  }, [cartes, pages, filtre])

  const dues = useMemo(() => portee.filter((c) => estDue(c)).sort((a, b) => a.echeance - b.echeance), [portee])
  const courante = dues[0]

  const importerDepuis = () => {
    if (!filtre) return setInfo('Choisis d’abord une page ou une matière.')
    let total = 0
    for (const p of descendantes(pages, filtre)) total += ajouterCartes(cartesEcrites(texteDe(p.contenu)), p.id)
    setInfo(total ? `${total} carte(s) importée(s).` : 'Aucune nouvelle carte « Question :: Réponse » trouvée.')
  }

  const generer = async () => {
    if (!filtre) return setInfo('Choisis d’abord une page ou une matière.')
    const cours = coursDe(pages, filtre)
    if (cours.length < 40) return setInfo('Le cours est trop court pour générer des cartes.')
    setOccupe(true); setInfo('Génération en cours…')
    try {
      const nouvelles = await genererCartes(reglages.modele, pages.find((p) => p.id === filtre)?.titre ?? '', cours, 10)
      setInfo(`${ajouterCartes(nouvelles, filtre)} carte(s) générée(s).`)
    } catch (e) {
      setInfo((e as Error).message)
    } finally {
      setOccupe(false)
    }
  }

  return (
    <section className="vue">
      <header className="vue-entete">
        <h1>Cartes</h1>
        <div className="onglets">
          <button className={mode === 'revision' ? 'actif' : ''} onClick={() => setMode('revision')}>Révision ({dues.length})</button>
          <button className={mode === 'gestion' ? 'actif' : ''} onClick={() => setMode('gestion')}>Gérer ({portee.length})</button>
        </div>
        <SelecteurPage valeur={filtre} onChange={(v) => { setFiltre(v); setRevele(false) }} vide="Toutes les matières" />
      </header>

      {mode === 'revision' ? (
        courante ? (
          <div className="carte-zone">
            <div className="flashcard" onClick={() => setRevele(true)}>
              <div className="flashcard-face">{courante.recto}</div>
              {revele && <div className="flashcard-verso">{courante.verso}</div>}
              {!revele && <div className="aide">Clique pour afficher la réponse</div>}
            </div>
            {revele ? (
              <div className="notes">
                {NOTES.map((n) => (
                  <button key={n.note} className={'bouton note-' + n.note}
                    onClick={() => { noterCarte(courante.id, n.note); setRevele(false) }}>
                    {n.titre}<small>{libelleIntervalle(courante, n.note)}</small>
                  </button>
                ))}
              </div>
            ) : (
              <button className="bouton principal" onClick={() => setRevele(true)}>Afficher la réponse</button>
            )}
          </div>
        ) : (
          <div className="vide-grand">
            <p>🎉 Plus aucune carte à réviser{filtre ? ' dans cette matière' : ''}.</p>
            {portee.length === 0 && <p className="aide">Crée des cartes dans l’onglet « Gérer ».</p>}
          </div>
        )
      ) : (
        <div className="gestion">
          <div className="formulaire">
            <input placeholder="Recto (question)" value={recto} onChange={(e) => setRecto(e.target.value)} />
            <input placeholder="Verso (réponse)" value={verso} onChange={(e) => setVerso(e.target.value)} />
            <button className="bouton principal" disabled={!recto.trim() || !verso.trim()}
              onClick={() => { ajouterCartes([{ recto: recto.trim(), verso: verso.trim() }], filtre); setRecto(''); setVerso('') }}>
              Ajouter
            </button>
          </div>
          <div className="ligne">
            <button className="bouton" onClick={importerDepuis}>Importer les « Question :: Réponse »</button>
            <button className="bouton" disabled={occupe} onClick={generer}>✨ Générer avec l’IA</button>
            {info && <span className="aide">{info}</span>}
          </div>
          <table className="table">
            <thead><tr><th>Recto</th><th>Verso</th><th>Prochaine</th><th /></tr></thead>
            <tbody>
              {portee.map((c) => (
                <tr key={c.id}>
                  <td>{c.recto}</td><td>{c.verso}</td>
                  <td>{estDue(c) ? 'maintenant' : new Date(c.echeance).toLocaleDateString('fr-FR')}</td>
                  <td><button className="icone-btn" onClick={() => supprimerCarte(c.id)}>🗑</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
