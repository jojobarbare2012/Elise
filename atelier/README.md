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
- **Ctrl+K** : recherche globale. **Réglages** : modèle Ollama, durées, export/import JSON.

## Données et IA
- Données dans le `localStorage` du navigateur : **exporter régulièrement** (Réglages).
- IA : Ollama local via le proxy Vite `/ollama` → `:11434`. Modèle réglable (défaut `qwen3:14b`,
  celui d'Élise). Seul `src/lib/llm.ts` connaît Ollama.
