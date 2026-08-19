from queue import Queue
from threading import Thread

from core.elise import Elise
from interfaces.stt import STT
from interfaces.tts_client import TTSClient
from module.applications import lancer_application_locale
from module.tache import (
    outil_ajouter_tache,
    outil_lister_taches,
    outil_modifier_statut,
    outil_supprimer_tache,
)


file_tts = Queue()
file_audio = Queue()

tts = TTSClient()


def worker_generation():
    while True:
        phrase = file_tts.get()

        if phrase is None:
            file_tts.task_done()
            file_audio.put(None)
            break

        try:
            audio_wav = tts.generer(phrase)
            file_audio.put(audio_wav)

        except Exception as erreur:
            print(f"[TTS] Erreur de génération : {erreur}")

        finally:
            file_tts.task_done()


def worker_lecture():
    while True:
        audio_wav = file_audio.get()

        if audio_wav is None:
            file_audio.task_done()
            break

        try:
            tts.jouer(audio_wav)

        except Exception as erreur:
            print(f"[TTS] Erreur de lecture : {erreur}")

        finally:
            file_audio.task_done()




def main():
    thread_generation = Thread(
        target=worker_generation,
        daemon=True,
    )

    thread_lecture = Thread(
        target=worker_lecture,
        daemon=True,
    )

    thread_generation.start()
    thread_lecture.start()

    assistant = Elise(
        "qwen3:8b",
        [
            lancer_application_locale,
            outil_ajouter_tache,
            outil_lister_taches,
            outil_modifier_statut,
            outil_supprimer_tache,
        ],
    )

    reconnaissance_vocale = STT()

    while True:
        print("Écoute...")

        message = reconnaissance_vocale.ecouter()
        print("Vous :", message)

        commande = message.lower().strip()

        if "arrête-toi" in commande or "arrête toi" in commande:
            print("Arrêt d'Élise.")
            file_tts.put(None)
            break

        assistant.repondre(
            message,
            callback=envoyer_au_tts,
        )


if __name__ == "__main__":
    main()