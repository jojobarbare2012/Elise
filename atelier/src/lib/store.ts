import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { JSONContent } from '@tiptap/react'
import type {
  Accent, Carte, Examen, ModuleDispo, Page, Qcm, Question, Reglages, SessionTravail, Statut, Tache, Tentative, Vue,
} from './types'
import { nouvelleCarte, reviser, type Note } from './sm2'
import { descendantes } from './texte'
import { iconeValide } from '../components/Icone'

const id = () => crypto.randomUUID()

interface Etat {
  pages: Page[]
  cartes: Carte[]
  qcms: Qcm[]
  taches: Tache[]
  examens: Examen[]
  sessions: SessionTravail[]
  reglages: Reglages
  disposition: ModuleDispo[]
  vue: Vue

  aller: (vue: Vue) => void
  creerPage: (parentId: string | null, titre?: string) => string
  majPage: (pageId: string, champs: Partial<Pick<Page, 'titre' | 'icone' | 'parentId'>>) => void
  majContenu: (pageId: string, contenu: JSONContent) => void
  supprimerPage: (pageId: string) => void

  ajouterCartes: (cartes: { recto: string; verso: string }[], pageId: string | null) => number
  noterCarte: (carteId: string, note: Note) => void
  supprimerCarte: (carteId: string) => void

  ajouterQcm: (titre: string, source: string, pageId: string | null, questions: Question[]) => string
  enregistrerTentative: (qcmId: string, tentative: Omit<Tentative, 'id' | 'date'>) => void
  supprimerQcm: (qcmId: string) => void

  ajouterTache: (t: Omit<Tache, 'id'>) => void
  majTache: (tacheId: string, champs: Partial<Tache>) => void
  deplacerTache: (tacheId: string, statut: Statut) => void
  supprimerTache: (tacheId: string) => void

  ajouterExamen: (e: Omit<Examen, 'id'>) => void
  supprimerExamen: (examenId: string) => void

  enregistrerSession: (minutes: number, pageId: string | null) => void
  majReglages: (r: Partial<Reglages>) => void
  majDisposition: (d: ModuleDispo[]) => void

  exporter: () => string
  importer: (json: string) => void
}

export const DISPOSITION_DEFAUT: ModuleDispo[] = [
  { id: 'horloge', visible: true, taille: 1 },
  { id: 'cartes', visible: true, taille: 1 },
  { id: 'taches', visible: true, taille: 1 },
  { id: 'minuteur', visible: true, taille: 1 },
  { id: 'examens', visible: true, taille: 2 },
  { id: 'qcm', visible: true, taille: 1 },
  { id: 'recentes', visible: true, taille: 2 },
  { id: 'semaine', visible: true, taille: 1 },
]

const REGLAGES_DEFAUT: Reglages = { modele: 'qwen3:14b', dureeTravail: 25, dureePause: 5, accent: 'cyan' as Accent }

function pageAccueil(): Page {
  const maintenant = Date.now()
  return {
    id: id(),
    parentId: null,
    titre: 'Bienvenue',
    icone: 'cible',
    creeLe: maintenant,
    modifieLe: maintenant,
    contenu: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Ton atelier de travail' }] },
        {
          type: 'bulletList',
          content: [
            'Tape « / » pour insérer un bloc (titre, liste, tâche, tableau, code…).',
            'Tape « @ » pour lier une autre page.',
            'Écris une ligne « Question :: Réponse » puis importe-la en flashcards depuis l’onglet Cartes.',
            'Ctrl+K cherche dans tout le contenu.',
          ].map((t) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })),
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Capitale de la France :: Paris' }] },
      ],
    },
  }
}

export const useStore = create<Etat>()(
  persist(
    (set, get) => ({
      pages: [pageAccueil()],
      cartes: [],
      qcms: [],
      taches: [],
      examens: [],
      sessions: [],
      reglages: REGLAGES_DEFAUT,
      disposition: DISPOSITION_DEFAUT,
      vue: { type: 'accueil' },

      aller: (vue) => set({ vue }),

      creerPage: (parentId, titre = '') => {
        const nouveau = id()
        const maintenant = Date.now()
        set((s) => ({
          pages: [
            ...s.pages,
            { id: nouveau, parentId, titre, icone: 'page', contenu: null, creeLe: maintenant, modifieLe: maintenant },
          ],
          vue: { type: 'page', pageId: nouveau },
        }))
        return nouveau
      },
      majPage: (pageId, champs) =>
        set((s) => ({
          pages: s.pages.map((p) => (p.id === pageId ? { ...p, ...champs, modifieLe: Date.now() } : p)),
        })),
      majContenu: (pageId, contenu) =>
        set((s) => ({
          pages: s.pages.map((p) => (p.id === pageId ? { ...p, contenu, modifieLe: Date.now() } : p)),
        })),
      supprimerPage: (pageId) =>
        set((s) => {
          const aSupprimer = new Set(descendantes(s.pages, pageId).map((p) => p.id))
          const vueSupprimee = s.vue.type === 'page' && aSupprimer.has(s.vue.pageId)
          const nettoyer = (v: string | null) => (v && aSupprimer.has(v) ? null : v)
          return {
            pages: s.pages.filter((p) => !aSupprimer.has(p.id)),
            cartes: s.cartes.map((c) => ({ ...c, pageId: nettoyer(c.pageId) })),
            qcms: s.qcms.map((q) => ({ ...q, pageId: nettoyer(q.pageId) })),
            taches: s.taches.map((t) => ({ ...t, pageId: nettoyer(t.pageId) })),
            examens: s.examens.map((e) => ({ ...e, pageId: nettoyer(e.pageId) })),
            vue: vueSupprimee ? { type: 'accueil' } : s.vue,
          }
        }),

      ajouterCartes: (nouvelles, pageId) => {
        const existantes = new Set(get().cartes.map((c) => `${c.pageId}|${c.recto}`))
        const aAjouter = nouvelles
          .filter((c) => !existantes.has(`${pageId}|${c.recto}`))
          .map((c) => nouvelleCarte(id(), pageId, c.recto, c.verso))
        set((s) => ({ cartes: [...s.cartes, ...aAjouter] }))
        return aAjouter.length
      },
      noterCarte: (carteId, note) =>
        set((s) => ({ cartes: s.cartes.map((c) => (c.id === carteId ? reviser(c, note) : c)) })),
      supprimerCarte: (carteId) => set((s) => ({ cartes: s.cartes.filter((c) => c.id !== carteId) })),

      ajouterQcm: (titre, source, pageId, questions) => {
        const nouveau = id()
        set((s) => ({
          qcms: [{ id: nouveau, titre, source, pageId, questions, creeLe: Date.now(), tentatives: [] }, ...s.qcms],
        }))
        return nouveau
      },
      enregistrerTentative: (qcmId, tentative) =>
        set((s) => ({
          qcms: s.qcms.map((q) =>
            q.id === qcmId ? { ...q, tentatives: [...q.tentatives, { ...tentative, id: id(), date: Date.now() }] } : q,
          ),
        })),
      supprimerQcm: (qcmId) => set((s) => ({ qcms: s.qcms.filter((q) => q.id !== qcmId) })),

      ajouterTache: (t) => set((s) => ({ taches: [...s.taches, { ...t, id: id() }] })),
      majTache: (tacheId, champs) =>
        set((s) => ({ taches: s.taches.map((t) => (t.id === tacheId ? { ...t, ...champs } : t)) })),
      deplacerTache: (tacheId, statut) =>
        set((s) => ({ taches: s.taches.map((t) => (t.id === tacheId ? { ...t, statut } : t)) })),
      supprimerTache: (tacheId) => set((s) => ({ taches: s.taches.filter((t) => t.id !== tacheId) })),

      ajouterExamen: (e) => set((s) => ({ examens: [...s.examens, { ...e, id: id() }] })),
      supprimerExamen: (examenId) => set((s) => ({ examens: s.examens.filter((e) => e.id !== examenId) })),

      enregistrerSession: (minutes, pageId) =>
        set((s) => ({ sessions: [...s.sessions, { id: id(), date: Date.now(), minutes, pageId }] })),
      majDisposition: (d) => set({ disposition: d }),
      majReglages: (r) => set((s) => ({ reglages: { ...s.reglages, ...r } })),

      exporter: () => {
        const { pages, cartes, qcms, taches, examens, sessions, reglages, disposition } = get()
        return JSON.stringify({ version: 2, pages, cartes, qcms, taches, examens, sessions, reglages, disposition }, null, 2)
      },
      importer: (json) => {
        const d = JSON.parse(json)
        if (!Array.isArray(d.pages)) throw new Error('Fichier de sauvegarde invalide.')
        set({
          cartes: d.cartes ?? [],
          qcms: d.qcms ?? [],
          taches: d.taches ?? [],
          examens: d.examens ?? [],
          sessions: d.sessions ?? [],
          reglages: { ...REGLAGES_DEFAUT, ...(d.reglages ?? {}) },
          pages: d.pages.map((p: Page) => ({ ...p, icone: iconeValide(p.icone) })),
          disposition: d.disposition ?? DISPOSITION_DEFAUT,
          vue: { type: 'accueil' },
        })
      },
    }),
    {
      name: 'atelier-donnees',
      version: 2,
      // v1 -> v2 : les icônes de pages passent d'emojis à des noms d'icônes SVG.
      migrate: (ancien) => {
        const e = ancien as { pages?: Page[] }
        return { ...e, pages: (e.pages ?? []).map((p) => ({ ...p, icone: iconeValide(p.icone) })) } as never
      },
    },
  ),
)

export const dateLocale = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const aujourdhui = () => dateLocale()
