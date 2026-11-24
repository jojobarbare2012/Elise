import type { Question } from './types'
import { ancrage, carteUtile, construireQuestions, plafondCartes, plafondQuestions } from './qualite'

// Le LLM reste remplaçable : seul ce fichier connaît Ollama (principe d'Élise).
const URL_OLLAMA = '/ollama/api/chat'
const LIMITE_COURS = 7000 // caractères, pour tenir dans num_ctx 8192

export class ErreurLLM extends Error {}

async function demanderJSON(modele: string, systeme: string, utilisateur: string, schema: object, temperature = 0.3): Promise<unknown> {
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
        options: { num_ctx: 8192, temperature },
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
          bonne_reponse: { type: 'string' },
          distracteurs: { type: 'array', items: { type: 'string' } },
          explication: { type: 'string' },
        },
        required: ['enonce', 'bonne_reponse', 'distracteurs', 'explication'],
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
        properties: { recto: { type: 'string' }, verso: { type: 'string' }, extrait: { type: 'string' } },
        required: ['recto', 'verso', 'extrait'],
      },
    },
  },
  required: ['cartes'],
}

const SCHEMA_RELECTURE = {
  type: 'object',
  properties: { garder: { type: 'array', items: { type: 'integer' } } },
  required: ['garder'],
}

/** Questions bien formées, avec propositions mélangées (voir qualite.ts). */
export function validerQuestions(brut: unknown): Question[] {
  return construireQuestions(brut)
}

export interface ParametresQcm {
  modele: string
  nombre: number
  difficulte: 'facile' | 'moyen' | 'difficile'
  /** Texte du cours ; absent = sujet libre, le modèle utilise ses connaissances. */
  cours?: string
  sujet: string
}

const CONSIGNES_QCM =
  "Tu es un professeur qui rédige des QCM de révision en français, clairs et naturels.\n" +
  "Règles strictes :\n" +
  "- Chaque question se comprend SEULE : n'écris jamais « d'après le texte », « selon le cours », « ci-dessus ».\n" +
  "- Une seule idée par question, formulée en une phrase simple et correcte, avec le vocabulaire du sujet.\n" +
  "- `bonne_reponse` : la réponse exacte, sans ambiguïté.\n" +
  "- `distracteurs` : exactement 3 réponses FAUSSES mais plausibles, de même nature, même forme grammaticale et même longueur " +
  "approximative que la bonne réponse. Jamais « toutes les réponses », « aucune », ni une reformulation de la bonne réponse.\n" +
  "- Ne mets pas la bonne réponse dans une position particulière : elle est mélangée ensuite.\n" +
  "- `explication` : une phrase qui rappelle le fait à retenir.\n" +
  "- N'invente rien. Si le sujet ne permet pas autant de bonnes questions, produis-en moins."

export async function genererQcm(p: ParametresQcm): Promise<Question[]> {
  const nombre = p.cours ? plafondQuestions(p.cours, p.nombre) : p.nombre
  const demande = p.cours
    ? `Voici mon cours (${p.sujet}) :\n"""\n${p.cours.slice(0, LIMITE_COURS)}\n"""\n` +
      `Rédige au plus ${nombre} questions de difficulté ${p.difficulte} basées UNIQUEMENT sur ce cours, sur des points différents.`
    : `Rédige au plus ${nombre} questions de difficulté ${p.difficulte} sur le sujet : ${p.sujet}, sur des points différents.`
  const brut = await demanderJSON(p.modele, CONSIGNES_QCM, demande, SCHEMA_QCM)
  const questions = validerQuestions(brut).slice(0, nombre)
  if (!questions.length) throw new ErreurLLM("Le modèle n'a produit aucune question exploitable, réessaie.")
  return questions
}

export interface ResultatCartes {
  cartes: { recto: string; verso: string }[]
  ecartees: number
  plafond: number
}

const CONSIGNES_CARTES =
  "Tu crées des flashcards de révision en français à partir d'un cours. Une carte = UN fait précis à retenir " +
  "(définition, rôle, formule, cause/conséquence, liste, distinction entre deux notions).\n" +
  "Règles strictes :\n" +
  "- `recto` : une question précise qui se comprend seule.\n" +
  "- `verso` : la réponse, qui APPORTE l'information absente de la question. Jamais une reformulation de la question.\n" +
  "  Mauvais : recto « Quelle est la base chimique de la matière vivante ? » / verso « La matière vivante a une base chimique commune. »\n" +
  "  Bon : recto « Quels éléments forment l'essentiel de la matière vivante ? » / verso « Carbone, hydrogène, oxygène et azote. »\n" +
  "- `extrait` : la phrase du cours (copiée) qui justifie la carte.\n" +
  "- Ignore les introductions, transitions et généralités sans fait précis à retenir.\n" +
  "- Mieux vaut peu de cartes excellentes que beaucoup de cartes faibles. Si rien ne mérite une carte, renvoie une liste vide."

/**
 * Crée des cartes pertinentes ; n'en force aucune. Trois filtres : consignes strictes, contrôles en code
 * (réponse qui répète la question, citation absente du cours), puis relecture par le modèle.
 */
export async function genererCartes(modele: string, sujet: string, cours: string): Promise<ResultatCartes> {
  const plafond = plafondCartes(cours)
  if (plafond === 0) return { cartes: [], ecartees: 0, plafond }
  const brut = (await demanderJSON(
    modele, CONSIGNES_CARTES,
    `Cours (${sujet}) :\n"""\n${cours.slice(0, LIMITE_COURS)}\n"""\nCrée AU PLUS ${plafond} flashcards, seulement si elles sont pertinentes.`,
    SCHEMA_CARTES, 0.2,
  )) as { cartes?: { recto?: unknown; verso?: unknown; extrait?: unknown }[] }

  const propositions = (brut.cartes ?? []).filter(
    (c): c is { recto: string; verso: string; extrait?: string } => typeof c.recto === 'string' && typeof c.verso === 'string',
  )
  const vus = new Set<string>()
  const retenues = propositions.filter((c) => {
    const cle = c.recto.trim().toLowerCase()
    if (vus.has(cle) || !carteUtile(c.recto, c.verso)) return false
    if (typeof c.extrait === 'string' && c.extrait.trim() && ancrage(c.extrait, cours) < 0.5) return false
    vus.add(cle)
    return true
  }).slice(0, plafond)

  let finales = retenues
  if (retenues.length > 1) {
    try {
      const avis = (await demanderJSON(
        modele,
        "Tu relis des flashcards. Garde uniquement celles où la question est précise et autonome, la réponse apporte une vraie information " +
          "(pas une reformulation de la question) et elle est exacte d'après le cours. Réponds avec les numéros à garder.",
        `Cours :\n"""\n${cours.slice(0, LIMITE_COURS)}\n"""\nCartes :\n` +
          retenues.map((c, i) => `${i}. Q : ${c.recto}\n   R : ${c.verso}`).join('\n'),
        SCHEMA_RELECTURE, 0,
      )) as { garder?: unknown }
      if (Array.isArray(avis.garder)) {
        const index = new Set(avis.garder.filter((n): n is number => Number.isInteger(n)))
        finales = retenues.filter((_, i) => index.has(i))
      }
    } catch {
      /* la relecture est un plus : on garde les cartes déjà filtrées */
    }
  }
  return { cartes: finales.map(({ recto, verso }) => ({ recto: recto.trim(), verso: verso.trim() })), ecartees: propositions.length - finales.length, plafond }
}
