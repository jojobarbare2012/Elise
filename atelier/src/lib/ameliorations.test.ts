import { describe, expect, it } from 'vitest'
import { carteCiblee, construireQuestions } from './qualite'
import { nouvelleCarte, reviser } from './sm2'
import { blocsVersDoc } from './importCours'
import { maitriseParPage, pointsFaibles } from './maitrise'
import { texteDe } from './texte'
import type { Carte, Page, Qcm } from './types'

describe('flashcards : seulement définitions et données précises', () => {
  it('accepte une définition et une valeur chiffrée', () => {
    expect(carteCiblee('definition', 'Qu’est-ce qu’un ose ?', 'Un glucide simple, non hydrolysable.')).toBe(true)
    expect(carteCiblee('valeur', 'Quelle est la valeur énergétique d’1 g de lipides ?', '9 kcal')).toBe(true)
    expect(carteCiblee('fait', 'Quelle est la formule brute du glucose ?', 'C6H12O6')).toBe(true)
  })
  it('refuse une « valeur » sans nombre, une nature inconnue ou une réponse trop longue', () => {
    expect(carteCiblee('valeur', 'Quel est le RNP en calcium ?', 'Il est élevé chez l’adolescent.')).toBe(false)
    expect(carteCiblee('explication', 'Pourquoi la glycémie monte ?', 'Parce que…')).toBe(false)
    expect(carteCiblee(undefined, 'Q ?', 'R')).toBe(false)
    expect(carteCiblee('fait', 'Décris la digestion', 'x'.repeat(201))).toBe(false)
  })
})

describe('QCM : chaque explication suit sa proposition après mélange', () => {
  it('aligne les « pourquoi c’est faux » sur les choix mélangés', () => {
    for (let i = 0; i < 50; i++) {
      const [q] = construireQuestions({ questions: [{
        enonce: 'Quel organite produit la majorité de l’ATP ?', bonne_reponse: 'La mitochondrie',
        distracteurs: ['Le ribosome', 'Le lysosome', 'Le noyau'],
        pourquoi_faux: ['Il synthétise les protéines.', 'Il digère les déchets.', 'Il contient l’ADN.'],
        explication: 'x',
      }] })
      expect(q.explicationsChoix[q.bonne]).toBe('')
      expect(q.explicationsChoix[q.choix.indexOf('Le ribosome')]).toBe('Il synthétise les protéines.')
      expect(q.explicationsChoix[q.choix.indexOf('Le noyau')]).toBe('Il contient l’ADN.')
    }
  })
  it('fonctionne sans explications (ancien format)', () => {
    const [q] = construireQuestions({ questions: [{ enonce: 'Question assez longue ?', bonne_reponse: 'A', distracteurs: ['B', 'C', 'D'], explication: '' }] })
    expect(q.explicationsChoix).toEqual(['', '', '', ''])
  })
})

describe('compteur d’oublis', () => {
  it('« À revoir » incrémente les oublis', () => {
    let c = nouvelleCarte('a', null, 'q', 'r', 0)
    c = reviser(c, 'encore', 0); c = reviser(c, 'bien', 0); c = reviser(c, 'encore', 0)
    expect(c.oublis).toBe(2)
  })
})

describe('import de cours', () => {
  it('convertit titres, paragraphes, listes, encadrés et tableaux', () => {
    const doc = blocsVersDoc([
      { type: 'titre', niveau: 1, texte: 'Les glucides', elements: [], lignes: [] },
      { type: 'paragraphe', niveau: 0, texte: 'Ce sont des molécules organiques.', elements: [], lignes: [] },
      { type: 'liste', niveau: 0, texte: '', elements: ['Oses', 'Osides', ''], lignes: [] },
      { type: 'encadre', niveau: 0, texte: 'À retenir : 1 g de glucides = 4 kcal', elements: [], lignes: [] },
      { type: 'tableau', niveau: 0, texte: '', elements: [], lignes: [['Nutriment', 'kcal/g'], ['Glucides', '4'], ['Lipides']] },
      { type: 'inconnu', texte: 'ignoré' },
      null,
    ])
    expect(doc.content!.map((n) => n.type)).toEqual(['heading', 'paragraph', 'bulletList', 'blockquote', 'table'])
    expect(doc.content![0].attrs).toEqual({ level: 1 })
    expect(doc.content![2].content).toHaveLength(2)
    const table = doc.content![4]
    expect(table.content![0].content![0].type).toBe('tableHeader')
    expect(table.content![2].content).toHaveLength(2) // ligne incomplète complétée
    expect(texteDe(doc)).toContain('1 g de glucides = 4 kcal')
  })
  it('document vide ou invalide : page vide, sans planter', () => {
    expect(blocsVersDoc(null)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
    expect(blocsVersDoc([{ type: 'titre', texte: '   ' }]).content).toEqual([{ type: 'paragraph' }])
  })
})

describe('maîtrise et points faibles', () => {
  const page = (id: string): Page => ({ id, parentId: null, titre: id, icone: 'page', contenu: null, creeLe: 0, modifieLe: 0 })
  const carte = (id: string, pageId: string, champs: Partial<Carte> = {}): Carte => ({ ...nouvelleCarte(id, pageId, 'Q ' + id, 'R ' + id, 0), echeance: 1e15, ...champs })
  const qcm = (pageId: string, score: number, erreurs: number[]): Qcm => ({
    id: 'q' + pageId, titre: 'QCM', source: 'Cours', pageId, creeLe: 0,
    questions: [0, 1, 2, 3].map((i) => ({ enonce: `Question ${i} de ${pageId}`, choix: ['a', 'b'], bonne: 0, explication: '' })),
    tentatives: [{ id: 't', date: 0, score, total: 4, erreurs }],
  })
  const pages = [page('ch1'), page('ch2'), page('vide')]
  const cartes = [
    carte('a', 'ch1', { intervalle: 30 }), carte('b', 'ch1', { intervalle: 30 }),
    carte('c', 'ch2', { intervalle: 2, oublis: 3 }), carte('d', 'ch2', { intervalle: 1, facilite: 2.1 }),
  ]
  const qcms = [qcm('ch1', 4, []), qcm('ch2', 1, [1, 2, 3])]
  it('classe les chapitres du plus faible au plus fort et ignore les pages sans données', () => {
    const m = maitriseParPage(pages, cartes, qcms, 0)
    expect(m.map((x) => x.page.id)).toEqual(['ch2', 'ch1'])
    expect(m[1]).toMatchObject({ cartes: 2, maitrisees: 2, qcmScore: 1, niveau: 1 })
    expect(m[0]).toMatchObject({ cartes: 2, maitrisees: 0, oubliees: 1, qcmScore: 0.25 })
  })
  it('liste les points faibles d’une portée : questions ratées puis cartes oubliées', () => {
    const p = pointsFaibles(cartes, qcms, new Set(['ch2']))
    expect(p.filter((x) => x.source === 'qcm')).toHaveLength(3)
    expect(p.filter((x) => x.source === 'carte').map((x) => x.notion)).toEqual(['Q c', 'Q d'])
    expect(pointsFaibles(cartes, qcms, new Set(['ch1']))).toEqual([])
    expect(pointsFaibles(cartes, qcms, null, 2)).toHaveLength(2)
  })
})

import { nouvelId } from './id'
describe('identifiants hors contexte sécurisé (téléphone en http://)', () => {
  it('génère des UUID v4 valides et uniques sans randomUUID', () => {
    const original = globalThis.crypto.randomUUID
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true })
    try {
      const ids = new Set(Array.from({ length: 1000 }, () => nouvelId()))
      expect(ids.size).toBe(1000)
      for (const x of [...ids].slice(0, 20)) expect(x).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: original, configurable: true })
    }
  })
})
