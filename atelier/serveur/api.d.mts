import type { IncomingMessage, ServerResponse } from 'node:http'
export function donneesValides(d: unknown): boolean
export function creerApi(options: { dossier: string; jeton?: string; ollama?: string; anthropic?: { cle?: string; baseURL?: string } }): (
  req: IncomingMessage, res: ServerResponse, next?: () => void,
) => Promise<void>
