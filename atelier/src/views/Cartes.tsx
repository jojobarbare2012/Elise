import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { estDue, libelleIntervalle, type Note } from '../lib/sm2'
import { cartesEcrites, coursDe, descendantes, texteDe } from '../lib/texte'
import { configIA, coursTronque, genererCartes } from '../lib/llm'
import { Icone } from '../components/Icone'
import { SelecteurPage } from '../components/SelecteurSource'

const LIBELLE_NATURE: Record<string, string> = { definition: 'Déf.', valeur: 'Valeur', fait: 'Fait', libre: '—' }

const NOTES: { note: Note; titre: string }[] = [
  { note: 'encore', titre: 'À revoir' },
  { note: 'difficile', titre: 'Difficile' },
  { note: 'bien', titre: 'Bien' },
  { note: 'facile', titre: 'Facile' },
]

export function Cartes() {
  const { cartes, pages, reglages, ajouterCartes, noterCarte, supprimerCarte, supprimerCartes } = useStore()
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
    setOccupe(true); setInfo(configIA(reglages).fournisseur === 'claude' ? 'Claude lit le cours… (jusqu’à une minute)' : 'Génération en cours…')
    try {
      const ia = configIA(reglages)
      const r = await genererCartes(ia, pages.find((p) => p.id === filtre)?.titre ?? '', cours)
      const tronque = coursTronque(ia, cours) ? ' (cours tronqué : trop long pour le modèle local)' : ''
      if (!r.cartes.length) {
        setInfo(r.plafond === 0
          ? 'Ce cours est trop court pour en tirer des cartes utiles.'
          : 'Aucune carte pertinente trouvée : le cours est peut-être trop général. Rien n’a été créé.')
      } else {
        const n = ajouterCartes(r.cartes, filtre)
        setInfo(`${n} carte(s) créée(s)${r.ecartees ? `, ${r.ecartees} écartée(s) car peu pertinentes` : ''}.${tronque}`)
      }
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
            <p>Plus aucune carte à réviser{filtre ? ' dans cette matière' : ''}.</p>
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
            <button className="bouton" disabled={occupe} onClick={generer}><Icone nom="etincelle" taille={15} /> Générer avec l’IA</button>
            {portee.length > 0 && (
              <button className="bouton" onClick={() => { if (confirm(`Supprimer ces ${portee.length} carte(s)${filtre ? ' de cette matière' : ''} ?`)) supprimerCartes(portee.map((c) => c.id)) }}>
                <Icone nom="corbeille" taille={15} /> Supprimer ces {portee.length}
              </button>
            )}
            {info && <span className="aide">{info}</span>}
          </div>
          <table className="table">
            <thead><tr><th>Type</th><th>Recto</th><th>Verso</th><th>Prochaine</th><th /></tr></thead>
            <tbody>
              {portee.map((c) => (
                <tr key={c.id}>
                  <td><span className={'badge-nature ' + (c.nature ?? 'libre')}>{LIBELLE_NATURE[c.nature ?? 'libre']}</span></td><td>{c.recto}</td><td>{c.verso}</td>
                  <td>{estDue(c) ? 'maintenant' : new Date(c.echeance).toLocaleDateString('fr-FR')}</td>
                  <td><button className="icone-btn" onClick={() => supprimerCarte(c.id)}><Icone nom="corbeille" taille={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
