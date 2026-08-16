import torchaudio as ta
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
from scipy.io.wavfile import read
import sounddevice as sd
import time

class TTS:
    def __init__(self):
        self.model = ChatterboxMultilingualTTS.from_pretrained(
            device="cuda"
        )

    def parler(self, texte):
        frequence, audio = self.generer(texte)
        self.jouer(frequence, audio)

    def generer(self, texte):
        debut_generation = time.perf_counter()
        wav = self.model.generate(
            texte,
            language_id="fr",
            audio_prompt_path="data/voices/voix_elise.wav"
        )
        fin_generation = time.perf_counter()
        print(
            f"[TTS] Génération '{texte}' : "
            f"{fin_generation - debut_generation:.2f} s"
        )
        ta.save(
            "reponse_elise.wav",
            wav,
            self.model.sr
        )

        frequence, audio = read("reponse_elise.wav")
        duree_a_couper = 0.15  # 100 ms
        echantillons_a_couper = int(frequence * duree_a_couper)

        audio = audio[:-echantillons_a_couper]
        return frequence, audio

    def jouer(self, frequence, audio):
        sd.play(audio, frequence)
        sd.wait()
