import { describe, expect, it } from 'vitest'
import { estDue, nouvelleCarte, reviser } from './sm2'
import { cartesEcrites, texteDe, liensDe } from './texte'

const T0 = 1_700_000_000_000
const JOUR = 86_400_000

describe('SM-2', () => {
  it('enchaîne 1 jour, 6 jours puis intervalle × facilité', () => {
    let c = nouvelleCarte('a', null, 'q', 'r', T0)
    c = reviser(c, 'bien', T0)
    expect(c.intervalle).toBe(1)
    c = reviser(c, 'bien', T0)
    expect(c.intervalle).toBe(6)
    c = reviser(c, 'bien', T0)
    expect(c.intervalle).toBe(Math.round(6 * c.facilite))
    expect(c.echeance).toBe(T0 + c.intervalle * JOUR)
  })
  it("« À revoir » remet la carte à zéro, due dans 10 minutes", () => {
    let c = reviser(reviser(nouvelleCarte('a', null, 'q', 'r', T0), 'bien', T0), 'bien', T0)
    c = reviser(c, 'encore', T0)
    expect(c.repetitions).toBe(0)
    expect(c.echeance).toBe(T0 + 600_000)
    expect(estDue(c, T0)).toBe(false)
    expect(estDue(c, T0 + 600_000)).toBe(true)
  })
  it('la facilité ne descend jamais sous 1,3', () => {
    let c = nouvelleCarte('a', null, 'q', 'r', T0)
    for (let i = 0; i < 20; i++) c = reviser(c, 'difficile', T0)
    expect(c.facilite).toBeGreaterThanOrEqual(1.3)
  })
})

describe('texte', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Capitale :: Paris' }] },
      { type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'p2', label: 'Maths' } }] },
    ],
  }
  it('extrait le texte et les liens', () => {
    expect(texteDe(doc)).toBe('Capitale :: Paris\nMaths')
    expect(liensDe(doc)).toEqual(['p2'])
  })
  it('parse les cartes « Q :: R »', () => {
    expect(cartesEcrites('a :: b\nrien\n :: x\nc::d')).toEqual([
      { recto: 'a', verso: 'b' }, { recto: 'c', verso: 'd' },
    ])
  })
})

import { avecNouveau, deplacer, normaliser, redimensionner, sans } from './espace'
import type { Pane } from './types'

const pane = (id: string, poids: number): Pane => ({ id, type: 'cartes', pageId: null, poids })

describe('espace de travail', () => {
  it('redimensionne sans jamais passer sous le minimum', () => {
    const p = redimensionner([0.5, 0.5], 0, 0.9)
    expect(p[0] + p[1]).toBeCloseTo(1)
    expect(p[1]).toBeGreaterThanOrEqual(0.14 - 1e-9)
    const q = redimensionner([0.5, 0.5], 0, -0.9)
    expect(q[0]).toBeCloseTo(0.14)
  })
  it('un séparateur ne touche que ses deux voisins', () => {
    const p = redimensionner([0.2, 0.3, 0.5], 1, 0.1)
    expect(p[0]).toBeCloseTo(0.2)
    expect(p[1] + p[2]).toBeCloseTo(0.8)
  })
  it('séparateur invalide : rien ne change', () => {
    expect(redimensionner([0.5, 0.5], 5, 0.1)).toEqual([0.5, 0.5])
  })
  it('ajouter / retirer garde une somme de 1 et respecte le maximum', () => {
    let panes = [pane('a', 0.5), pane('b', 0.5)]
    panes = avecNouveau(panes, { id: 'c', type: 'page', pageId: null })
    expect(panes.reduce((s, p) => s + p.poids, 0)).toBeCloseTo(1)
    panes = sans(panes, 'a')
    expect(panes).toHaveLength(2)
    expect(panes.reduce((s, p) => s + p.poids, 0)).toBeCloseTo(1)
    const pleins = [pane('1', 0.25), pane('2', 0.25), pane('3', 0.25), pane('4', 0.25)]
    expect(avecNouveau(pleins, { id: '5', type: 'page', pageId: null })).toHaveLength(4)
  })
  it('déplace un panneau avec son poids, sans sortir des bornes', () => {
    const panes = [pane('a', 0.7), pane('b', 0.3)]
    expect(deplacer(panes, 'a', 1).map((p) => p.id)).toEqual(['b', 'a'])
    expect(deplacer(panes, 'a', -1)).toBe(panes)
    expect(normaliser([0, 0]).reduce((s, p) => s + p, 0)).toBeCloseTo(1)
  })
})

import { decider } from './synchro'

describe('décision de synchronisation', () => {
  const base = { disqueVide: false, revisionDisque: 3, revisionConnue: 3, sale: false, localVierge: false }
  it('disque vide : on envoie (migration depuis le navigateur)', () => {
    expect(decider({ ...base, disqueVide: true, revisionDisque: 0, revisionConnue: 0 })).toBe('pousser')
  })
  it('à jour : rien ; modifié localement : envoi', () => {
    expect(decider(base)).toBe('rien')
    expect(decider({ ...base, sale: true })).toBe('pousser')
  })
  it('le disque a avancé : on adopte, sauf modifications locales non envoyées', () => {
    expect(decider({ ...base, revisionDisque: 5 })).toBe('adopter')
    expect(decider({ ...base, revisionDisque: 5, sale: true })).toBe('conflit')
  })
  it('appareil neuf (vierge) : adopte le disque ; appareil déjà rempli jamais synchronisé : conflit', () => {
    expect(decider({ ...base, revisionConnue: 0, localVierge: true })).toBe('adopter')
    expect(decider({ ...base, revisionConnue: 0, localVierge: false })).toBe('conflit')
  })
})

import { ancetres } from './texte'
import type { Page } from './types'

describe('arborescence de pages', () => {
  const p = (id: string, parentId: string | null): Page => ({ id, parentId, titre: id, icone: 'page', contenu: null, creeLe: 0, modifieLe: 0 })
  const pages = [p('matiere', null), p('chap1', 'matiere'), p('sous', 'chap1'), p('autre', null)]
  it('donne la chaîne des parents, du plus lointain au plus proche', () => {
    expect(ancetres(pages, 'sous').map((x) => x.id)).toEqual(['matiere', 'chap1'])
    expect(ancetres(pages, 'matiere')).toEqual([])
  })
  it('résiste à une boucle de parents corrompue', () => {
    const boucle = [p('a', 'b'), p('b', 'a')]
    expect(ancetres(boucle, 'a').length).toBeLessThanOrEqual(2)
  })
})

import { ancrage, carteUtile, construireQuestions, melanger, plafondCartes, plafondQuestions } from './qualite'
import { validerQuestions } from './llm'

// Générateur pseudo-aléatoire reproductible (mulberry32)
const graine = (a: number) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

describe('QCM : propositions mélangées par le code', () => {
  const brut = (extra = {}) => ({
    questions: [{ enonce: 'Quel organite produit la majorité de l’ATP ?', bonne_reponse: 'La mitochondrie',
      distracteurs: ['Le ribosome', 'Le lysosome', 'L’appareil de Golgi'], explication: 'x', ...extra }],
  })
  it('la bonne réponse est répartie uniformément sur les 4 positions', () => {
    const alea = graine(42)
    const positions = [0, 0, 0, 0]
    for (let i = 0; i < 4000; i++) positions[construireQuestions(brut(), alea)[0].bonne]++
    for (const n of positions) expect(n / 4000).toBeGreaterThan(0.22)
    for (const n of positions) expect(n / 4000).toBeLessThan(0.28)
  })
  it('l\'index `bonne` désigne toujours la bonne réponse après mélange', () => {
    const alea = graine(7)
    for (let i = 0; i < 200; i++) {
      const q = construireQuestions(brut(), alea)[0]
      expect(q.choix[q.bonne]).toBe('La mitochondrie')
      expect(new Set(q.choix).size).toBe(4)
    }
  })
  it('écarte les questions qui renvoient au texte, les échappatoires et les doublons', () => {
    const q = (enonce: string, bonne: string, distracteurs: string[]) => ({ enonce, bonne_reponse: bonne, distracteurs, explication: '' })
    const resultat = validerQuestions({ questions: [
      q('Selon le texte, quel organite produit l’ATP ?', 'La mitochondrie', ['A1', 'B2', 'C3']),
      q('Quel organite produit la majorité de l’ATP ?', 'La mitochondrie', ['Le ribosome', 'Toutes les réponses ci-dessus', 'Aucune des réponses']),
      q('Quel organite produit la majorité de l’ATP ?', 'La mitochondrie', ['Le ribosome', 'Le lysosome', 'Le noyau']),
      q('Quel organite produit la majorité de l’ATP ?', 'La mitochondrie', ['Le ribosome', 'Le lysosome', 'Le noyau']),
      q('Quelle molécule stocke l’information génétique ?', 'L’ADN', ['L’ADN', 'L’adn', 'Le lipide']),
      q('Question avec une seule proposition fausse ?', 'Oui', ['Non']),
      { enonce: 'Mal formée sans réponse ?' },
    ] })
    expect(resultat).toHaveLength(1)
    expect(resultat[0].enonce).toContain('majorité')
  })
  it('gère une réponse vide ou invalide', () => {
    expect(validerQuestions({})).toEqual([])
    expect(validerQuestions(null)).toEqual([])
  })
  it('melanger conserve les éléments', () => {
    expect([...melanger([1, 2, 3, 4], graine(1))].sort()).toEqual([1, 2, 3, 4])
  })
})

describe('flashcards : pertinence', () => {
  it('rejette la carte circulaire signalée par l\'utilisateur', () => {
    expect(carteUtile('Quelle est la base chimique commune de la matière vivante ?', 'La matière vivante a une base chimique commune.')).toBe(false)
  })
  it('rejette une réponse identique à la question ou une reformulation', () => {
    expect(carteUtile('Définis la glycolyse', 'La glycolyse')).toBe(false)
    expect(carteUtile('Qu’est-ce que la photosynthèse ?', 'La photosynthèse')).toBe(false)
  })
  it('accepte des cartes qui apportent une information', () => {
    expect(carteUtile('Quels éléments forment l’essentiel de la matière vivante ?', 'Carbone, hydrogène, oxygène et azote.')).toBe(true)
    expect(carteUtile('Quelle est la formule du glucose ?', 'C6H12O6')).toBe(true)
    expect(carteUtile('Quel organite produit l’ATP ?', 'La mitochondrie, par phosphorylation oxydative.')).toBe(true)
    expect(carteUtile('Combien de liaisons hydrogène relient G et C ?', '3')).toBe(true)
  })
  it('rejette une question trop courte', () => {
    expect(carteUtile('Quoi ?', 'Rien')).toBe(false)
  })
  it('ancrage : une citation absente du cours est détectée', () => {
    const cours = 'Les glucides sont des molécules constituées de carbone, hydrogène et oxygène. Le glucose est un ose.'
    expect(ancrage('Le glucose est un ose', cours)).toBeGreaterThan(0.9)
    expect(ancrage('Les protéines sont synthétisées par les ribosomes cytoplasmiques', cours)).toBeLessThan(0.5)
  })
  it('le plafond suit la longueur du cours et ne force jamais', () => {
    expect(plafondCartes('Un cours très court.')).toBe(0)
    expect(plafondCartes('mot '.repeat(200))).toBe(5)
    expect(plafondCartes('mot '.repeat(5000))).toBe(15)
    expect(plafondQuestions('mot '.repeat(60), 10)).toBe(2)
    expect(plafondQuestions('mot '.repeat(1000), 10)).toBe(10)
  })
})
