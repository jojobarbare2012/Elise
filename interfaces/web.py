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
import time
import sys

sys.stdout.reconfigure(
    encoding="utf-8",
    errors="replace"
)
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

tts_en_cours = Event()

print("[WEB INIT] avant STT", flush=True)
stt=STT()
print("[WEB INIT] après STT", flush=True)

app = FastAPI()
app.mount(
    "/static",
    StaticFiles(directory="interfaces/static"),
    name="static",
)


print("[WEB INIT] avant Elise", flush=True)

assistant = Elise(
    "qwen3:14b",
    [
        lancer_application_locale,
        outil_ajouter_tache,
        outil_lister_taches,
        outil_modifier_statut,
        outil_supprimer_tache,
    ],
)

print("[WEB INIT] après Elise", flush=True)


vocal_event = Event()


file_tts = Queue()
file_audio = Queue()
print("[WEB INIT] avant TTS", flush=True)
tts = TTSClient()
print("[WEB INIT] après TTS", flush=True)
websocket_actif = None
boucle_asyncio = None



class MessageUtilisateur(BaseModel):
    message: str

def envoyer_confirmation_memoire(texte):
    print(
        "[MEM CONF] callback appelé",
        repr(texte),
        flush=True
    )
    envoyer_evenement_websocket({
        "type": "memory_confirmation",
        "content": texte
    })


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
        callback_stream=lambda morceau: file_stream.put(morceau),
        callback_confirmation=envoyer_confirmation_memoire
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
        while tts_en_cours.is_set() or not file_audio.empty() or not file_tts.empty():
            time.sleep(0.05)

        message = stt.ecouter()
        print(
            f"[PERF] STT terminé : {time.perf_counter():.3f}",
            flush=True
        )
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
            callback_fin=vider_buffer_tts,
            callback_confirmation=envoyer_confirmation_memoire
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
    texte = re.sub(r"\*\*(.*?)\*\*", r"\1", texte)
    texte = re.sub(r"\*(.*?)\*", r"\1", texte)
    texte = re.sub(r"`([^`]*)`", r"\1", texte)
    texte = re.sub(r"\s+([,.;:!?])", r"\1", texte)
    texte = re.sub(r"([,.;:!?])(?=\S)", r"\1 ", texte)
    texte = EMOJI_PATTERN.sub("", texte)

    # Les parenthèses rendent souvent la prosodie dégueulasse
    texte = texte.replace("(", ", ")
    texte = texte.replace(")", ", ")

    # Guillemets inutiles oralement
    texte = texte.replace('"', "")
    texte = texte.replace("“", "")
    texte = texte.replace("”", "")

    remplacements = {
        "HTTPS": "H T T P S",
        "HTTP": "H T T P",
        "TCP": "T C P",
        "UDP": "U D P",
        "API": "A P I",
        "URL": "U R L",
        "HTML": "H T M L",
        "CSS": "C S S",
        "WebSocket": "Web Socket",
    }

    for original, remplacement in remplacements.items():
        texte = texte.replace(original, remplacement)

    texte = re.sub(r"\s+", " ", texte)

    # évite les trucs du genre ", ,"
    texte = re.sub(r",\s*,+", ",", texte)

    return texte.strip(" ,")

"""
def envoyer_au_tts(phrase):
    print("[DEBUG callback TTS] phrase =", repr(phrase))
    bloc = buffer_tts.ajouter(phrase)
    if bloc:
        print("[DEBUG callback TTS] ENQUEUE =", repr(bloc))
        if assistant.debut_reponse is not None:
            delai = time.perf_counter() - assistant.debut_reponse
            print(f"[PERF] Premier bloc TTS prêt : {delai:.3f}s")

        file_tts.put(bloc)
"""
def envoyer_au_tts(phrase):
    phrase = nettoyer_pour_tts(phrase)

    if not phrase:
        return

    print("[TTS] phrase prête :", repr(phrase), flush=True)

    if assistant.debut_reponse is not None:
        delai = time.perf_counter() - assistant.debut_reponse
        print(
            f"[PERF] Première phrase envoyée au TTS : {delai:.3f}s",
            flush=True
        )

    file_tts.put(phrase)

def vider_buffer_tts():
    print("[DEBUG flush TTS]")
    bloc = buffer_tts.flush()

    if bloc:
        print("[DEBUG flush TTS] ENQUEUE =", repr(bloc))
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
        tts_en_cours.set()
        try:
            assistant.etat.changer("SPEAKING")
            if assistant.debut_reponse is not None:
                delai = time.perf_counter() - assistant.debut_reponse
                print(f"[PERF] Début lecture audio : {delai:.3f}s")
            print(
                f"[PERF] Début lecture audio réel : {time.perf_counter():.3f}",
                flush=True
            )
            tts.jouer(audio_wav)
            print("[LECTURE] terminé")

        except Exception as erreur:
            print("[LECTURE] ERREUR :", erreur)

        finally:
            assistant.etat.changer("IDLE")
            tts_en_cours.clear()
            file_audio.task_done()

Thread(target=worker_generation, daemon=True).start()
Thread(target=worker_lecture, daemon=True).start()

def envoyer_evenement_websocket(evenement):
    print(
        "[WS] tentative envoi :",
        evenement,
        "| websocket actif :",
        websocket_actif is not None,
        "| boucle asyncio :",
        boucle_asyncio is not None,
        flush=True
    )
    if websocket_actif is None or boucle_asyncio is None:
        return

    futur = asyncio.run_coroutine_threadsafe(
        websocket_actif.send_json(evenement),
        boucle_asyncio
    )

    def verifier_envoi(futur):
        try:
            futur.result()
            print("[WS] événement envoyé avec succès", flush=True)
        except Exception as erreur:
            print("[WS] ERREUR ENVOI :", repr(erreur), flush=True)

    futur.add_done_callback(verifier_envoi)

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

@app.get("/health")
def health():
    return {"status": "ok"}