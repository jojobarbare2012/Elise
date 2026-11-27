import type { ReactNode } from 'react'
import { useStore, aujourdhui, DISPOSITION_DEFAUT } from '../lib/store'
import { estDue } from '../lib/sm2'
import { joursRestants } from './Planning'
import { Icone } from '../components/Icone'
import { Histo, Minuteur } from '../components/widgets'
import { useMinuteur } from '../lib/minuteur'
import { maitriseParPage } from '../lib/maitrise'
import { PlanRevision } from '../components/PlanRevision'
import { GrilleModules, type DefModule } from '../components/GrilleModules'

function Horloge() {
  const maintenant = useMinuteur((s) => s.maintenant)
  const d = new Date(maintenant)
  return (
    <div className="horloge">
      <div className="horloge-heure">{d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}<span>{String(d.getSeconds()).padStart(2, '0')}</span></div>
      <div className="etiquette">{d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    </div>
  )
}

function Chiffre({ valeur, legende, onClick }: { valeur: ReactNode; legende: string; onClick: () => void }) {
  return (
    <button className="chiffre" onClick={onClick}>
      <span className="chiffre-valeur">{valeur}</span>
      <span className="etiquette">{legende}</span>
    </button>
  )
}

function useDefinitions(): Record<string, DefModule> {
  const { cartes, taches, examens, qcms, pages, aller, creerPage } = useStore()
  const jour = aujourdhui()
  const nbDues = cartes.filter((c) => estDue(c)).length
  const tachesJour = taches.filter((t) => t.statut !== 'fait' && t.echeance && t.echeance <= jour)
  const prochains = examens.filter((e) => joursRestants(e.date) >= 0).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4)
  const recentes = [...pages].sort((a, b) => b.modifieLe - a.modifieLe).slice(0, 6)
  const dernier = qcms.find((q) => q.tentatives.length)?.tentatives.at(-1)
  const maitrise = maitriseParPage(pages, cartes, qcms)

  return {
    horloge: { titre: 'Horloge', icone: 'planning', rendu: () => <Horloge /> },
    cartes: {
      titre: 'Cartes à réviser', icone: 'cartes',
      voyant: () => (nbDues ? 'alerte' : 'ok'),
      rendu: () => <Chiffre valeur={nbDues} legende={nbDues ? 'cartes en attente' : 'tout est à jour'} onClick={() => aller({ type: 'cartes' })} />,
    },
    taches: {
      titre: 'Tâches du jour', icone: 'taches',
      voyant: () => (tachesJour.length ? 'alerte' : 'ok'),
      rendu: () => (
        <>
          <Chiffre valeur={tachesJour.length} legende="pour aujourd’hui ou en retard" onClick={() => aller({ type: 'taches' })} />
          {tachesJour.slice(0, 3).map((t) => <div key={t.id} className="ligne-donnee"><span>{t.titre}</span><span className="mono">{t.echeance}</span></div>)}
        </>
      ),
    },
    minuteur: { titre: 'Minuteur', icone: 'cible', rendu: () => <Minuteur compact /> },
    examens: {
      titre: 'Échéances', icone: 'calendrier',
      rendu: () => (
        <>
          {!prochains.length && <p className="vide">Aucun examen planifié.</p>}
          {prochains.map((e) => {
            const j = joursRestants(e.date)
            return (
              <div key={e.id} className="ligne-donnee">
                <span>{e.titre}</span>
                <span className={'compte' + (j <= 7 ? ' proche' : '')}>{j === 0 ? 'AUJ.' : `J-${j}`}</span>
              </div>
            )
          })}
        </>
      ),
    },
    qcm: {
      titre: 'Dernier QCM', icone: 'qcm',
      rendu: () => <Chiffre valeur={dernier ? `${dernier.score}/${dernier.total}` : '--'} legende={dernier ? `${Math.round((dernier.score / dernier.total) * 100)} % de réussite` : 'aucun QCM passé'} onClick={() => aller({ type: 'qcm' })} />,
    },
    recentes: {
      titre: 'Pages récentes', icone: 'page',
      rendu: () => (
        <>
          {recentes.map((p) => (
            <button key={p.id} className="ligne-donnee cliquable" onClick={() => aller({ type: 'page', pageId: p.id })}>
              <span><Icone nom={p.icone} taille={15} /> {p.titre || 'Sans titre'}</span>
              <span className="mono">{new Date(p.modifieLe).toLocaleDateString('fr-FR')}</span>
            </button>
          ))}
          <button className="lien" onClick={() => creerPage(null)}>+ Nouvelle page</button>
        </>
      ),
    },
    semaine: { titre: 'Activité 7 jours', icone: 'graphique', rendu: () => <Histo /> },
    programme: { titre: 'Au programme aujourd’hui', icone: 'calendrier', rendu: () => <PlanRevision compact /> },
    maitrise: {
      titre: 'Maîtrise par chapitre', icone: 'cible',
      voyant: () => (maitrise.some((m) => (m.niveau ?? 0) < 0.5) ? 'alerte' : 'ok'),
      rendu: () => (
        <>
          {!maitrise.length && <p className="vide">Révise des cartes ou passe des QCM : la maîtrise de chaque chapitre s’affichera ici.</p>}
          {maitrise.slice(0, 8).map((m) => {
            const pct = m.niveau === null ? 0 : Math.round(m.niveau * 100)
            return (
              <button key={m.page.id} className="ligne-maitrise" onClick={() => aller({ type: 'page', pageId: m.page.id })}>
                <span className="lm-titre"><Icone nom={m.page.icone} taille={14} /> {m.page.titre || 'Sans titre'}</span>
                <span className={'lm-barre' + (pct < 50 ? ' faible' : pct < 80 ? ' moyen' : '')}><span style={{ width: `${pct}%` }} /></span>
                <span className="mono lm-pct">{pct} %</span>
                <span className="aide lm-detail">
                  {m.cartes > 0 && `${m.maitrisees}/${m.cartes} cartes maîtrisées`}
                  {m.oubliees > 0 && ` · ${m.oubliees} oubliée(s)`}
                  {m.qcmScore !== null && ` · QCM ${Math.round(m.qcmScore * 100)} %`}
                </span>
              </button>
            )
          })}
          {maitrise.length > 8 && <p className="aide">… et {maitrise.length - 8} autre(s) chapitre(s), mieux maîtrisés.</p>}
        </>
      ),
    },
  }
}

export function Accueil() {
  const defs = useDefinitions()
  const heure = new Date().getHours()
  return (
    <section className="vue large">
      <header className="vue-entete">
        <div>
          <div className="etiquette">Système opérationnel</div>
          <h1>{heure < 18 ? 'Bonjour, Jonathan' : 'Bonsoir, Jonathan'}</h1>
        </div>
      </header>
      <GrilleModules cle="accueil" defs={defs} defaut={DISPOSITION_DEFAUT} />
    </section>
  )
}
