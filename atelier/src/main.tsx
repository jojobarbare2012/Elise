import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/rajdhani/500.css'
import '@fontsource/rajdhani/600.css'
import '@fontsource/rajdhani/700.css'
import '@fontsource/share-tech-mono/400.css'
import App from './App'
import './styles.css'
import { demarrerSynchro } from './lib/synchro'

demarrerSynchro()

// Appli installable + interface hors ligne. Le navigateur n'autorise le service worker qu'en contexte sécurisé
// (localhost ou HTTPS, par ex. `tailscale serve`) ; ailleurs l'appli fonctionne normalement, sans installation.
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}) })
}

createRoot(document.getElementById('racine')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
