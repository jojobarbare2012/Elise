import type { NatureCarte, Question, Reglages } from './types'
import { useStore } from './store'
import { blocsVersDoc } from './importCours'
import type { JSONContent } from '@tiptap/react'
import { lireJeton } from './synchro'
import { ancrage, carteCiblee, carteUtile, construireQuestions, plafondCartes, plafondQuestions } from './qualite'
import type { PointFaible } from './maitrise'

// Le LLM reste remplaçable : seul ce fichier sait à qui parler (principe d'Élise).
// - Claude (défaut) : via le serveur d'Atelier, qui garde la clé API. DÉPENDANCE CLOUD : le cours part chez Anthropic.
// - Ollama : local, contexte limité (8192 tokens) donc cours tronqué.
const URL_OLLAMA = '/ollama/api/chat'

export class ErreurLLM extends Error {}

export interface ConfigIA {
  fournisseur: 'claude' | 'ollama'
  modele: string
}
export const configIA = (r: Reglages): ConfigIA =>
  (r.fournisseur ?? 'claude') === 'claude'
    ? { fournisseur: 'claude', modele: r.modeleClaude || 'claude-opus-5-5' }
    : { fournisseur: 'ollama', modele: r.modele || 'qwen3:14b' }

/** Taille de cours envoyée : Claude lit tout (contexte d'un million de tokens) ; Ollama est limité. */
export const limiteCours = (ia: ConfigIA) => (ia.fournisseur === 'claude' ? 600_000 : 7000)
export const coursTronque = (ia: ConfigIA, cours: string) => cours.length > limiteCours(ia)

// Un même message système pour toutes les tâches : le cours (mis en cache par Claude) vient juste après,
// donc QCM, cartes et relecture sur un même chapitre réutilisent le cache.
const SYSTEME =
  "Tu es l'assistant de révision d'un étudiant francophone. Tu travailles à partir de ses cours, en français correct et naturel, " +
  "sans jamais inventer d'information. Tu réponds uniquement dans le format JSON demandé."

interface Demande {
  tache: string // libellé du coût enregistré
  consigne: string
  schema: object
  cours?: string
  documents?: { media_type: string; data: string }[]
  nuance?: 'creation' | 'relecture'
  long?: boolean
}

async function demanderJSON(ia: ConfigIA, d: Demande): Promise<unknown> {
  if (ia.fournisseur === 'claude') {
    return demanderClaude(ia.modele, d)
  }
  if (d.documents?.length) throw new ErreurLLM("L'import de PDF et de photos nécessite Claude (Réglages).")
  const utilisateur = d.cours ? `Cours :\n"""\n${d.cours.slice(0, limiteCours(ia))}\n"""\n\n${d.consigne}` : d.consigne
  return demanderOllama(ia.modele, SYSTEME, utilisateur, d.schema, d.nuance === 'relecture' ? 0 : 0.3)
}

/** La clé Claude est-elle configurée sur le serveur ? (false aussi si le serveur est absent) */
export async function etatClaude(): Promise<boolean> {
  try {
    const jeton = lireJeton()
    const r = await fetch('/api/ia/etat', { headers: jeton ? { Authorization: `Bearer ${jeton}` } : {} })
    if (!(r.headers.get('content-type') ?? '').includes('application/json')) return false
    return Boolean((await r.json()).cle)
  } catch {
    return false
  }
}

async function demanderClaude(modele: string, d: Demande): Promise<unknown> {
  const entetes: Record<string, string> = { 'Content-Type': 'application/json' }
  const jeton = lireJeton()
  if (jeton) entetes.Authorization = `Bearer ${jeton}`
  let reponse: Response
  try {
    reponse = await fetch('/api/ia/json', {
      method: 'POST',
      headers: entetes,
      body: JSON.stringify({
        modele,
        systeme: SYSTEME,
        cours: d.cours ? `Cours :\n"""\n${d.cours.slice(0, 600_000)}\n"""` : undefined,
        documents: d.documents,
        utilisateur: d.consigne,
        schema: d.schema,
        effort: d.nuance === 'relecture' ? 'medium' : 'high',
        long: d.long,
      }),
    })
  } catch {
    throw new ErreurLLM("Serveur d'Atelier injoignable.")
  }
  const type = reponse.headers.get('content-type') ?? ''
  if (!type.includes('application/json')) throw new ErreurLLM("Claude n'est utilisable qu'avec le serveur d'Atelier (npm run dev ou npm start).")
  const corps = await reponse.json()
  if (typeof corps?.cout === 'number' && corps.cout > 0) useStore.getState().enregistrerDepense(d.tache, corps.cout)
  if (!reponse.ok) throw new ErreurLLM(corps?.erreur ?? `Erreur ${reponse.status}`)
  return corps.donnees
}

async function demanderOllama(modele: string, systeme: string, utilisateur: string, schema: object, temperature: number): Promise<unknown> {
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

// ---------- schémas (objets fermés : exigé par la sortie structurée de Claude) ----------
const objet = (properties: Record<string, object>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const chaine = { type: 'string' }
const chaines = { type: 'array', items: chaine }

const SCHEMA_QCM = objet({
  questions: { type: 'array', items: objet({ enonce: chaine, bonne_reponse: chaine, distracteurs: chaines, pourquoi_faux: chaines, explication: chaine }) },
})
const SCHEMA_CARTES = objet({
  cartes: { type: 'array', items: objet({ nature: { type: 'string', enum: ['definition', 'valeur', 'fait'] }, recto: chaine, verso: chaine, extrait: chaine }) },
})
const SCHEMA_RELECTURE = objet({ garder: { type: 'array', items: { type: 'integer' } } })
const SCHEMA_IMPORT = objet({
  titre: chaine,
  blocs: {
    type: 'array',
    items: objet({
      type: { type: 'string', enum: ['titre', 'paragraphe', 'liste', 'liste_numerotee', 'encadre', 'tableau'] },
      niveau: { type: 'integer' },
      texte: chaine,
      elements: chaines,
      lignes: { type: 'array', items: chaines },
    }),
  },
})

/** Questions bien formées, avec propositions mélangées (voir qualite.ts). */
export function validerQuestions(brut: unknown): Question[] {
  return construireQuestions(brut)
}

// ---------- QCM ----------
export interface ParametresQcm {
  ia: ConfigIA
  nombre: number
  difficulte: 'facile' | 'moyen' | 'difficile'
  /** Texte du cours ; absent = sujet libre, le modèle utilise ses connaissances. */
  cours?: string
  sujet: string
  /** Notions ratées à retravailler en priorité. */
  pointsFaibles?: PointFaible[]
}

const CONSIGNES_QCM =
  "Rédige des QCM de révision, clairs et naturels.\n" +
  "Règles strictes :\n" +
  "- Chaque question se comprend SEULE : n'écris jamais « d'après le texte », « selon le cours », « ci-dessus ».\n" +
  "- Une seule idée par question, formulée en une phrase simple et correcte, avec le vocabulaire du sujet.\n" +
  "- `bonne_reponse` : la réponse exacte, sans ambiguïté.\n" +
  "- `distracteurs` : exactement 3 réponses FAUSSES mais plausibles, de même nature, même forme grammaticale et même longueur " +
  "approximative que la bonne réponse. Jamais « toutes les réponses », « aucune », ni une reformulation de la bonne réponse.\n" +
  "- `pourquoi_faux` : pour chaque distracteur, dans le même ordre, une phrase courte qui dit pourquoi il est faux.\n" +
  "- Ne mets pas la bonne réponse dans une position particulière : elle est mélangée ensuite.\n" +
  "- `explication` : une phrase qui rappelle le fait à retenir.\n" +
  "- N'invente rien. Si le sujet ne permet pas autant de bonnes questions, produis-en moins."

export async function genererQcm(p: ParametresQcm): Promise<Question[]> {
  const nombre = p.cours ? plafondQuestions(p.cours, Math.max(p.nombre, p.pointsFaibles?.length ? 3 : 0)) : p.nombre
  const faibles = p.pointsFaibles?.length
    ? "\n\nL'étudiant s'est trompé sur ces notions. Concentre les questions dessus, sous des angles DIFFÉRENTS " +
      "(ne recopie pas ces questions) :\n" + p.pointsFaibles.map((f) => `- ${f.notion} → ${f.reponse}`).join('\n')
    : ''
  const consigne = p.cours
    ? `${CONSIGNES_QCM}\n\nRédige au plus ${nombre} questions de difficulté ${p.difficulte} sur « ${p.sujet} », basées UNIQUEMENT sur le cours, sur des points différents.${faibles}`
    : `${CONSIGNES_QCM}\n\nRédige au plus ${nombre} questions de difficulté ${p.difficulte} sur le sujet : ${p.sujet}, sur des points différents.${faibles}`
  const brut = await demanderJSON(p.ia, { tache: p.pointsFaibles?.length ? 'QCM points faibles' : 'QCM', consigne, schema: SCHEMA_QCM, cours: p.cours })
  const questions = validerQuestions(brut).slice(0, nombre)
  if (!questions.length) throw new ErreurLLM("Le modèle n'a produit aucune question exploitable, réessaie.")
  return questions
}

// ---------- Flashcards ----------
export interface ResultatCartes {
  cartes: { recto: string; verso: string; nature: NatureCarte }[]
  ecartees: number
  plafond: number
}

const CONSIGNES_CARTES =
  "Crée des flashcards de révision à partir du cours. Une flashcard ne porte QUE sur :\n" +
  "- `definition` : la définition d'un terme du cours (« Qu'est-ce qu'un ose ? » → « Un glucide simple, non hydrolysable. ») ;\n" +
  "- `valeur` : une donnée chiffrée précise avec son unité : apport recommandé (RNP, AS, BNM), valeur normale, " +
  "seuil, pourcentage, valeur énergétique… (« Quelle est la valeur énergétique d'1 g de lipides ? » → « 9 kcal ») ;\n" +
  "- `fait` : une donnée précise et courte : formule, nom d'une enzyme ou d'une hormone, liste fermée courte.\n" +
  "Interdit : les explications de mécanismes, les « pourquoi », les généralités, les phrases d'introduction.\n" +
  "Règles strictes :\n" +
  "- `recto` : une question précise qui se comprend seule (précise la population, l'unité ou le contexte si nécessaire).\n" +
  "- `verso` : la réponse exacte et courte, recopiée fidèlement du cours (chiffres et unités compris), jamais une reformulation de la question.\n" +
  "- `extrait` : la phrase du cours (copiée) qui justifie la carte.\n" +
  "- Une valeur chiffrée qui n'est pas dans le cours ne doit pas être inventée.\n" +
  "- Mieux vaut peu de cartes excellentes que beaucoup de cartes faibles. Si rien ne s'y prête, renvoie une liste vide."

/**
 * Crée des cartes ciblées (définitions et données précises) ; n'en force aucune. Filtres : consignes strictes,
 * contrôles en code (nature, nombre dans les valeurs, longueur, réponse qui répète la question, citation absente du cours),
 * puis relecture par le modèle.
 */
export async function genererCartes(ia: ConfigIA, sujet: string, cours: string): Promise<ResultatCartes> {
  const plafond = plafondCartes(cours)
  if (plafond === 0) return { cartes: [], ecartees: 0, plafond }
  const brut = (await demanderJSON(ia, {
    tache: 'Cartes', schema: SCHEMA_CARTES, cours,
    consigne: `${CONSIGNES_CARTES}\n\nMatière : ${sujet}. Crée AU PLUS ${plafond} flashcards, seulement si elles respectent ces règles.`,
  })) as { cartes?: { nature?: unknown; recto?: unknown; verso?: unknown; extrait?: unknown }[] }

  const propositions = (brut.cartes ?? []).filter(
    (c): c is { nature: NatureCarte; recto: string; verso: string; extrait?: string } => typeof c.recto === 'string' && typeof c.verso === 'string',
  )
  const vus = new Set<string>()
  const retenues = propositions.filter((c) => {
    const cle = c.recto.trim().toLowerCase()
    if (vus.has(cle) || !carteUtile(c.recto, c.verso) || !carteCiblee(c.nature, c.recto, c.verso)) return false
    if (typeof c.extrait === 'string' && c.extrait.trim() && ancrage(c.extrait, cours) < 0.5) return false
    vus.add(cle)
    return true
  }).slice(0, plafond)

  let finales = retenues
  if (retenues.length > 1) {
    try {
      const avis = (await demanderJSON(ia, {
        tache: 'Relecture des cartes', schema: SCHEMA_RELECTURE, cours, nuance: 'relecture',
        consigne:
          "Relis ces flashcards. Garde uniquement celles qui portent sur une définition ou une donnée précise (valeur chiffrée, " +
          "formule, nom), dont la question est autonome et dont la réponse est exacte et conforme au cours (chiffres et unités " +
          "compris). Réponds avec les numéros à garder.\n\nCartes :\n" +
          retenues.map((c, i) => `${i}. [${c.nature}] Q : ${c.recto}\n   R : ${c.verso}`).join('\n'),
      })) as { garder?: unknown }
      if (Array.isArray(avis.garder)) {
        const index = new Set(avis.garder.filter((n): n is number => Number.isInteger(n)))
        finales = retenues.filter((_, i) => index.has(i))
      }
    } catch {
      /* la relecture est un plus : on garde les cartes déjà filtrées */
    }
  }
  return {
    cartes: finales.map(({ recto, verso, nature }) => ({ recto: recto.trim(), verso: verso.trim(), nature })),
    ecartees: propositions.length - finales.length,
    plafond,
  }
}

// ---------- Import d'un cours (PDF, photos) ----------
export const TYPES_IMPORT = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']
export const TAILLE_MAX_IMPORT = 24 * 1024 * 1024 // l'API accepte 32 Mo par requête, base64 compris

const CONSIGNES_IMPORT =
  "Transcris fidèlement ce cours (PDF ou photos de pages) en blocs structurés pour une prise de notes.\n" +
  "- Conserve TOUT le contenu pédagogique et sa structure : titres (niveau 1 à 3), paragraphes, listes, tableaux, encadrés « à retenir ».\n" +
  "- Recopie les chiffres, unités, formules et termes techniques à l'identique.\n" +
  "- Corrige seulement les erreurs évidentes de lecture (mots coupés, césures) ; ne résume pas, n'ajoute rien.\n" +
  "- Ignore les en-têtes et pieds de page, numéros de page, filigranes.\n" +
  "- Décris brièvement un schéma entre crochets dans un paragraphe s'il porte une information (« [Schéma : … ] »).\n" +
  "- Pour chaque bloc, remplis les champs inutiles avec une valeur vide (texte « », listes vides, niveau 0).\n" +
  "- `titre` : un titre court pour la page."

export async function importerCours(ia: ConfigIA, fichiers: { media_type: string; data: string }[]): Promise<{ titre: string; contenu: JSONContent }> {
  const brut = (await demanderJSON(ia, { tache: 'Import de cours', schema: SCHEMA_IMPORT, documents: fichiers, consigne: CONSIGNES_IMPORT, long: true })) as { titre?: unknown; blocs?: unknown }
  const contenu = blocsVersDoc(brut.blocs)
  if (!contenu.content?.some((n) => n.content?.length)) throw new ErreurLLM("Aucun contenu lisible n'a été trouvé dans ce document.")
  return { titre: typeof brut.titre === 'string' && brut.titre.trim() ? brut.titre.trim() : 'Cours importé', contenu }
}
