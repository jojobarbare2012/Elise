from interfaces import tts_client,stt
from core import elise
from module.applications import lancer_application_locale
from module.tache import (
    outil_ajouter_tache,
    outil_lister_taches,
    outil_modifier_statut,
    outil_supprimer_tache
)
import time
from queue import Queue
from threading import Thread

def worker_tts():
    while True:
        phrase = file_tts.get()

        if phrase is None:
            break

        tts.parler(phrase)
        file_tts.task_done()

def preparer_texte_tts(texte):
    texte = texte.replace("(", ", ")
    texte = texte.replace(")", "")
    texte = texte.replace(":", "")
    texte = texte.replace("**", "")
    texte = texte.replace("-", ",")
    return texte

def envoyer_au_tts(phrase):
    phrase_tts = preparer_texte_tts(phrase)
    print(f"\n[TTS] {phrase_tts}")
    file_tts.put(phrase_tts)

file_tts = Queue()
tts = tts_client.TTSClient()
thread_tts = Thread(target=worker_tts, daemon=True)
thread_tts.start()
elise = elise.Elise('qwen3:8b',[lancer_application_locale,
    outil_ajouter_tache,
    outil_lister_taches,
    outil_modifier_statut,
    outil_supprimer_tache])
stt=stt.STT()

while True:
    print("Écoute...")
    # --- STT ---

    message = stt.ecouter()

    print("Vous :", message)
    commande = message.lower().strip()
    if "arrête-toi" in commande or "arrête toi" in commande:
        print("Arrêt d'Élise.")
        file_tts.put(None)
        break

    reponse = elise.repondre(
        message,
        callback=envoyer_au_tts
    )



    #print("Élise :", reponse)
    #tts.parler(reponse)
