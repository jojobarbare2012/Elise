import type { IncomingMessage, ServerResponse } from 'node:http'
export function donneesValides(d: unknown): boolean
export function creerApi(options: { dossier: string; jeton?: string; ollama?: string }): (
  req: IncomingMessage, res: ServerResponse, next?: () => void,
) => Promise<void>
