import torchaudio as ta
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
from scipy.io.wavfile import read
import sounddevice as sd

class TTS:
    def __init__(self):
        self.model = ChatterboxMultilingualTTS.from_pretrained(
            device="cuda"
            )

    def parler(self, texte):
        wav = self.model.generate(
            texte,
            language_id="fr",
            audio_prompt_path="data/voices/voix_elise.wav"
        )

        ta.save(
            "reponse_elise.wav",
            wav,
            self.model.sr
        )
        frequence, audio = read("reponse_elise.wav")
        sd.play(audio, frequence)
        sd.wait()
