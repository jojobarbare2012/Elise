from faster_whisper import WhisperModel
import sounddevice as sd
from scipy.io.wavfile import write
import numpy as np
from collections import deque
from silero_vad import load_silero_vad
import torch
import gc
from threading import Lock


_stt = None
_stt_lock = Lock()


class STT:
    def __init__(self):
        self.model = WhisperModel(
            "medium",
            device="cuda",
            compute_type="int8_float16"
        )

        self.vad_model = load_silero_vad(onnx=True)

        self.frequence = 16000
        self.duree_silence = 1.3
        self.taille_bloc = 512
        self.duree_bloc = self.taille_bloc / self.frequence

    def ecouter(self, stop_event=None):
        import queue

        file_audio = queue.Queue()

        def callback(indata, frames, time_info, status):
            if status:
                print("[STT AUDIO]", status, flush=True)

            file_audio.put(indata.copy())

        audio_enregistre = []
        pre_buffer = deque(maxlen=5)

        a_commence = False
        silence = 0.0
        blocs_voix = 0

        print("[STT] Ouverture micro...", flush=True)

        with sd.InputStream(
                samplerate=self.frequence,
                channels=1,
                dtype="float32",
                blocksize=self.taille_bloc,
                callback=callback,
        ):
            print("[STT] Micro ouvert.", flush=True)

            while True:
                if stop_event is not None and not stop_event.is_set():
                    print("[STT] Écoute annulée.", flush=True)
                    return None

                try:
                    bloc = file_audio.get(timeout=0.1)

                except queue.Empty:
                    continue

                bloc_tensor = torch.from_numpy(
                    bloc.squeeze()
                )

                probabilite_voix = self.vad_model(
                    bloc_tensor,
                    self.frequence
                ).item()

                if probabilite_voix > 0.15:
                    print(
                        f"[VAD] {probabilite_voix:.3f}",
                        flush=True
                    )

                if not a_commence:
                    pre_buffer.append(bloc)

                    if probabilite_voix > 0.5:
                        blocs_voix += 1
                    else:
                        blocs_voix = 0

                    if blocs_voix >= 3:
                        print(
                            "[STT] Début de parole détecté.",
                            flush=True
                        )

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
                        print(
                            "[STT] Fin de parole détectée.",
                            flush=True
                        )
                        break

        if not audio_enregistre:
            return None

        audio = np.concatenate(
            audio_enregistre,
            axis=0
        )

        write(
            "data/temp/micro_capture.wav",
            self.frequence,
            audio
        )

        print("[STT] Transcription Whisper...", flush=True)

        segments, _ = self.model.transcribe(
            "data/temp/micro_capture.wav",
            language="fr",
            beam_size=5,
            vad_filter=True,
            condition_on_previous_text=False,
            hotwords=(
                "Élise Jonathan tâches priorité statut "
                "applications VS Code biochimie"
            )
        )

        texte = ""

        for segment in segments:
            texte += segment.text + " "

        texte = texte.strip()

        print(
            "[STT] Transcription :",
            repr(texte),
            flush=True
        )

        return texte


def est_actif():
    return _stt is not None


def obtenir():
    return _stt


def demarrer():
    global _stt

    with _stt_lock:
        if _stt is not None:
            return True

        try:
            print("[STT] Chargement Whisper...", flush=True)

            _stt = STT()

            print("[STT] Whisper chargé.", flush=True)

            return True

        except Exception as erreur:
            _stt = None

            print(
                "[STT] Erreur chargement :",
                repr(erreur),
                flush=True
            )

            return False


def arreter():
    global _stt

    with _stt_lock:
        if _stt is None:
            return True

        try:
            modele = getattr(_stt, "model", None)

            _stt = None

            if modele is not None:
                del modele

            gc.collect()

            print("[STT] Whisper déchargé.", flush=True)

            return True

        except Exception as erreur:
            print(
                "[STT] Erreur arrêt :",
                repr(erreur),
                flush=True
            )

            return False