import type { ReactElement, SVGProps } from 'react'

// Icônes en traits fins (24x24), au style HUD. Aucune dépendance, couleur = currentColor.
const TRACES: Record<string, ReactElement> = {
  accueil: <><path d="M3 11 12 3l9 8" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>,
  cartes: <><rect x="3" y="6" width="14" height="14" rx="1" /><path d="M7 6V4h14v14h-2" /><path d="M7 11h6M7 15h4" /></>,
  qcm: <><rect x="3" y="3" width="18" height="18" rx="1" /><path d="m7 8 2 2 3-4" /><path d="M14 8h4M7 15h.01M14 15h4" /></>,
  taches: <><rect x="3" y="4" width="5" height="16" /><rect x="10" y="4" width="5" height="10" /><rect x="17" y="4" width="4" height="13" /></>,
  planning: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M9 3h6" /></>,
  recherche: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.8-4.8" /></>,
  reglages: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  corbeille: <><path d="M4 7h16M10 4h4M6 7l1 13h10l1-13" /><path d="M10 11v6M14 11v6" /></>,
  fleche: <path d="m9 6 6 6-6 6" />,
  fleche_bas: <path d="m6 9 6 6 6-6" />,
  fermer: <path d="M6 6l12 12M18 6 6 18" />,
  oeil: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  oeil_barre: <><path d="M3 3l18 18" /><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4-.8" /></>,
  poignee: <><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></>,
  modules: <><rect x="3" y="3" width="8" height="8" /><rect x="13" y="3" width="8" height="5" /><rect x="13" y="10" width="8" height="11" /><rect x="3" y="13" width="8" height="8" /></>,
  etincelle: <path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3" />,
  calendrier: <><rect x="3" y="5" width="18" height="16" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  pause: <path d="M8 5v14M16 5v14" />,
  cible: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><path d="M12 1v4M12 19v4M1 12h4M19 12h4" /></>,
  valide: <path d="m4 12 5 5L20 6" />,
  liste: <path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  citation: <path d="M5 8h5v6H6a2 2 0 0 0 2 3M14 8h5v6h-4a2 2 0 0 0 2 3" />,
  tableau: <><rect x="3" y="4" width="18" height="16" /><path d="M3 10h18M3 15h18M9 4v16" /></>,
  separateur: <path d="M3 12h18" />,
  code: <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />,
  titre: <path d="M5 5v14M5 12h10M15 5v14" />,
  question: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" /></>,
  // Icônes de pages (choisies par l'utilisateur)
  page: <><path d="M6 3h9l4 4v14H6Z" /><path d="M14 3v5h5M9 13h7M9 17h5" /></>,
  livre: <><path d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4Z" /><path d="M20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6Z" /></>,
  fiole: <><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" /><path d="M8 15h8" /></>,
  calcul: <><rect x="5" y="3" width="14" height="18" rx="1" /><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" /></>,
  cerveau: <><path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 5 1V5a2 2 0 0 0-2-1Z" /><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-5 1V5a2 2 0 0 1 2-1Z" /></>,
  graphique: <><path d="M3 3v18h18" /><path d="m7 15 4-5 3 3 5-7" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></>,
  balance: <><path d="M12 3v18M6 21h12M4 7h16" /><path d="m4 7-2 7a3 3 0 0 0 6 0Zm16 0-2 7a3 3 0 0 0 6 0Z" /></>,
  crayon: <><path d="M4 20l1-4L17 4l3 3L8 19Z" /><path d="m14 7 3 3" /></>,
  bibliotheque: <><path d="M4 4h4v16H4ZM10 4h4v16h-4Z" /><path d="m16 6 4-1 3 14-4 1Z" /></>,
}

export const ICONES_PAGE = ['page', 'livre', 'fiole', 'calcul', 'code', 'cerveau', 'graphique', 'globe', 'balance', 'cible', 'crayon', 'bibliotheque']

export type NomIcone = keyof typeof TRACES | string

/** Une page peut encore porter un ancien emoji (données existantes) : on retombe sur « page ». */
export const iconeValide = (nom: string) => (nom in TRACES ? nom : 'page')

export function Icone({ nom, taille = 18, ...reste }: { nom: NomIcone; taille?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      className="icone"
      width={taille}
      height={taille}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...reste}
    >
      {TRACES[iconeValide(nom)]}
    </svg>
  )
}
