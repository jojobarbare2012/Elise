import { useStore, aujourdhui } from '../lib/store'
import { estDue } from '../lib/sm2'
import { joursRestants } from './Planning'

export function Accueil() {
  const { pages, cartes, taches, examens, qcms, sessions, aller, creerPage } = useStore()
  const nbDues = cartes.filter((c) => estDue(c)).length
  const jour = aujourdhui()
  const tachesJour = taches.filter((t) => t.statut !== 'fait' && t.echeance && t.echeance <= jour)
  const prochains = examens.filter((e) => joursRestants(e.date) >= 0).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3)
  const recentes = [...pages].sort((a, b) => b.modifieLe - a.modifieLe).slice(0, 6)
  const minutesJour = sessions
    .filter((s) => new Date(s.date).toDateString() === new Date().toDateString())
    .reduce((m, s) => m + s.minutes, 0)
  const dernierQcm = qcms.find((q) => q.tentatives.length)
  const heure = new Date().getHours()

  return (
    <section className="vue large">
      <header className="vue-entete">
        <h1>{heure < 18 ? 'Bonjour' : 'Bonsoir'} 👋</h1>
        <span className="aide">{new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      </header>
      <div className="tuiles">
        <button className="tuile" onClick={() => aller({ type: 'cartes' })}>
          <span className="tuile-nb">{nbDues}</span><span>carte(s) à réviser</span>
        </button>
        <button className="tuile" onClick={() => aller({ type: 'taches' })}>
          <span className="tuile-nb">{tachesJour.length}</span><span>tâche(s) pour aujourd’hui ou en retard</span>
        </button>
        <button className="tuile" onClick={() => aller({ type: 'planning' })}>
          <span className="tuile-nb">{minutesJour}</span><span>min travaillées aujourd’hui</span>
        </button>
        <button className="tuile" onClick={() => aller({ type: 'qcm' })}>
          <span className="tuile-nb">{dernierQcm ? `${dernierQcm.tentatives.at(-1)!.score}/${dernierQcm.tentatives.at(-1)!.total}` : '—'}</span>
          <span>dernier QCM</span>
        </button>
      </div>
      <div className="deux-colonnes">
        <div>
          <h3>À venir</h3>
          {!prochains.length && <p className="vide">Aucun examen planifié.</p>}
          {prochains.map((e) => (
            <div key={e.id} className="item-carte"><strong>{e.titre}</strong><span className="compte">J-{joursRestants(e.date)}</span></div>
          ))}
          <h3>Tâches du jour</h3>
          {!tachesJour.length && <p className="vide">Rien d’urgent 🎉</p>}
          {tachesJour.slice(0, 6).map((t) => (
            <div key={t.id} className="item-carte"><span>{t.titre}</span><span className="aide">{t.echeance}</span></div>
          ))}
        </div>
        <div>
          <h3>Pages récentes <button className="lien" onClick={() => creerPage(null)}>＋ Nouvelle</button></h3>
          {recentes.map((p) => (
            <button key={p.id} className="item-carte cliquable" onClick={() => aller({ type: 'page', pageId: p.id })}>
              <span>{p.icone} {p.titre || 'Sans titre'}</span>
              <span className="aide">{new Date(p.modifieLe).toLocaleDateString('fr-FR')}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
