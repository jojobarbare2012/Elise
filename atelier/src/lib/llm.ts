import type { Question } from './types'

// Le LLM reste remplaçable : seul ce fichier connaît Ollama (principe d'Élise).
const URL_OLLAMA = '/ollama/api/chat'
const LIMITE_COURS = 7000 // caractères, pour tenir dans num_ctx 8192

export class ErreurLLM extends Error {}

async function demanderJSON(modele: string, systeme: string, utilisateur: string, schema: object): Promise<unknown> {
  let reponse: Response
  try {
    reponse = await fetch(URL_OLLAMA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modele,
        stream: false,
        think: false,
        format: schema,
        options: { num_ctx: 8192, temperature: 0.4 },
        messages: [
          { role: 'system', content: systeme },
          { role: 'user', content: utilisateur },
        ],
      }),
    })
  } catch {
    throw new ErreurLLM("Ollama est injoignable. Lance-le (port 11434) puis réessaie.")
  }
  if (!reponse.ok) {
    throw new ErreurLLM(`Ollama a répondu ${reponse.status} (modèle « ${modele} » installé ?).`)
  }
  const donnees = await reponse.json()
  try {
    return JSON.parse(donnees.message.content)
  } catch {
    throw new ErreurLLM("Réponse du modèle illisible, réessaie.")
  }
}

const SCHEMA_QCM = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          enonce: { type: 'string' },
          choix: { type: 'array', items: { type: 'string' } },
          bonne: { type: 'integer' },
          explication: { type: 'string' },
        },
        required: ['enonce', 'choix', 'bonne', 'explication'],
      },
    },
  },
  required: ['questions'],
}

const SCHEMA_CARTES = {
  type: 'object',
  properties: {
    cartes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { recto: { type: 'string' }, verso: { type: 'string' } },
        required: ['recto', 'verso'],
      },
    },
  },
  required: ['cartes'],
}

/** Garde uniquement les questions bien formées (4 choix, bonne réponse valide). */
export function validerQuestions(brut: unknown): Question[] {
  const liste = (brut as { questions?: unknown })?.questions
  if (!Array.isArray(liste)) return []
  const questions: Question[] = []
  for (const q of liste) {
    if (!q || typeof q.enonce !== 'string' || !Array.isArray(q.choix)) continue
    const choix = q.choix.filter((c: unknown): c is string => typeof c === 'string' && c.trim() !== '')
    if (choix.length < 2 || !Number.isInteger(q.bonne) || q.bonne < 0 || q.bonne >= choix.length) continue
    questions.push({
      enonce: q.enonce.trim(),
      choix,
      bonne: q.bonne,
      explication: typeof q.explication === 'string' ? q.explication.trim() : '',
    })
  }
  return questions
}

export interface ParametresQcm {
  modele: string
  nombre: number
  difficulte: 'facile' | 'moyen' | 'difficile'
  /** Texte du cours ; absent = sujet libre, le modèle utilise ses connaissances. */
  cours?: string
  sujet: string
}

export async function genererQcm(p: ParametresQcm): Promise<Question[]> {
  const systeme =
    "Tu es un professeur qui prépare des QCM de révision en français. " +
    "Chaque question a exactement 4 choix plausibles, une seule bonne réponse " +
    "(`bonne` = index de 0 à 3) et une courte explication. Varie la position de la bonne réponse."
  const base = p.cours
    ? `Voici mon cours (${p.sujet}) :\n"""\n${p.cours.slice(0, LIMITE_COURS)}\n"""\n` +
      `Crée ${p.nombre} questions de difficulté ${p.difficulte} basées UNIQUEMENT sur ce cours.`
    : `Crée ${p.nombre} questions de difficulté ${p.difficulte} sur le sujet : ${p.sujet}.`
  const brut = await demanderJSON(p.modele, systeme, base, SCHEMA_QCM)
  const questions = validerQuestions(brut)
  if (!questions.length) throw new ErreurLLM("Le modèle n'a produit aucune question valide, réessaie.")
  return questions
}

export async function genererCartes(
  modele: string,
  sujet: string,
  cours: string,
  nombre: number,
): Promise<{ recto: string; verso: string }[]> {
  const systeme =
    "Tu crées des flashcards de révision en français : une notion par carte, " +
    "recto = question courte, verso = réponse concise."
  const brut = (await demanderJSON(
    modele,
    systeme,
    `Cours (${sujet}) :\n"""\n${cours.slice(0, LIMITE_COURS)}\n"""\nCrée ${nombre} flashcards basées sur ce cours.`,
    SCHEMA_CARTES,
  )) as { cartes?: { recto?: unknown; verso?: unknown }[] }
  const cartes = (brut.cartes ?? []).filter(
    (c): c is { recto: string; verso: string } =>
      typeof c.recto === 'string' && typeof c.verso === 'string' && c.recto.trim() !== '' && c.verso.trim() !== '',
  )
  if (!cartes.length) throw new ErreurLLM("Le modèle n'a produit aucune carte valide, réessaie.")
  return cartes
}
