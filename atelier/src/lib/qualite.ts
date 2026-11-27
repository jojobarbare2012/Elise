// Contrôles de qualité appliqués AU CODE sur ce que produit le modèle : on ne se fie pas à ses seules consignes.

export const normaliser = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()

const MOTS_VIDES = new Set(
  ('quel quelle quels quelles quoi comment pourquoi combien dans avec sans pour par sur sous entre vers chez dont donc alors ' +
    'cette cet ces son sont ses leur leurs les des une aux est etre avoir fait faire peut peuvent plus tout tous toute toutes ' +
    'comme aussi ainsi lors cela celui celle ceux elle elles nous vous ils que qui quoi ou').split(' '),
)
const mots = (s: string) => normaliser(s).split(' ').filter(Boolean)
const significatifs = (s: string) => mots(s).filter((m) => m.length >= 4 && !MOTS_VIDES.has(m))

export type Alea = () => number

/** Mélange de Fisher-Yates (le générateur est injectable pour les tests). */
export function melanger<T>(liste: readonly T[], alea: Alea = Math.random): T[] {
  const a = [...liste]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(alea() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Une carte est inutile si la réponse ne fait que reprendre la question
 * (ex. « Quelle est la base chimique commune de la matière vivante ? » / « La matière vivante a une base chimique commune. »).
 */
export function carteUtile(recto: string, verso: string): boolean {
  const r = recto.trim(), v = verso.trim()
  if (r.length < 8 || v.length < 1) return false
  if (normaliser(r) === normaliser(v)) return false
  const sigV = significatifs(v)
  if (sigV.length === 0) return normaliser(v).length > 0 // réponse très courte légitime : « C, H, O, N », « 3,14 »…
  const dansQuestion = new Set(significatifs(r))
  const repris = sigV.filter((m) => dansQuestion.has(m)).length
  return repris / sigV.length < 0.75
}

const NATURES = new Set(['definition', 'valeur', 'fait'])

/**
 * Règle de Jonathan : une flashcard ne vise qu'une définition ou une donnée précise (valeur chiffrée comme un RNP,
 * formule, nom). Réponse courte ; une « valeur » doit contenir un nombre.
 */
export function carteCiblee(nature: unknown, recto: string, verso: string): boolean {
  if (typeof nature !== 'string' || !NATURES.has(nature)) return false
  if (recto.trim().length > 220) return false
  const limite = nature === 'definition' ? 320 : 200
  if (verso.trim().length > limite) return false
  if (nature === 'valeur' && !/\d/.test(verso)) return false
  return true
}

/** Part des mots de `extrait` présents dans `cours` (0 à 1) : vérifie que la carte s'appuie bien sur le cours. */
export function ancrage(extrait: string, cours: string): number {
  const mE = mots(extrait).filter((m) => m.length >= 3)
  if (mE.length < 3) return 1 // trop court pour juger
  const mC = new Set(mots(cours))
  return mE.filter((m) => mC.has(m)).length / mE.length
}

/**
 * Nombre maximal de cartes pour un cours (un plafond, jamais un objectif). Les cartes ne visant que des définitions et
 * des données précises, un contenu dense (tableau de valeurs, liste de définitions) peut en justifier beaucoup.
 */
export function plafondCartes(cours: string): number {
  const n = mots(cours).length
  if (n < 12) return 0
  return Math.max(1, Math.min(30, Math.floor(n / 15)))
}

/** Nombre maximal de questions que ce cours peut raisonnablement alimenter. */
export function plafondQuestions(cours: string, demande: number): number {
  const n = mots(cours).length
  return Math.max(2, Math.min(demande, Math.floor(n / 25)))
}

const REFERENCES_AU_TEXTE = /\b(d'apres|selon|dans|suivant)\s+(le|ce|cet|la|cette|les)\s+(texte|cours|document|extrait|passage|chapitre|paragraphe)\b|\b(ci-dessus|ci dessus|precedemment cite)\b/
const ECHAPPATOIRES = /\b(toutes?|aucune?s?)\s+(les|des)?\s*(reponses?|propositions?)\b|\btoutes? les (reponses?|propositions?) (ci-dessus|precedentes)\b|\bles deux (reponses|propositions)\b|\bautre[s]? reponse/

export interface QuestionBrute {
  enonce?: unknown; bonne_reponse?: unknown; distracteurs?: unknown; explication?: unknown; pourquoi_faux?: unknown
}
type QuestionConstruite = { enonce: string; choix: string[]; bonne: number; explication: string; explicationsChoix: string[] }

/**
 * Construit des questions sûres : mélange les 4 propositions dans le code (la bonne réponse n'est jamais « placée » par le modèle),
 * écarte celles qui renvoient à « le texte », les doublons, les échappatoires (« toutes les réponses ») et les propositions identiques.
 */
export function construireQuestions(
  brutes: unknown,
  alea: Alea = Math.random,
): QuestionConstruite[] {
  const liste = (brutes as { questions?: unknown })?.questions
  if (!Array.isArray(liste)) return []
  const vues = new Set<string>()
  const sortie: QuestionConstruite[] = []
  for (const q of liste as QuestionBrute[]) {
    if (!q || typeof q.enonce !== 'string' || typeof q.bonne_reponse !== 'string' || !Array.isArray(q.distracteurs)) continue
    const enonce = q.enonce.trim()
    const bonne = q.bonne_reponse.trim()
    if (enonce.length < 10 || !bonne) continue
    const norm = normaliser(enonce)
    if (REFERENCES_AU_TEXTE.test(norm) || vues.has(norm)) continue
    const deja = new Set([normaliser(bonne)])
    const pourquoi = Array.isArray(q.pourquoi_faux) ? q.pourquoi_faux : []
    const distracteurs: { texte: string; pourquoi: string }[] = []
    q.distracteurs.forEach((d, k) => {
      if (typeof d !== 'string') return
      const t = d.trim(), n = normaliser(t)
      if (!t || deja.has(n) || ECHAPPATOIRES.test(n)) return
      deja.add(n)
      distracteurs.push({ texte: t, pourquoi: typeof pourquoi[k] === 'string' ? pourquoi[k].trim() : '' })
    })
    if (ECHAPPATOIRES.test(normaliser(bonne)) || distracteurs.length < 2) continue
    // On mélange les paires (texte, explication) pour que chaque explication suive sa proposition.
    const paires = melanger([{ texte: bonne, pourquoi: '' }, ...distracteurs.slice(0, 3)], alea)
    const choix = paires.map((p) => p.texte)
    vues.add(norm)
    sortie.push({
      enonce, choix, bonne: choix.indexOf(bonne),
      explication: typeof q.explication === 'string' ? q.explication.trim() : '',
      explicationsChoix: paires.map((p) => p.pourquoi),
    })
  }
  return sortie
}
