# Atelier

Outil de travail et de révision façon Notion, local et privé. Indépendant d'Élise pour l'instant
(aucun fichier d'Élise n'est touché), prévu pour s'y brancher plus tard.

```bash
cd atelier && npm install && npm run dev   # http://localhost:5174
npm test                                   # SM-2, extraction de texte, validation des QCM
```

## Fonctions
- **Pages** : arbre de pages/matières, éditeur de blocs (`/` pour titres, listes, tâches, tableaux, code ;
  `@` pour lier une page ; rétroliens).
- **Cartes** : répétition espacée SM-2, import des lignes `Question :: Réponse`, génération IA depuis un cours.
- **QCM** : générés depuis une matière/page ou un sujet libre (Ollama), correction avec explications,
  historique des scores, erreurs ajoutables aux cartes.
- **Tâches** : kanban (glisser-déposer), priorités, échéances, matière liée.
- **Planning** : minuteur pomodoro, historique 7 jours, examens avec compte à rebours.
- **Ctrl+K** : recherche globale. **Réglages** : modèle Ollama, durées, couleur du système, export/import JSON.
- **Tableau de bord modulaire** : modules déplaçables (glisser), masquables, largeur 1 à 3 colonnes ("Configurer les modules").
- **DA** : HUD holographique, aucune emoji (icônes SVG en traits, `src/components/Icone.tsx`), brique `Module` réutilisable.

## IA : Claude (par défaut) ou Ollama
- **Claude** (`claude-opus-5-5`) génère QCM et cartes via le serveur d'Atelier, qui garde la clé : elle n'est jamais envoyée
  au navigateur ni au téléphone. Créer `atelier/.env` (non versionné) :
  ```
  ANTHROPIC_API_KEY=sk-ant-...
  ```
  puis relancer `npm run dev` / `npm start`. Sortie structurée (JSON garanti conforme au schéma), effort `high` pour créer,
  `medium` pour relire ; en cas de refus du modèle, l'API relance automatiquement sur un modèle de repli (`fallbacks: "default"`).
  **Dépendance cloud** : le texte des cours utilisés part chez Anthropic, et chaque génération est facturée sur le compte de la clé.
- **Import de cours** : PDF ou photos de pages → Claude transcrit le cours (titres, listes, tableaux, chiffres) dans une
  nouvelle page (bouton livre de la barre latérale, ou « Importer un cours ici » dans une page). Claude uniquement.
- **Flashcards ciblées** : uniquement des définitions, des valeurs chiffrées (RNP, valeurs normales, kcal/g…) ou des faits
  précis (formule, nom d'enzyme). Contrôlé en code : une « valeur » doit contenir un nombre, réponses courtes.
- **QCM** : « pourquoi les autres réponses sont fausses » pour chaque proposition ; source « Mes points faibles »
  (questions ratées + cartes oubliées) que Claude réinterroge sous d'autres angles.
- **Maîtrise par chapitre** (module de l'accueil) : cartes maîtrisées (intervalle ≥ 21 jours), oubliées, score QCM.
- **Coût** : chaque génération est estimée et cumulée (Réglages → Dépenses IA). Le cours est mis en cache côté API :
  QCM, cartes et relecture successifs sur le même chapitre paient l'entrée ~20x moins cher.
- **Plan de révision** : pour chaque examen rattaché à une matière, séances réparties jusqu'à la veille (chapitres faibles
  d'abord et plus souvent, examen blanc la veille), recalculées chaque jour selon la maîtrise ; séances à cocher.
- **Examen blanc** : questions tirées des QCM existants (gratuit), chronométré, correction à la fin.
- **Cartes en sens inversé** (réponse → question), avec un suivi de révision séparé. Liens « @ » toujours à jour.
- **Téléphone** : tiroir de navigation, gestes sur les cartes (droite = Bien, gauche = À revoir), appli installable
  (PWA, interface hors ligne) — installation possible seulement en HTTPS ou localhost (ex. `tailscale serve`).
- **Ollama** (local, réglable dans Réglages) reste disponible ; son contexte limité tronque les cours longs (signalé).

## Données et IA (historique)
- Données sur disque : voir « Stockage sur disque » ci-dessous (le navigateur ne garde qu'un cache).
- IA : Ollama local via le proxy Vite `/ollama` → `:11434`. Modèle réglable (défaut `qwen3:14b`,
  celui d'Élise). Seul `src/lib/llm.ts` connaît Ollama.

## Espace de travail et effets
- **Espace de travail** : jusqu'à 4 modules côte à côte (page, cartes, QCM, tâches, minuteur, planning, tableau de bord),
  redimensionnables au séparateur, déplaçables, fermables ; préréglages « Révision », « Planification », « Cours + QCM ».
  Le bouton « Espace » d'une page l'ouvre directement dans l'espace.
- **Grilles de modules** (`GrilleModules`) : l'accueil et le planning se réorganisent ; disposition mémorisée par vue.
- **Démarrage** : écran d'initialisation qui affiche l'état réel (mémoire locale, révisions dues, joignabilité d'Ollama) ;
  désactivable dans les Réglages, ignoré si le système demande moins d'animations.
- **Minuteur** : anneau de progression façon réacteur ; le décompte actif s'affiche dans la barre latérale.
- **Transitions** : balayage lumineux et apparition en fondu à chaque changement de vue, modules en cascade.

## Stockage sur disque
Fichier unique et lisible : `atelier/donnees/atelier.json` (hors Git), avec une copie `.bak` et une sauvegarde par jour
dans `donnees/sauvegardes/` (30 jours gardés). Écriture atomique ; une révision détecte les modifications faites ailleurs.
Seules les données (pages, cartes, QCM, tâches, examens, sessions, réglages) sont synchronisées ; la disposition des modules et
l'espace de travail restent propres à chaque appareil.

- **Sur le PC** : `npm run dev` suffit (le stockage tourne dans le serveur Vite) ; les données du navigateur sont migrées
  automatiquement vers le disque au premier lancement.
- **Depuis le téléphone** : `npm start` compile l'appli et lance un serveur unique (port 5175) qui sert l'interface, le stockage
  et un relais vers Ollama. Il n'écoute que sur la machine ; pour y accéder à distance, **uniquement via VPN** (Tailscale/WireGuard) :
  ```powershell
  $env:ATELIER_HOTE = "0.0.0.0"; $env:ATELIER_JETON = "un-long-secret"; npm start
  ```
  Le serveur refuse de démarrer hors de la machine sans jeton ; le téléphone demande le jeton au premier accès.
- Variables : `ATELIER_PORT`, `ATELIER_HOTE`, `ATELIER_JETON`, `ATELIER_DONNEES`, `OLLAMA_URL`.
- **Conflit** (l'autre appareil a modifié pendant que celui-ci avait des changements non envoyés) : un bandeau propose
  d'exporter sa version, de prendre celle du disque ou de garder la sienne ; rien n'est jamais écrasé automatiquement.
- **Restaurer** : copier un fichier de `donnees/sauvegardes/` vers `donnees/atelier.json` (serveur arrêté), :
  les appareils se resynchronisent seuls.
