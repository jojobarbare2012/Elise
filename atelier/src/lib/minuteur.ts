import { create } from 'zustand'
import { useStore } from './store'

type Phase = 'travail' | 'pause'

interface EtatMinuteur {
  phase: Phase
  actif: boolean
  commence: boolean // une phase est entamée (en cours ou en pause)
  finLe: number | null // timestamp ms de fin quand actif
  restantMs: number // temps restant quand en pause
  pageId: string | null
  maintenant: number
  demarrer: (pageId?: string | null) => void
  pause: () => void
  reprendre: () => void
  reinitialiser: () => void
  tic: () => void
}

const duree = (phase: Phase) => {
  const { dureeTravail, dureePause } = useStore.getState().reglages
  return (phase === 'travail' ? dureeTravail : dureePause) * 60_000
}

export const useMinuteur = create<EtatMinuteur>((set, get) => ({
  phase: 'travail',
  actif: false,
  commence: false,
  finLe: null,
  restantMs: 25 * 60_000,
  pageId: null,
  maintenant: Date.now(),

  demarrer: (pageId = null) => {
    const { phase } = get()
    set({ actif: true, commence: true, finLe: Date.now() + duree(phase), pageId, maintenant: Date.now() })
  },
  pause: () => {
    const { finLe } = get()
    set({ actif: false, restantMs: Math.max(0, (finLe ?? Date.now()) - Date.now()), finLe: null })
  },
  reprendre: () => set({ actif: true, commence: true, finLe: Date.now() + get().restantMs, maintenant: Date.now() }),
  reinitialiser: () => set({ actif: false, commence: false, finLe: null, restantMs: duree(get().phase) }),
  tic: () => {
    const { actif, finLe, phase, pageId } = get()
    const maintenant = Date.now()
    if (!actif || finLe === null) return set({ maintenant })
    if (maintenant < finLe) return set({ maintenant })
    // Fin de phase : on enregistre le travail puis on enchaîne sur l'autre phase (en pause).
    if (phase === 'travail') {
      useStore.getState().enregistrerSession(useStore.getState().reglages.dureeTravail, pageId)
    }
    const suivante: Phase = phase === 'travail' ? 'pause' : 'travail'
    try { new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=').play().catch(() => {}) } catch { /* ignoré */ }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(phase === 'travail' ? 'Pause !' : 'On reprend', { body: phase === 'travail' ? 'Bien joué, souffle un peu.' : 'Nouvelle session de travail.' })
    }
    set({ phase: suivante, actif: false, commence: false, finLe: null, restantMs: duree(suivante), maintenant })
  },
}))

export function formaterDuree(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
