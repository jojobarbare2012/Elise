import { describe, expect, it } from 'vitest'
import { estDue, nouvelleCarte, reviser } from './sm2'
import { cartesEcrites, texteDe, liensDe } from './texte'
import { validerQuestions } from './llm'

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

describe('validation des QCM du LLM', () => {
  it('écarte les questions mal formées', () => {
    const q = validerQuestions({
      questions: [
        { enonce: 'ok', choix: ['a', 'b', 'c', 'd'], bonne: 2, explication: 'x' },
        { enonce: 'index hors limite', choix: ['a', 'b'], bonne: 5, explication: '' },
        { enonce: 'un seul choix', choix: ['a'], bonne: 0, explication: '' },
        { choix: ['a', 'b'], bonne: 0 },
      ],
    })
    expect(q).toHaveLength(1)
    expect(q[0].bonne).toBe(2)
  })
  it('gère une réponse sans questions', () => {
    expect(validerQuestions({})).toEqual([])
    expect(validerQuestions(null)).toEqual([])
  })
})
