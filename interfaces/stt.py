from faster_whisper import WhisperModel
import sounddevice as sd
from scipy.io.wavfile import write
import numpy as np
from collections import deque
import time
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
        debut_capture = time.perf_counter()
        with sd.InputStream(
                samplerate=self.frequence,
                channels=1,
                dtype="float32"
        ) as stream:

            while True:
                bloc, overflowed = stream.read(self.taille_bloc)
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
        fin_capture = time.perf_counter()

        #print(f"Capture audio : {fin_capture - debut_capture:.2f} s")
        audio = np.concatenate(audio_enregistre, axis=0)

        write("micro_test.wav", self.frequence, audio)
        debut_whisper = time.perf_counter()
        segments, info = self.model.transcribe(
            "micro_test.wav",
            language="fr",
            beam_size=5,
            vad_filter=True,
            condition_on_previous_text=False,
            hotwords="Élise Jonathan tâches priorité statut applications VS Code biochimie"
        )

        texte = ""
        for segment in segments:
            texte += segment.text + " "
        fin_whisper = time.perf_counter()
        #print(f"Whisper seul : {fin_whisper - debut_whisper:.2f} s")
        return texte.strip()

