from faster_whisper import WhisperModel
import sounddevice as sd
from scipy.io.wavfile import write,read



class STT:
    def __init__(self):
        self.model = WhisperModel(
            "small",
            device="cuda",
            compute_type="float16"
        )
        self.frequence = 16000
        self.duree = 5

    def ecouter(self):
        audio = sd.rec(
            int(self.duree * self.frequence),
            samplerate=self.frequence,
            channels=1,
            dtype="float32"
        )
        sd.wait()
        write("micro_test.wav", self.frequence, audio)
        segments, info = self.model.transcribe(
            "micro_test.wav",
            language="fr"
        )
        texte=""
        for segment in segments:
            texte=texte+segment.text+" "
        return texte

