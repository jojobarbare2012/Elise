/**
 * Identifiant unique. `crypto.randomUUID` n'existe que dans un contexte sécurisé (HTTPS ou localhost) :
 * sur le téléphone via Tailscale en http://, il est absent. On retombe alors sur getRandomValues (toujours disponible).
 */
export function nouvelId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') {
    try { return c.randomUUID() } catch { /* contexte non sécurisé */ }
  }
  const o = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(o)
  else for (let i = 0; i < 16; i++) o[i] = Math.floor(Math.random() * 256)
  o[6] = (o[6] & 0x0f) | 0x40 // version 4
  o[8] = (o[8] & 0x3f) | 0x80 // variante
  const h = [...o].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
