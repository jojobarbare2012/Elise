import { useState } from 'react'
import { useStore } from '../lib/store'
import { coursDe } from '../lib/texte'
import { ErreurLLM, genererQcm } from '../lib/llm'
import { Icone } from '../components/Icone'
import { SelecteurPage } from '../components/SelecteurSource'
import type { Qcm as TypeQcm } from '../lib/types'

type Source = 'cours' | 'libre'

export function Qcm() {
  const { qcms, pages, reglages, ajouterQcm, supprimerQcm } = useStore()
  const [source, setSource] = useState<Source>('cours')
  const [pageId, setPageId] = useState<string | null>(null)
  const [sujet, setSujet] = useState('')
  const [nombre, setNombre] = useState(8)
  const [difficulte, setDifficulte] = useState<'facile' | 'moyen' | 'difficile'>('moyen')
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState('')
  const [enCours, setEnCours] = useState<{ qcmId: string } | null>(null)

  const lancer = enCours ? qcms.find((q) => q.id === enCours.qcmId) : undefined
  if (lancer) return <Passage qcm={lancer} onFin={() => setEnCours(null)} />

  const generer = async () => {
    setErreur('')
    let cours: string | undefined
    let titre: string
    if (source === 'cours') {
      if (!pageId) return setErreur('Choisis une matière ou une page de cours.')
      cours = coursDe(pages, pageId)
      if (cours.length < 80) return setErreur('Ce cours est trop court pour générer un QCM utile.')
      titre = pages.find((p) => p.id === pageId)?.titre || 'Cours'
    } else {
      if (!sujet.trim()) return setErreur('Indique un sujet.')
      titre = sujet.trim()
    }
    setOccupe(true)
    try {
      const questions = await genererQcm({ modele: reglages.modele, nombre, difficulte, cours, sujet: titre })
      const id = ajouterQcm(`${titre} — ${difficulte}`, source === 'cours' ? 'Cours' : 'Sujet libre', source === 'cours' ? pageId : null, questions)
      setEnCours({ qcmId: id })
    } catch (e) {
      setErreur(e instanceof ErreurLLM ? e.message : 'Erreur inattendue pendant la génération.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <section className="vue">
      <header className="vue-entete"><h1>QCM</h1></header>
      <div className="panneau">
        <h3>Générer un QCM</h3>
        <div className="onglets">
          <button className={source === 'cours' ? 'actif' : ''} onClick={() => setSource('cours')}>À partir de mes cours</button>
          <button className={source === 'libre' ? 'actif' : ''} onClick={() => setSource('libre')}>Sujet libre</button>
        </div>
        {source === 'cours' ? (
          <SelecteurPage valeur={pageId} onChange={setPageId} vide="Choisir une matière ou une page…" />
        ) : (
          <>
            <input placeholder="Ex. Théorème de Bayes, la Révolution française…" value={sujet} onChange={(e) => setSujet(e.target.value)} />
            <p className="aide">Sans cours, le modèle s’appuie sur ses connaissances : vérifie les réponses.</p>
          </>
        )}
        <div className="ligne">
          <label>Questions
            <input type="number" min={3} max={20} value={nombre} onChange={(e) => setNombre(Math.min(20, Math.max(3, Number(e.target.value) || 8)))} />
          </label>
          <label>Difficulté
            <select value={difficulte} onChange={(e) => setDifficulte(e.target.value as typeof difficulte)}>
              <option value="facile">Facile</option><option value="moyen">Moyen</option><option value="difficile">Difficile</option>
            </select>
          </label>
          <button className="bouton principal" disabled={occupe} onClick={generer}>{occupe ? 'Génération…' : <><Icone nom="etincelle" taille={15} /> Générer</>}</button>
        </div>
        {erreur && <p className="erreur">{erreur}</p>}
      </div>

      <h3>Mes QCM</h3>
      {!qcms.length && <p className="vide">Aucun QCM pour l’instant.</p>}
      <div className="liste-cartes">
        {qcms.map((q) => {
          const dernier = q.tentatives.at(-1)
          const meilleur = q.tentatives.reduce((m, t) => Math.max(m, t.score / t.total), 0)
          return (
            <div key={q.id} className="item-carte">
              <div>
                <strong>{q.titre}</strong>
                <div className="aide">
                  {q.questions.length} questions · {q.source}
                  {dernier ? ` · dernier : ${dernier.score}/${dernier.total} · meilleur : ${Math.round(meilleur * 100)} %` : ' · jamais passé'}
                </div>
              </div>
              <div className="ligne">
                <button className="bouton principal" onClick={() => setEnCours({ qcmId: q.id })}>Passer</button>
                <button className="icone-btn" onClick={() => confirm('Supprimer ce QCM ?') && supprimerQcm(q.id)}><Icone nom="corbeille" taille={15} /></button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Passage({ qcm, onFin }: { qcm: TypeQcm; onFin: () => void }) {
  const { enregistrerTentative, ajouterCartes } = useStore()
  const [i, setI] = useState(0)
  const [choix, setChoix] = useState<number | null>(null)
  const [reponses, setReponses] = useState<number[]>([])
  const [termine, setTermine] = useState(false)
  const [ajout, setAjout] = useState('')

  const question = qcm.questions[i]
  const erreurs = reponses.map((r, k) => (r === qcm.questions[k].bonne ? -1 : k)).filter((k) => k >= 0)
  const score = reponses.length - erreurs.length

  const suivant = () => {
    const nouvelles = [...reponses, choix!]
    setReponses(nouvelles)
    setChoix(null)
    if (i + 1 < qcm.questions.length) setI(i + 1)
    else {
      const ratees = nouvelles.map((r, k) => (r === qcm.questions[k].bonne ? -1 : k)).filter((k) => k >= 0)
      enregistrerTentative(qcm.id, { score: nouvelles.length - ratees.length, total: qcm.questions.length, erreurs: ratees })
      setTermine(true)
    }
  }

  if (termine) {
    return (
      <section className="vue">
        <header className="vue-entete"><h1>Résultat</h1></header>
        <div className="panneau centre">
          <div className="gros-score">{score} / {qcm.questions.length}</div>
          <p>{Math.round((score / qcm.questions.length) * 100)} % de réussite</p>
          {erreurs.length > 0 && (
            <>
              <div className="revue">
                {erreurs.map((k) => (
                  <div key={k} className="revue-q">
                    <strong>{qcm.questions[k].enonce}</strong>
                    <div className="bonne">Réponse : {qcm.questions[k].choix[qcm.questions[k].bonne]}</div>
                    {qcm.questions[k].explication && <div className="aide">{qcm.questions[k].explication}</div>}
                  </div>
                ))}
              </div>
              <button className="bouton" onClick={() => {
                const n = ajouterCartes(
                  erreurs.map((k) => ({ recto: qcm.questions[k].enonce, verso: `${qcm.questions[k].choix[qcm.questions[k].bonne]}${qcm.questions[k].explication ? ' — ' + qcm.questions[k].explication : ''}` })),
                  qcm.pageId,
                )
                setAjout(`${n} carte(s) ajoutée(s) à tes révisions.`)
              }}>Ajouter mes erreurs aux cartes</button>
              {ajout && <p className="aide">{ajout}</p>}
            </>
          )}
          <div className="ligne"><button className="bouton principal" onClick={onFin}>Terminer</button></div>
        </div>
      </section>
    )
  }

  return (
    <section className="vue">
      <header className="vue-entete">
        <h1>{qcm.titre}</h1>
        <span className="aide">Question {i + 1} / {qcm.questions.length}</span>
      </header>
      <div className="barre"><div style={{ width: `${(i / qcm.questions.length) * 100}%` }} /></div>
      <div className="panneau">
        <h2 className="enonce">{question.enonce}</h2>
        <div className="choix">
          {question.choix.map((c, k) => {
            let classe = 'choix-item'
            if (choix !== null) {
              if (k === question.bonne) classe += ' juste'
              else if (k === choix) classe += ' faux'
            }
            return (
              <button key={k} className={classe} disabled={choix !== null} onClick={() => setChoix(k)}>
                <span className="lettre">{String.fromCharCode(65 + k)}</span>{c}
              </button>
            )
          })}
        </div>
        {choix !== null && (
          <>
            <p className={choix === question.bonne ? 'succes' : 'erreur'}>
              {choix === question.bonne ? 'Bonne réponse !' : 'Raté.'} {question.explication}
            </p>
            <button className="bouton principal" onClick={suivant}>
              {i + 1 < qcm.questions.length ? 'Suivant' : 'Voir le résultat'}
            </button>
          </>
        )}
      </div>
      <button className="lien" onClick={onFin}>Abandonner</button>
    </section>
  )
}
