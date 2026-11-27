// Relais vers l'API Claude (Anthropic). La clé reste côté serveur : le navigateur ne la voit jamais.
// DÉPENDANCE CLOUD : le contenu des cours (texte, PDF, photos) envoyé ici part chez Anthropic.
import Anthropic from '@anthropic-ai/sdk'

const SANS_CLE = 'Aucune clé API Anthropic trouvée. Crée le fichier atelier/.env contenant ANTHROPIC_API_KEY=sk-ant-…, puis relance le serveur (npm run dev).'

const MODELES_AUTORISES = /^claude-[a-z0-9-]+$/
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const TYPES_DOCUMENTS = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'])

// Prix en dollars par million de tokens (entrée, sortie, lecture de cache, écriture de cache 5 min).
const PRIX = {
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-sonnet-5-5': [2, 10, 0.1, 2.5],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
  'claude-fable-5-2': [8, 40, 0.2, 10],
}

/** Coût estimé d'une réponse (null si le modèle n'est pas dans la table). La réflexion est comptée en sortie. */
export function coutEstime(modele, usage) {
  const p = PRIX[modele]
  if (!p || !usage) return null
  const u = (n) => (typeof n === 'number' ? n : 0)
  return (u(usage.input_tokens) * p[0] + u(usage.output_tokens) * p[1] +
    u(usage.cache_read_input_tokens) * p[2] + u(usage.cache_creation_input_tokens) * p[3]) / 1e6
}

/** Valide les pièces jointes : PDF ou images en base64. */
function documentsValides(documents) {
  if (documents === undefined) return []
  if (!Array.isArray(documents) || documents.length > 20) return null
  for (const d of documents) {
    if (!d || !TYPES_DOCUMENTS.has(d.media_type) || typeof d.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(d.data)) return null
  }
  return documents
}

/**
 * @param {{ cle?: string, baseURL?: string }} options
 */
export function creerClaude({ cle, baseURL } = {}) {
  const client = new Anthropic({ ...(cle ? { apiKey: cle } : {}), ...(baseURL ? { baseURL } : {}), maxRetries: 2, timeout: 10 * 60_000 })

  /** Renvoie { statut, corps } pour une demande de JSON structuré. */
  async function json({ modele, systeme, utilisateur, schema, effort, cours, documents, long }) {
    if (typeof modele !== 'string' || !MODELES_AUTORISES.test(modele)) return { statut: 400, corps: { erreur: 'modèle invalide' } }
    if (typeof systeme !== 'string' || typeof utilisateur !== 'string' || !schema || typeof schema !== 'object') {
      return { statut: 400, corps: { erreur: 'demande invalide' } }
    }
    if (cours !== undefined && typeof cours !== 'string') return { statut: 400, corps: { erreur: 'cours invalide' } }
    const pieces = documentsValides(documents)
    if (!pieces) return { statut: 400, corps: { erreur: 'pièces jointes invalides (PDF, JPEG, PNG, WebP ou GIF)' } }

    // Ordre : pièces jointes, cours (mis en cache : régénérer sur le même chapitre coûte ~20x moins en entrée), consigne.
    const contenu = [
      ...pieces.map((d) => d.media_type === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: d.media_type, data: d.data } }
        : { type: 'image', source: { type: 'base64', media_type: d.media_type, data: d.data } }),
      ...(cours ? [{ type: 'text', text: cours, cache_control: { type: 'ephemeral' } }] : []),
      { type: 'text', text: utilisateur },
    ]
    const requete = {
      model: modele,
      max_tokens: long ? 64000 : 16000,
      // Si le modèle décline (classifieurs de sécurité), l'API relance la demande sur un modèle de repli.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: EFFORTS.has(effort) ? effort : 'high', format: { type: 'json_schema', schema } },
      system: systeme,
      messages: [{ role: 'user', content: contenu }],
    }
    try {
      // Les réponses longues (import d'un cours entier) passent en streaming pour éviter les délais d'attente HTTP.
      const reponse = long
        ? await client.beta.messages.stream(requete).finalMessage()
        : await client.beta.messages.create(requete)
      const cout = coutEstime(reponse.model, reponse.usage)
      if (reponse.stop_reason === 'refusal') {
        return { statut: 422, corps: { erreur: 'Le modèle a refusé cette demande.', cout } }
      }
      if (reponse.stop_reason === 'max_tokens') {
        return { statut: 502, corps: { erreur: 'Réponse tronquée (trop longue) : découpe le document ou demande moins d’éléments.', cout } }
      }
      const texte = reponse.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
      try {
        return { statut: 200, corps: { donnees: JSON.parse(texte), modele: reponse.model, cout } }
      } catch {
        return { statut: 502, corps: { erreur: 'Réponse du modèle illisible, réessaie.', cout } }
      }
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
        return { statut: 502, corps: { erreur: 'Clé API Anthropic absente ou refusée (ANTHROPIC_API_KEY dans atelier/.env).' } }
      }
      if (e instanceof Anthropic.RateLimitError) return { statut: 429, corps: { erreur: 'Limite de requêtes Anthropic atteinte, réessaie dans un instant.' } }
      if (e instanceof Anthropic.BadRequestError) return { statut: 400, corps: { erreur: `Requête refusée par l’API : ${e.message}` } }
      if (e instanceof Anthropic.APIConnectionError) return { statut: 503, corps: { erreur: 'API Anthropic injoignable (connexion Internet ?).' } }
      if (e instanceof Anthropic.APIError) return { statut: 502, corps: { erreur: `Erreur de l’API Anthropic (${e.status ?? '?'}).` } }
      if (e instanceof Error && /resolve authentication method/i.test(e.message)) {
        // Aucune clé trouvée (ni ANTHROPIC_API_KEY, ni profil `ant`) : le SDK échoue avant même d'appeler l'API.
        return { statut: 503, corps: { erreur: SANS_CLE } }
      }
      console.error('[ATELIER] erreur Claude :', e)
      if (e instanceof Anthropic.AnthropicError) return { statut: 500, corps: { erreur: `Erreur du SDK Anthropic : ${e.message.slice(0, 200)}` } }
      return { statut: 500, corps: { erreur: 'Erreur inattendue pendant l’appel à Claude.' } }
    }
  }

  return { json, cleConfiguree: Boolean(cle) }
}
