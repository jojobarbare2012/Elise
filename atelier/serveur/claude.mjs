// Relais vers l'API Claude (Anthropic). La clé reste côté serveur : le navigateur ne la voit jamais.
// DÉPENDANCE CLOUD : le contenu des cours envoyé ici part chez Anthropic.
import Anthropic from '@anthropic-ai/sdk'

const MODELES_AUTORISES = /^claude-[a-z0-9-]+$/
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

/**
 * @param {{ cle?: string, baseURL?: string }} options
 */
export function creerClaude({ cle, baseURL } = {}) {
  const client = new Anthropic({ ...(cle ? { apiKey: cle } : {}), ...(baseURL ? { baseURL } : {}), maxRetries: 2, timeout: 5 * 60_000 })

  /** Renvoie { statut, corps } pour une demande de JSON structuré. */
  async function json({ modele, systeme, utilisateur, schema, effort }) {
    if (typeof modele !== 'string' || !MODELES_AUTORISES.test(modele)) return { statut: 400, corps: { erreur: 'modèle invalide' } }
    if (typeof systeme !== 'string' || typeof utilisateur !== 'string' || !schema || typeof schema !== 'object') {
      return { statut: 400, corps: { erreur: 'demande invalide' } }
    }
    try {
      const reponse = await client.beta.messages.create({
        model: modele,
        max_tokens: 16000,
        // Si le modèle décline (classifieurs de sécurité), l'API relance la demande sur un modèle de repli.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: EFFORTS.has(effort) ? effort : 'high', format: { type: 'json_schema', schema } },
        system: systeme,
        messages: [{ role: 'user', content: utilisateur }],
      })
      if (reponse.stop_reason === 'refusal') {
        return { statut: 422, corps: { erreur: 'Le modèle a refusé cette demande.' } }
      }
      if (reponse.stop_reason === 'max_tokens') {
        return { statut: 502, corps: { erreur: 'Réponse tronquée (trop longue) : demande moins d’éléments.' } }
      }
      const texte = reponse.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
      try {
        return { statut: 200, corps: { donnees: JSON.parse(texte), modele: reponse.model } }
      } catch {
        return { statut: 502, corps: { erreur: 'Réponse du modèle illisible, réessaie.' } }
      }
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
        return { statut: 502, corps: { erreur: 'Clé API Anthropic absente ou refusée (ANTHROPIC_API_KEY dans atelier/.env).' } }
      }
      if (e instanceof Anthropic.RateLimitError) return { statut: 429, corps: { erreur: 'Limite de requêtes Anthropic atteinte, réessaie dans un instant.' } }
      if (e instanceof Anthropic.BadRequestError) return { statut: 400, corps: { erreur: `Requête refusée par l’API : ${e.message}` } }
      if (e instanceof Anthropic.APIConnectionError) return { statut: 503, corps: { erreur: 'API Anthropic injoignable (connexion Internet ?).' } }
      if (e instanceof Anthropic.APIError) return { statut: 502, corps: { erreur: `Erreur de l’API Anthropic (${e.status ?? '?'}).` } }
      console.error('[ATELIER] erreur Claude :', e)
      return { statut: 500, corps: { erreur: 'Erreur inattendue pendant l’appel à Claude.' } }
    }
  }

  return { json, cleConfiguree: Boolean(cle) }
}
