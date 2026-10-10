import io
import json
import urllib.request
import time
import re

from queue import Queue
from threading import Thread, Event

import sounddevice as sd
from scipy.io.wavfile import read


EMOJI_PATTERN = re.compile(
    "["
    "\U0001F300-\U0001F5FF"
    "\U0001F600-\U0001F64F"
    "\U0001F680-\U0001F6FF"
    "\U0001F700-\U0001F77F"
    "\U0001F780-\U0001F7FF"
    "\U0001F800-\U0001F8FF"
    "\U0001F900-\U0001F9FF"
    "\U0001FA00-\U0001FAFF"
    "\U00002600-\U000026FF"
    "\U00002700-\U000027BF"
    "]+",
    flags=re.UNICODE,
)


class TTSClient:
    def __init__(self, url="http://127.0.0.1:8080/tts"):
        self.url = url

    def generer(self, texte):
        debut = time.perf_counter()

        donnees = json.dumps({
            "text": texte
        }).encode("utf-8")

        requete = urllib.request.Request(
            self.url,
            data=donnees,
            headers={
                "Content-Type": "application/json"
            },
            method="POST"
        )

        with urllib.request.urlopen(
            requete,
            timeout=60
        ) as reponse:
            temps_headers = time.perf_counter() - debut
            audio_wav = reponse.read()

        temps_total = time.perf_counter() - debut

        print(
            f"[PERF TTS] headers : {temps_headers:.3f}s | "
            f"audio complet : {temps_total:.3f}s"
        )

        return audio_wav

    def jouer(self, audio_wav):
        fichier_audio = io.BytesIO(audio_wav)

        frequence, audio = read(fichier_audio)

        sd.play(audio, frequence)
        sd.wait()


def nettoyer_texte(texte):
    texte = re.sub(r"\*\*(.*?)\*\*", r"\1", texte)
    texte = re.sub(r"\*(.*?)\*", r"\1", texte)
    texte = re.sub(r"`([^`]*)`", r"\1", texte)
    texte = re.sub(r"\s+([,.;:!?])", r"\1", texte)
    texte = re.sub(r"([,.;:!?])(?=\S)", r"\1 ", texte)
    texte = EMOJI_PATTERN.sub("", texte)

    texte = texte.replace("(", ", ")
    texte = texte.replace(")", ", ")

    texte = texte.replace('"', "")
    texte = texte.replace("“", "")
    texte = texte.replace("”", "")

    remplacements = {
        "HTTPS": "H T T P S",
        "HTTP": "H T T P",
        "TCP": "T C P",
        "UDP": "U D P",
        "API": "A P I",
        "URL": "U R L",
        "HTML": "H T M L",
        "CSS": "C S S",
        "WebSocket": "Web Socket",
    }

    for original, remplacement in remplacements.items():
        texte = texte.replace(original, remplacement)

    texte = re.sub(r"\s+", " ", texte)
    texte = re.sub(r",\s*,+", ",", texte)

    return texte.strip(" ,")


class GestionnaireTTS:
    def __init__(self):
        self.client = TTSClient()

        self.file_tts = Queue()
        self.file_audio = Queue()

        self.en_cours = Event()

        Thread(
            target=self._worker_generation,
            daemon=True
        ).start()

        Thread(
            target=self._worker_lecture,
            daemon=True
        ).start()

        self.callback_debut_lecture = None
        self.callback_fin_lecture = None

    def envoyer(self, phrase):
        phrase = nettoyer_texte(phrase)

        if not phrase:
            return

        self.file_tts.put(phrase)

    def est_occupe(self):
        return (
            self.en_cours.is_set()
            or not self.file_audio.empty()
            or not self.file_tts.empty()
        )

    def _worker_generation(self):
        while True:
            phrase = self.file_tts.get()

            try:
                audio_wav = self.client.generer(phrase)
                self.file_audio.put(audio_wav)

            except Exception as erreur:
                print(
                    "[TTS] Erreur génération :",
                    erreur
                )

            finally:
                self.file_tts.task_done()

    def _worker_lecture(self):
        while True:
            audio_wav = self.file_audio.get()

            self.en_cours.set()

            try:
                if self.callback_debut_lecture:
                    self.callback_debut_lecture()

                self.client.jouer(audio_wav)

            except Exception as erreur:
                print(
                    "[TTS] Erreur lecture :",
                    erreur
                )

            finally:
                if self.callback_fin_lecture:
                    self.callback_fin_lecture()

                self.en_cours.clear()
                self.file_audio.task_done()