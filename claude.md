# Élise

Élise est un assistant IA personnel local.

## Architecture générale

Le PC est le backend central.

Interfaces :
- interface desktop Tauri
- interface web/mobile
- future application Android
- futures lunettes connectées

Toutes les interfaces utilisent le même backend FastAPI.

Le téléphone ne doit pas dupliquer les bases de données ni les outils.
Il agit comme interface distante vers le PC.

## Modèles

LLM principal :
- Ollama
- qwen3:14b
- think=False

Mémoire :
- qwen3:4b à la demande
- nomic-embed-text à la demande
- ne pas garder les modèles mémoire résidents inutilement

STT :
- faster-whisper medium
- CUDA
- int8_float16
- Silero VAD

TTS :
- Fish Speech
- serveur HTTP sous WSL
- port 8080

## Structure

core/
- elise.py : orchestration principale
- memoire.py : mémoire persistante
- etat.py
- personnalite.py

modules/
- applications.py
- calendrier.py
- taches.py
- fonctions.py

services/
- stt.py
- tts.py
- fish.py
- ollama.py
- vocal.py actuellement vide
- gestionnaire.py

interfaces/
- web.py : FastAPI + routes HTTP/WebSocket
- static/ : frontend HTML/CSS/JS

launcher.py :
- démarre les services nécessaires
- démarre FastAPI
- utilisé par Tauri

## Calendrier

Le calendrier utilise SQLite :
data/calendrier.db

Il possède :
- ajout
- liste
- modification
- suppression
- recherche
- résolution déterministe des dates relatives

Le LLM ne doit pas calculer lui-même les dates relatives.

## Vocal

Le pipeline actuel est :

micro
→ sounddevice callback + Queue
→ Silero VAD
→ faster-whisper
→ Élise
→ Fish Speech
→ lecture audio

Important :
ne pas réintroduire de stream.read() bloquant.
La capture audio a été changée en callback + Queue car stream.read()
bloquait le thread vocal sous Windows.

## TTS

services/tts.py possède GestionnaireTTS.

Il gère :
- file_tts
- file_audio
- worker génération
- worker lecture
- état en_cours

Ne pas recréer un deuxième pipeline TTS dans interfaces/web.py.

core/elise.py effectue déjà la segmentation des phrases TTS.

## Mobile

FastAPI écoute sur :
0.0.0.0:8000

Le téléphone accède au PC via Tailscale.

L'accès Tailscale est limité :
téléphone → PC TCP 8000 uniquement.

Objectif :
créer une application Android légère qui agit principalement comme interface
vers le backend PC.

Les modifications backend ou frontend servies par le PC ne doivent pas nécessiter
de rebuild APK.

Un rebuild mobile ne doit être nécessaire que pour les fonctionnalités natives
Android.

## Contraintes importantes

- RTX 5070 Ti 16 Go
- RAM 32 Go
- éviter de garder trop de modèles en VRAM
- Qwen 14B doit rester prioritaire
- Fish tourne sous WSL
- Whisper tourne localement sur CUDA

## Style de développement

- ne pas faire de gros refactors inutiles
- progresser par petites unités testables
- préserver les fonctionnalités existantes
- avant une modification importante, vérifier les dépendances
- ne pas dupliquer la logique entre interfaces
- garder le backend comme source de vérité
- utiliser Git avant les grosses modifications

## Prochaines étapes

1. Finaliser le portage Android/Tauri
2. Ajouter vocal mobile
3. Notifications mobiles
4. Commencer l'auto-développement contrôlé d'Élise :
   proposition de patch
   → tests
   → présentation des changements
   → approbation utilisateur
   → application
   → retest
   → rollback possible