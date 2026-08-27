import io
import json
import urllib.request
import time

import sounddevice as sd
from scipy.io.wavfile import read


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

    def parler(self, texte):
        audio_wav = self.generer(texte)
        self.jouer(audio_wav)