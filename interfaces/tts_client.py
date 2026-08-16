import io
import json
import urllib.request

import sounddevice as sd
from scipy.io.wavfile import read


class TTSClient:
    def __init__(self):
        self.url = "http://localhost:8080/tts"

    def generer(self, texte):
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

        with urllib.request.urlopen(requete, timeout=60) as reponse:
            audio_wav = reponse.read()
            with open("debug_tts.wav", "wb") as f:
                f.write(audio_wav)

        return audio_wav

    def jouer(self, audio_wav):
        fichier_audio = io.BytesIO(audio_wav)

        frequence, audio = read(fichier_audio)

        sd.play(audio, frequence)
        sd.wait()

    def parler(self, texte):
        audio_wav = self.generer(texte)
        self.jouer(audio_wav)