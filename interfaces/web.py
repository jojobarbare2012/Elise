from fastapi import FastAPI
from pydantic import BaseModel
from core.elise import Elise
from module.applications import lancer_application_locale
from module.tache import (
    outil_ajouter_tache,
    outil_lister_taches,
    outil_modifier_statut,
    outil_supprimer_tache,
)
from fastapi.responses import FileResponse, StreamingResponse
from queue import Queue
from fastapi.staticfiles import StaticFiles
from threading import Thread, Event
from interfaces.stt import STT
import asyncio
from interfaces.tts_client import TTSClient
from fastapi import WebSocket, WebSocketDisconnect
import re

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

stt = STT()


app = FastAPI()
app.mount(
    "/static",
    StaticFiles(directory="interfaces/static"),
    name="static",
)


assistant = Elise(
    "qwen3:8b",
    [
        lancer_application_locale,
        outil_ajouter_tache,
        outil_lister_taches,
        outil_modifier_statut,
        outil_supprimer_tache,
    ],
)



vocal_event = Event()


file_tts = Queue()
file_audio = Queue()

tts = TTSClient()

websocket_actif = None
boucle_asyncio = None



class MessageUtilisateur(BaseModel):
    message: str


@app.post("/message")
def recevoir_message(donnees: MessageUtilisateur):
    reponse = assistant.repondre(donnees.message)

    return {
        "reponse": reponse
    }

@app.get("/")
def afficher_interface():
    return FileResponse("interfaces/static/index.html")



def worker_reponse(message, file_stream):
    assistant.repondre(
        message,
        callback_stream=lambda morceau: file_stream.put(morceau)
    )
    file_stream.put(None)


def lire_stream(file_stream: FileResponse):
    while True:
        morceau = file_stream.get()
        if morceau is None:
            break

        yield morceau

@app.post("/message-stream")
def recevoir_message_stream(donnees: MessageUtilisateur):
    file_stream = Queue()
    thread = Thread(
        target=worker_reponse,
        args=(donnees.message,file_stream,),
        daemon=True
    )

    thread.start()

    return StreamingResponse(
        lire_stream(file_stream),
        media_type="text/plain"
    )


@app.get("/etat")
def obtenir_etat():
    return {
        "etat": assistant.etat.obtenir()
    }

#thread vocal

def worker_vocal():
    while True:
        vocal_event.wait()
        assistant.etat.changer("LISTENING")

        message = stt.ecouter()

        if not vocal_event.is_set():
            assistant.etat.changer("IDLE")
            continue


        envoyer_evenement_websocket({
            "type": "transcription",
            "contenu": message
        })
        print("Vous :", message)

        assistant.repondre(
            message,
            callback=envoyer_au_tts,
            callback_stream=envoyer_reponse_websocket,
            callback_fin=vider_buffer_tts
        )

def envoyer_reponse_websocket(morceau):
    envoyer_evenement_websocket({
        "type": "reponse",
        "contenu": morceau
    })

thread_vocal = Thread(
    target=worker_vocal,
    daemon=True
)

thread_vocal.start()

class BufferTTS:
    def __init__(self, taille_min=80):
        self.buffer = ""
        self.taille_min = taille_min

    def ajouter(self, phrase):
        phrase = nettoyer_pour_tts(phrase)

        if not phrase:
            return None

        if self.buffer:
            self.buffer += " "

        self.buffer += phrase

        if len(self.buffer) >= self.taille_min:
            bloc = self.buffer
            self.buffer = ""
            return bloc

        return None

    def flush(self):
        if not self.buffer:
            return None

        bloc = self.buffer
        self.buffer = ""
        return bloc


buffer_tts = BufferTTS()


def nettoyer_pour_tts(texte):
    texte = EMOJI_PATTERN.sub("", texte)
    texte = re.sub(r"\s+", " ", texte)
    return texte.strip()

def envoyer_au_tts(phrase):
    bloc = buffer_tts.ajouter(phrase)

    if bloc:
        file_tts.put(bloc)

def vider_buffer_tts():
    bloc = buffer_tts.flush()

    if bloc:
        file_tts.put(bloc)

def worker_generation():
    while True:
        phrase = file_tts.get()
        print("[GEN] reçu :", phrase)

        try:
            audio_wav = tts.generer(phrase)
            print("[GEN] audio :", len(audio_wav), "octets")

            file_audio.put(audio_wav)
            print("[GEN] envoyé à file_audio")

        except Exception as erreur:
            print("[GEN] ERREUR :", erreur)

        finally:
            file_tts.task_done()


def worker_lecture():
    while True:
        audio_wav = file_audio.get()
        print("[LECTURE] reçu")

        try:
            assistant.etat.changer("SPEAKING")
            tts.jouer(audio_wav)
            print("[LECTURE] terminé")

        except Exception as erreur:
            print("[LECTURE] ERREUR :", erreur)

        finally:
            assistant.etat.changer("IDLE")
            file_audio.task_done()

Thread(target=worker_generation, daemon=True).start()
Thread(target=worker_lecture, daemon=True).start()

def envoyer_evenement_websocket(evenement):
    if websocket_actif is None or boucle_asyncio is None:
        return

    asyncio.run_coroutine_threadsafe(
        websocket_actif.send_json(evenement),
        boucle_asyncio
    )


@app.post("/vocal/activer")
def active_vocal():
    vocal_event.set()
    print("Vocal :", vocal_event.is_set())

    return {
        "vocal_actif": True
    }

@app.post("/vocal/desactiver")
def desactive_vocal():
    vocal_event.clear()

    print("Vocal :", vocal_event.is_set())

    return {
        "vocal_actif": False
    }

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global websocket_actif, boucle_asyncio

    await websocket.accept()

    websocket_actif = websocket
    boucle_asyncio = asyncio.get_running_loop()

    print("WebSocket connecté :", id(websocket))

    try:
        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:
        print("WebSocket déconnecté :", id(websocket))

        if websocket_actif is websocket:
            websocket_actif = None