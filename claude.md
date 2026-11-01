# Élise

Assistante personnelle vocale de Jonathan, en français. Code, commentaires et
noms de variables en français : garder cette convention.

## Vision

Élise vise à devenir un assistant de type « Jarvis » : une présence permanente qui
parle, se souvient, pilote l'environnement de Jonathan et, à terme, du matériel.
Objectif final : un **serveur privé** dont Jonathan est le seul propriétaire et
utilisateur, avec le meilleur modèle ouvert disponible le moment venu.

Pas d'entraînement de modèle from scratch. Le cerveau sera un modèle ouvert
existant, éventuellement fine-tuné (LoRA) sur les données personnelles d'Élise.

### Principes qui découlent de la vision

1. **Élise n'est pas le modèle.** Son identité = personnalité, mémoire, outils,
   voix, données. Le LLM doit rester remplaçable par configuration.
2. **Portabilité.** Cible : serveur Linux. Isoler tout ce qui dépend de Windows/WSL.
3. **Privé par défaut.** Jamais d'exposition directe sur Internet ; accès distant
   via VPN (WireGuard/Tailscale) + authentification.
4. **Les données sont le capital.** Mémoire, conversations, préférences : formats
   simples, sauvegardables, indépendants d'un modèle précis.
5. **Jonathan valide.** Élise peut auditer et proposer des améliorations de son
   propre code, mais ne s'auto-modifie jamais sans autorisation.

## Architecture actuelle

```
Tauri (src-tauri/src/lib.rs)
 └─ launcher.py            (venv .venv_tts) — orchestre les services
     ├─ WSL Ubuntu-24.04   maintenu éveillé
     ├─ Fish Speech (TTS)  systemd fish-elise.service dans WSL, :8080
     ├─ Ollama             :11434, précharge qwen3:14b
     └─ uvicorn interfaces.web:app  (venv .venv) :8000 — le vrai processus applicatif
          ├─ core.elise.Elise      boucle LLM + outils + streaming
          ├─ services.stt          Whisper medium (CUDA) + Silero VAD, en processus
          ├─ services.tts          GestionnaireTTS : file génération → file lecture
          ├─ worker_vocal (thread) micro → STT → Elise → TTS
          └─ WebSocket /ws         diffusé à tous les clients : transcription, reponse,
                                   memory_confirmation, calendrier_modifie
```

- **Tauri ↔ launcher** : le launcher affiche `[SETUP] <service> <ÉTAT>` sur stdout,
  Tauri relaie à `loading.html` (événement `setup-status`). Arrêt : Tauri écrit
  `data/shutdown.flag`, le launcher nettoie puis affiche `[SHUTDOWN] READY`.
- **`Elise.repondre()`** : confirmation mémoire en attente → prompt
  (`PROMPT_BASE` + `PROMPT_PERSONNALITE` + contexte temporel + souvenirs) →
  `ollama.chat` streamé avec outils → boucle d'outils (5 tours max) → découpage
  TTS (`FiltreTTSCODE`, `extraire_segments_tts`) → mémorisation en thread.
- **Mémoire** (`core/memoire.py`, `data/memoire.db`) : qwen3:4b extrait des
  souvenirs, `nomic-embed-text` pour la similarité, détection doublon/contradiction,
  confirmation demandée à Jonathan si un souvenir important est remplacé.
- **Outils** : fonctions Python passées directement à Ollama (signature + docstring
  = schéma). Préfixe `outil_`. Modules : `taches` (JSON), `calendrier` (SQLite),
  `applications` (cherche dans le menu Démarrer, les raccourcis du Bureau puis le
  registre ; `data/applications.json` ne contient que des surnoms ; une simple
  ressemblance de nom ne lance rien sans confirmation),
  `spotify` (API Web Spotify : lecture et commandes, voir ci-dessous).
  Nouvel outil = fonction documentée dans `modules/` + ajout à la liste dans
  `interfaces/web.py`.
- **Calendrier** : dates stockées en heure locale sans fuseau
  (`YYYY-MM-DDTHH:MM:SS`, via `normaliser_date`). Les dates relatives sont
  résolues par `resoudre_date_relative`, jamais par le LLM. Après chaque
  écriture, le module prévient ses abonnés (`abonner_modifications`) ; `web.py`
  diffuse alors `calendrier_modifie` et le front relit `GET /calendrier/evenements`.
- **Spotify** (`modules/spotify.py`) : **dépendance cloud** (Internet + compte
  Premium). Connexion PKCE unique : `python -m modules.spotify connexion` ;
  `data/spotify.json` (client_id) et `data/spotify_jeton.json` hors Git.
  Pièges de l'appli de bureau : un titre envoyé seul (`uris`) ou le contexte
  « titres likés » sont ignorés → titre joué dans le contexte de son album,
  titres likés via la playlist privée miroir « Titres likés (Élise) ».
  API : `/me/playlists` et `/playlists/{id}/items` (`/users/...` et `/tracks`
  répondent 403). Chaque commande est vérifiée sur le lecteur avant de répondre.
- **Front** : `interfaces/static/` (JS vanilla, marked, highlight.js), servi par
  FastAPI et affiché dans la fenêtre Tauri.

## Environnement

- Windows + WSL Ubuntu-24.04 + GPU NVIDIA (partagé entre Qwen, Whisper, Fish).
- Deux venvs non documentés (`.venv` web, `.venv_tts` launcher) ; pas encore de
  `requirements.txt`.
- Les chemins `data/...` sont relatifs : lancer depuis la racine du projet.
- Lancement complet : l'app Tauri (`npx tauri dev`). Web seul :
  `python -m uvicorn interfaces.web:app --port 8000` (Ollama et Fish requis).

## Zones fragiles connues

- Une seule instance `Elise` partagée entre HTTP et vocal (sérialisée par
  `verrou_reponse`) ; historique de conversation jamais tronqué.
- `EtatElise` modifié par plusieurs threads (le TTS repasse à IDLE en pleine réflexion).
- Calendrier : un événement n'est listé que si son **début** est dans la période
  (un événement sur plusieurs jours n'apparaît que le premier jour).
- Couplage Windows : chemins absolus `C:\Users\Jonathan\...` dans `lib.rs`,
  `netstat`/`taskkill` dans `launcher.py`, `modules/applications.py` entièrement
  Windows (`Get-StartApps`, `winreg`, `shell:AppsFolder`).
- Modèle `qwen3:14b` codé en dur à plusieurs endroits ; `ollama.chat` appelé
  directement depuis `core/`.
- Sécurité : uvicorn sur `0.0.0.0` sans authentification (toutes les routes,
  dont `/calendrier/evenements`), CSP Tauri désactivée.
- `tests/` obsolète (imports `module.tache` qui n'existent plus) ;
  `services/gestionnaire.py` et `services/vocal.py` vides.

## Feuille de route

1. Stabiliser le cœur : fenêtre glissante d'historique. (Faits le 2026-10-31 :
   contexte dans la boucle d'outils, exceptions d'outils, verrou sur `repondre()`.)
2. Reproductibilité : `requirements.txt` par venv, config centrale (modèles, ports,
   chemins), suppression des chemins absolus.
3. Abstraction LLM (`services/llm.py`) pour rendre le modèle remplaçable.
4. Mode audit de nuit : Élise lance `claude -p` en lecture seule, stocke des
   propositions (statut proposée/acceptée/rejetée/faite) et les présente le matin.
5. Tests unitaires des fonctions pures (`extraire_segments_tts`, `FiltreTTSCODE`,
   `resoudre_date_relative`, `trouver_tache`).
6. Préparer la migration serveur Linux + accès VPN authentifié.

## Règles pour Claude

- **Ne modifier aucun fichier sans accord explicite de Jonathan.** Proposer
  d'abord, montrer le diff, attendre la validation.
- Pas de refactor non demandé ; garder les changements ciblés et dans le style
  existant (français, `print` préfixés `[TAG]` pour les logs).
- Ne pas lire : `node_modules/`, `src-tauri/target/`, `src-tauri/icons/`,
  `interfaces/static/marked.esm.js`, `interfaces/static/highlight.min.js`,
  `*.lock`, `package-lock.json`, `logs/`, `*.log` (sauf pour diagnostiquer un bug).
- `data/*.db`, `data/profil.json`, `data/liste_tache.json` sont des données
  personnelles : ne pas les lire sans demande.
- Garder en tête les principes de la vision : toute nouvelle dépendance à un
  modèle précis, à Windows ou à un service cloud doit être signalée.
