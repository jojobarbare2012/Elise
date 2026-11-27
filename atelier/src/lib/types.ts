import type { JSONContent } from '@tiptap/react'

export interface Page {
  id: string
  parentId: string | null
  titre: string
  icone: string
  contenu: JSONContent | null
  creeLe: number
  modifieLe: number
}

export interface Carte {
  id: string
  pageId: string | null // matière / page d'origine
  recto: string
  verso: string
  facilite: number // facteur SM-2
  intervalle: number // jours
  repetitions: number
  echeance: number // timestamp ms
  oublis?: number // nombre de « À revoir » : repère les points faibles
  nature?: NatureCarte
}

/** Les flashcards ne portent que sur des définitions ou des données précises (valeurs chiffrées, formules, noms). */
export type NatureCarte = 'definition' | 'valeur' | 'fait'

export interface Question {
  enonce: string
  choix: string[]
  bonne: number // index dans choix
  explication: string
  /** Pourquoi chaque proposition est fausse (alignée sur `choix`, vide pour la bonne). */
  explicationsChoix?: string[]
}

export interface Tentative {
  id: string
  date: number
  score: number
  total: number
  erreurs: number[] // index des questions ratées
}

export interface Qcm {
  id: string
  titre: string
  source: string
  pageId: string | null
  questions: Question[]
  creeLe: number
  tentatives: Tentative[]
}

export type Statut = 'a_faire' | 'en_cours' | 'fait'
export type Priorite = 'basse' | 'normale' | 'haute'

export interface Tache {
  id: string
  titre: string
  statut: Statut
  priorite: Priorite
  echeance: string | null // YYYY-MM-DD
  pageId: string | null
}

export interface Examen {
  id: string
  titre: string
  date: string // YYYY-MM-DD
  pageId: string | null
}

export interface SessionTravail {
  id: string
  date: number
  minutes: number
  pageId: string | null
}

export type Fournisseur = 'claude' | 'ollama'

export interface Reglages {
  /** Ancien champ, conservé : modèle Ollama. */
  modele: string
  fournisseur?: Fournisseur
  modeleClaude?: string
  dureeTravail: number
  dureePause: number
  accent: Accent
  demarrage: boolean
}

export type Vue =
  | { type: 'accueil' }
  | { type: 'page'; pageId: string }
  | { type: 'cartes' }
  | { type: 'qcm' }
  | { type: 'taches' }
  | { type: 'planning' }
  | { type: 'espace' }

/** Un module du tableau de bord : place, largeur (1 à 3 colonnes) et visibilité. */
export interface ModuleDispo {
  id: string
  visible: boolean
  taille: 1 | 2 | 3
}
export type Accent = 'cyan' | 'ambre' | 'vert' | 'magenta'

export type TypePane = 'page' | 'cartes' | 'qcm' | 'taches' | 'minuteur' | 'planning' | 'accueil'

/** Un panneau de l'espace de travail : ce qu'il affiche et sa part de largeur. */
export interface Pane {
  id: string
  type: TypePane
  pageId: string | null // utilisé par le type « page »
  poids: number
}

/** Une génération IA facturée (coût estimé en dollars). */
export interface DepenseIA {
  date: number
  tache: string
  cout: number
}
