from flask import Flask, request
from queue import Queue
from threading import Thread

from interfaces.tts import TTS

app = Flask(__name__)
tts = TTS()

file_generation = Queue()
file_audio = Queue()


def worker_generation():
    while True:
        texte = file_generation.get()

        if texte is None:
            break
        print(f"[TTS] Génération : {texte}")
        frequence, audio = tts.generer(texte)

        file_audio.put((frequence, audio))
        file_generation.task_done()


def worker_lecture():
    while True:
        donnees_audio = file_audio.get()

        if donnees_audio is None:
            break

        frequence, audio = donnees_audio

        tts.jouer(frequence, audio)
        file_audio.task_done()


thread_generation = Thread(target=worker_generation, daemon=True)
thread_lecture = Thread(target=worker_lecture, daemon=True)

thread_generation.start()
thread_lecture.start()


@app.post("/parler")
def parler():
    donnees = request.get_json()
    texte = donnees.get("texte")

    if not texte:
        return {"succes": False, "erreur": "Texte manquant"}, 400

    file_generation.put(texte)

    return {"succes": True}


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=False
    )
