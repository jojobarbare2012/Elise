// Service worker d'Atelier : l'interface reste disponible hors ligne. Les données passent par l'API (jamais en cache).
const CACHE = 'atelier-v1'
const COQUILLE = ['/', '/index.html', '/manifest.webmanifest', '/icone.svg', '/icone-192.png']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(COQUILLE)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((cles) => Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ollama/')) return // données et IA : toujours le réseau
  if (e.request.mode === 'navigate') {
    // Page : réseau d'abord (dernière version), sinon la copie en cache.
    e.respondWith(fetch(e.request).then((r) => { caches.open(CACHE).then((c) => c.put('/index.html', r.clone())); return r }).catch(() => caches.match('/index.html')))
    return
  }
  // Fichiers versionnés (assets/…-hash.js) et polices : cache d'abord.
  e.respondWith(caches.match(e.request).then((trouve) => trouve || fetch(e.request).then((r) => {
    if (r.ok && (url.pathname.startsWith('/assets/') || /\.(woff2?|png|svg)$/.test(url.pathname))) {
      const copie = r.clone()
      caches.open(CACHE).then((c) => c.put(e.request, copie))
    }
    return r
  })))
})
