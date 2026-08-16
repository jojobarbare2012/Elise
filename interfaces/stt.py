from faster_whisper import WhisperModel
import sounddevice as sd
from scipy.io.wavfile import write
import numpy as np
from collections import deque
from silero_vad import load_silero_vad
import torch


class STT:
    def __init__(self):
        self.model = WhisperModel(
            "medium",
            device="cuda",
            compute_type="float16"
        )
        self.vad_model = load_silero_vad(onnx=True)
        self.frequence = 16000
        self.duree_silence = 1.3
        self.taille_bloc = 512
        self.duree_bloc = self.taille_bloc / self.frequence

    def ecouter(self):
        audio_enregistre = []

        # 5 blocs de 32 ms = 160 ms conservées avant détection
        pre_buffer = deque(maxlen=5)

        a_commence = False
        silence = 0.0
        blocs_voix = 0
        with sd.InputStream(
                samplerate=self.frequence,
                channels=1,
                dtype="float32"
        ) as stream:

            while True:
                bloc, _ = stream.read(self.taille_bloc)
                bloc_tensor = torch.from_numpy(bloc.squeeze())

                probabilite_voix = self.vad_model(bloc_tensor, self.frequence).item()

                if not a_commence:
                    pre_buffer.append(bloc)

                    if probabilite_voix > 0.5:
                        blocs_voix += 1
                    else:
                        blocs_voix = 0

                    if blocs_voix >= 3:
                        a_commence = True
                        audio_enregistre.extend(pre_buffer)
                        silence = 0.0
                else:
                    audio_enregistre.append(bloc)

                    if probabilite_voix > 0.5:
                        silence = 0.0
                    else:
                        silence += self.duree_bloc

                    if silence >= self.duree_silence:
                        break

        audio = np.concatenate(audio_enregistre, axis=0)

        write("data/temp/micro_capture.wav", self.frequence, audio)
        segments, _ = self.model.transcribe(
            "data/temp/micro_capture.wav",
            language="fr",
            beam_size=5,
            vad_filter=True,
            condition_on_previous_text=False,
            hotwords="Élise Jonathan tâches priorité statut applications VS Code biochimie"
        )
        texte = ""
        for segment in segments:
            texte += segment.text + " "
        return texte.strip()

