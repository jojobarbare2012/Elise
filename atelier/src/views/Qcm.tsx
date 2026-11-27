import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { coursDe, descendantes } from '../lib/texte'
import { pointsFaibles } from '../lib/maitrise'
import { melanger } from '../lib/qualite'
import { formaterDuree } from '../lib/minuteur'
import { configIA, ErreurLLM, genererQcm } from '../lib/llm'
import { Icone } from '../components/Icone'
import { SelecteurPage } from '../components/SelecteurSource'
import type { Qcm as TypeQcm } from '../lib/types'

type Source = 'cours' | 'faibles' | 'libre'

export function Qcm() {
  const { qcms, pages, cartes, reglages, ajouterQcm, supprimerQcm } = useStore()
  const [source, setSource] = useState<Source>('cours')
  const [pageId, setPageId] = useState<string | null>(null)
  const [sujet, setSujet] = useState('')
  const [nombre, setNombre] = useState(8)
  const [difficulte, setDifficulte] = useState<'facile' | 'moyen' | 'difficile'>('moyen')
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState('')
  const [enCours, setEnCours] = useState<{ qcmId: string } | null>(null)

  const portee = pageId ? new Set(descendantes(pages, pageId).map((p) => p.id)) : null
  const faibles = useMemo(() => pointsFaibles(cartes, qcms, portee), [cartes, qcms, pageId, pages]) // eslint-disable-line react-hooks/exhaustive-deps

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
    } else if (source === 'faibles') {
      if (!faibles.length) return setErreur('Aucun point faible repéré ici : passe des QCM et révise des cartes, les erreurs seront retenues.')
      cours = pageId ? coursDe(pages, pageId) : undefined
      titre = `Points faibles — ${pageId ? pages.find((p) => p.id === pageId)?.titre || 'Cours' : 'toutes matières'}`
    } else {
      if (!sujet.trim()) return setErreur('Indique un sujet.')
      titre = sujet.trim()
    }
    setOccupe(true)
    try {
      const questions = await genererQcm({
        ia: configIA(reglages), nombre, difficulte, cours, sujet: titre,
        pointsFaibles: source === 'faibles' ? faibles : undefined,
      })
      const libelleSource = source === 'cours' ? 'Cours' : source === 'faibles' ? 'Points faibles' : 'Sujet libre'
      const id = ajouterQcm(source === 'faibles' ? titre : `${titre} — ${difficulte}`, libelleSource, source === 'libre' ? null : pageId, questions)
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
          <button className={source === 'faibles' ? 'actif' : ''} onClick={() => setSource('faibles')}>Mes points faibles</button>
          <button className={source === 'libre' ? 'actif' : ''} onClick={() => setSource('libre')}>Sujet libre</button>
        </div>
        {source === 'cours' ? (
          <SelecteurPage valeur={pageId} onChange={setPageId} vide="Choisir une matière ou une page…" />
        ) : source === 'faibles' ? (
          <>
            <SelecteurPage valeur={pageId} onChange={setPageId} vide="Toutes les matières" />
            <p className="aide">
              {faibles.length
                ? `${faibles.length} notion(s) à retravailler : questions ratées lors de tes derniers QCM et cartes souvent oubliées. Claude les réinterroge sous d’autres angles.`
                : 'Aucun point faible repéré pour l’instant dans cette portée.'}
            </p>
            {faibles.length > 0 && (
              <ul className="liste-faibles">
                {faibles.slice(0, 5).map((f, i) => <li key={i}>{f.notion}</li>)}
                {faibles.length > 5 && <li className="aide">… et {faibles.length - 5} autre(s)</li>}
              </ul>
            )}
          </>
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
          <button className="bouton principal" disabled={occupe} onClick={generer}>{occupe ? (configIA(reglages).fournisseur === 'claude' ? 'Claude rédige…' : 'Génération…') : <><Icone nom="etincelle" taille={15} /> Générer</>}</button>
        </div>
        {erreur && <p className="erreur">{erreur}</p>}
      </div>

      <ExamenBlanc onLancer={(id) => setEnCours({ qcmId: id })} />

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
  const examen = Boolean(qcm.dureeExamen)
  const [debut] = useState(() => Date.now())
  const [maintenant, setMaintenant] = useState(() => Date.now())
  const [i, setI] = useState(0)
  const [choix, setChoix] = useState<number | null>(null)
  const [reponses, setReponses] = useState<number[]>([])
  const [termine, setTermine] = useState(false)
  const [ajout, setAjout] = useState('')

  const question = qcm.questions[i]
  // Ordre des propositions re-mélangé à chaque tentative (on ne mémorise pas la position).
  const ordres = useMemo(() => qcm.questions.map((q) => melanger(q.choix.map((_, k) => k))), [qcm.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const erreurs = reponses.map((r, k) => (r === qcm.questions[k].bonne ? -1 : k)).filter((k) => k >= 0)
  const score = reponses.length - erreurs.length

  const finir = (toutes: number[]) => {
    // Questions sans réponse (temps écoulé) : comptées fausses.
    const completes = qcm.questions.map((_, k) => toutes[k] ?? -1)
    const ratees = completes.map((r, k) => (r === qcm.questions[k].bonne ? -1 : k)).filter((k) => k >= 0)
    setReponses(completes)
    enregistrerTentative(qcm.id, { score: completes.length - ratees.length, total: qcm.questions.length, erreurs: ratees })
    setTermine(true)
  }

  const suivant = () => {
    const nouvelles = [...reponses, choix!]
    setReponses(nouvelles)
    setChoix(null)
    if (i + 1 < qcm.questions.length) setI(i + 1)
    else finir(nouvelles)
  }

  // Chronomètre de l'examen blanc : à zéro, la copie est rendue telle quelle.
  const restant = examen ? debut + qcm.dureeExamen! * 60_000 - maintenant : 0
  useEffect(() => {
    if (!examen || termine) return
    const t = window.setInterval(() => setMaintenant(Date.now()), 500)
    return () => window.clearInterval(t)
  }, [examen, termine])
  useEffect(() => {
    if (examen && !termine && restant <= 0) finir(choix !== null ? [...reponses, choix] : reponses)
  }, [restant]) // eslint-disable-line react-hooks/exhaustive-deps

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
                    {qcm.questions[k].explicationsChoix?.[reponses[k]] && (
                      <div className="aide">Ta réponse « {qcm.questions[k].choix[reponses[k]]} » : {qcm.questions[k].explicationsChoix![reponses[k]]}</div>
                    )}
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
        {examen && <span className={'chrono' + (restant < 60_000 ? ' urgent' : '')}>{formaterDuree(restant)}</span>}
      </header>
      <div className="barre"><div style={{ width: `${(i / qcm.questions.length) * 100}%` }} /></div>
      <div className="panneau">
        <h2 className="enonce">{question.enonce}</h2>
        <div className="choix">
          {ordres[i].map((o, k) => {
            let classe = 'choix-item'
            if (examen) {
              if (o === choix) classe += ' selection'
            } else if (choix !== null) {
              if (o === question.bonne) classe += ' juste'
              else if (o === choix) classe += ' faux'
            }
            return (
              <button key={o} className={classe} disabled={!examen && choix !== null} onClick={() => setChoix(o)}>
                <span className="lettre">{String.fromCharCode(65 + k)}</span>{question.choix[o]}
              </button>
            )
          })}
        </div>
        {examen && choix !== null && (
          <button className="bouton principal" onClick={suivant}>
            {i + 1 < qcm.questions.length ? 'Suivant' : 'Rendre la copie'}
          </button>
        )}
        {!examen && choix !== null && (
          <>
            <p className={choix === question.bonne ? 'succes' : 'erreur'}>
              {choix === question.bonne ? 'Bonne réponse !' : 'Raté.'} {question.explication}
            </p>
            {question.explicationsChoix?.some((e) => e) && (
              <details className="pourquoi" open={choix !== question.bonne}>
                <summary>Pourquoi les autres réponses sont fausses</summary>
                <ul>
                  {ordres[i].filter((o) => o !== question.bonne && question.explicationsChoix?.[o]).map((o) => (
                    <li key={o} className={o === choix ? 'choisie' : ''}><strong>{question.choix[o]}</strong> : {question.explicationsChoix![o]}</li>
                  ))}
                </ul>
              </details>
            )}
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

/** Examen blanc : tire des questions de tes QCM existants (aucun appel IA, donc gratuit), chronométré, corrigé à la fin. */
function ExamenBlanc({ onLancer }: { onLancer: (qcmId: string) => void }) {
  const { qcms, pages, ajouterQcm } = useStore()
  const [pageId, setPageId] = useState<string | null>(null)
  const [nombre, setNombre] = useState(20)
  const [duree, setDuree] = useState(30)
  const portee = pageId ? new Set(descendantes(pages, pageId).map((p) => p.id)) : null
  const disponibles = useMemo(() => {
    const vues = new Set<string>()
    return qcms
      .filter((q) => !q.dureeExamen && (portee === null || (q.pageId !== null && portee.has(q.pageId))))
      .flatMap((q) => q.questions)
      .filter((q) => { const k = q.enonce.toLowerCase(); if (vues.has(k)) return false; vues.add(k); return true })
  }, [qcms, pageId, pages]) // eslint-disable-line react-hooks/exhaustive-deps

  const lancer = () => {
    const tirees = melanger(disponibles).slice(0, nombre)
    const titre = `Examen blanc — ${pageId ? pages.find((p) => p.id === pageId)?.titre || 'Cours' : 'toutes matières'}`
    onLancer(ajouterQcm(titre, 'Examen blanc', pageId, tirees, duree))
  }

  return (
    <div className="panneau">
      <h3>Examen blanc</h3>
      <p className="aide">Questions tirées au hasard de tes QCM déjà générés (aucun coût IA), chronométré, sans correction avant la fin.</p>
      <SelecteurPage valeur={pageId} onChange={setPageId} vide="Toutes les matières" />
      <div className="ligne">
        <label>Questions
          <input type="number" min={5} max={60} value={nombre} onChange={(e) => setNombre(Math.min(60, Math.max(5, Number(e.target.value) || 20)))} />
        </label>
        <label>Durée (min)
          <input type="number" min={2} max={240} value={duree} onChange={(e) => setDuree(Math.min(240, Math.max(2, Number(e.target.value) || 30)))} />
        </label>
        <button className="bouton principal" disabled={disponibles.length < 5} onClick={lancer}>Commencer</button>
      </div>
      <p className="aide">
        {disponibles.length < 5
          ? `Seulement ${disponibles.length} question(s) disponible(s) ici : génère d’abord quelques QCM sur cette matière.`
          : `${disponibles.length} question(s) disponibles${disponibles.length < nombre ? ` : l’examen en comptera ${disponibles.length}` : ''}.`}
      </p>
    </div>
  )
}
