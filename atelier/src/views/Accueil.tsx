import { useState, type ReactNode } from 'react'
import { useStore, aujourdhui, DISPOSITION_DEFAUT } from '../lib/store'
import { estDue } from '../lib/sm2'
import { joursRestants } from './Planning'
import { Module } from '../components/Module'
import { Icone } from '../components/Icone'
import { Histo, Minuteur } from '../components/widgets'
import { useMinuteur } from '../lib/minuteur'
import type { ModuleDispo } from '../lib/types'

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

type Def = { titre: string; icone: string; rendu: () => ReactNode; voyant?: () => 'ok' | 'alerte' | 'inactif' }

function useDefinitions(): Record<string, Def> {
  const { cartes, taches, examens, qcms, pages, aller, creerPage } = useStore()
  const jour = aujourdhui()
  const nbDues = cartes.filter((c) => estDue(c)).length
  const tachesJour = taches.filter((t) => t.statut !== 'fait' && t.echeance && t.echeance <= jour)
  const prochains = examens.filter((e) => joursRestants(e.date) >= 0).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4)
  const recentes = [...pages].sort((a, b) => b.modifieLe - a.modifieLe).slice(0, 6)
  const dernier = qcms.find((q) => q.tentatives.length)?.tentatives.at(-1)

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
  }
}

export function Accueil() {
  const { disposition, majDisposition } = useStore()
  const [edition, setEdition] = useState(false)
  const [glisse, setGlisse] = useState<string | null>(null)
  const defs = useDefinitions()

  // Ne garde que les modules connus ; ajoute ceux qui manqueraient (nouvelles versions).
  const liste: ModuleDispo[] = [
    ...disposition.filter((d) => defs[d.id]),
    ...DISPOSITION_DEFAUT.filter((d) => !disposition.some((x) => x.id === d.id)),
  ]
  const maj = (id: string, champs: Partial<ModuleDispo>) =>
    majDisposition(liste.map((d) => (d.id === id ? { ...d, ...champs } : d)))
  const deplacer = (cibleId: string) => {
    if (!glisse || glisse === cibleId) return
    const source = liste.find((d) => d.id === glisse)!
    const sans = liste.filter((d) => d.id !== glisse)
    const i = sans.findIndex((d) => d.id === cibleId)
    sans.splice(i, 0, source)
    majDisposition(sans)
  }
  const heure = new Date().getHours()
  const masques = liste.filter((d) => !d.visible)

  return (
    <section className="vue large">
      <header className="vue-entete">
        <div>
          <div className="etiquette">Système opérationnel</div>
          <h1>{heure < 18 ? 'Bonjour, Jonathan' : 'Bonsoir, Jonathan'}</h1>
        </div>
        <button className={'bouton' + (edition ? ' principal' : '')} onClick={() => setEdition(!edition)}>
          <Icone nom="modules" taille={15} /> {edition ? 'Terminer' : 'Configurer les modules'}
        </button>
      </header>

      <div className={'grille-modules' + (edition ? ' edition' : '')}>
        {liste.filter((d) => d.visible).map((d) => {
          const def = defs[d.id]
          return (
            <div
              key={d.id}
              className={'cellule t' + d.taille + (glisse === d.id ? ' glisse' : '')}
              draggable={edition}
              onDragStart={() => setGlisse(d.id)}
              onDragEnd={() => setGlisse(null)}
              onDragOver={(e) => edition && e.preventDefault()}
              onDrop={() => deplacer(d.id)}
            >
              <Module
                titre={def.titre}
                icone={def.icone}
                voyant={def.voyant?.() ?? 'ok'}
                actions={edition && (
                  <>
                    {[1, 2, 3].map((t) => (
                      <button key={t} className={'mini' + (d.taille === t ? ' actif' : '')} title={`Largeur ${t}`} onClick={() => maj(d.id, { taille: t as 1 | 2 | 3 })}>{t}</button>
                    ))}
                    <button className="mini" title="Masquer" onClick={() => maj(d.id, { visible: false })}><Icone nom="oeil_barre" taille={14} /></button>
                    <span className="mini poignee" title="Glisser pour déplacer"><Icone nom="poignee" taille={14} /></span>
                  </>
                )}
              >
                {def.rendu()}
              </Module>
            </div>
          )
        })}
      </div>

      {edition && (
        <div className="plateau">
          <span className="etiquette">Modules masqués</span>
          {!masques.length && <span className="aide">aucun</span>}
          {masques.map((d) => (
            <button key={d.id} className="bouton" onClick={() => maj(d.id, { visible: true })}>
              <Icone nom="oeil" taille={14} /> {defs[d.id].titre}
            </button>
          ))}
          <button className="lien" onClick={() => majDisposition(DISPOSITION_DEFAUT)}>Disposition par défaut</button>
        </div>
      )}
    </section>
  )
}
