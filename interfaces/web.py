from fastapi import FastAPI
from pydantic import BaseModel
from core.elise import Elise
from modules.applications import lancer_application_locale
from modules.taches import (
    outil_ajouter_tache,
    outil_lister_taches,
    outil_modifier_statut,
    outil_supprimer_tache,
)
from modules.calendrier import (outil_ajouter_evenement,
                               outil_lister_evenements,
                               outil_modifier_evenement,
                               outil_supprimer_evenement,
                               outil_rechercher_evenements,
                               outil_resoudre_date_relative)
from fastapi.responses import FileResponse, StreamingResponse
from queue import Queue
from fastapi.staticfiles import StaticFiles
from threading import Thread, Event
from services import stt, tts
import asyncio
from services import fish, ollama
from fastapi import WebSocket, WebSocketDisconnect
import time
import sys

sys.stdout.reconfigure(
    encoding="utf-8",
    errors="replace"
)





qwen_actif = True
app = FastAPI()
app.mount(
    "/static",
    StaticFiles(directory="interfaces/static"),
    name="static",
)

print("[WEB INIT] chargement STT", flush=True)

if not stt.demarrer():
    print("[WEB INIT] erreur chargement STT", flush=True)
print("[WEB INIT] avant Elise", flush=True)

assistant = Elise(
    "qwen3:14b",
    [
        lancer_application_locale,
        outil_ajouter_tache,
        outil_lister_taches,
        outil_modifier_statut,
        outil_supprimer_tache,
        outil_ajouter_evenement,
        outil_lister_evenements,
        outil_modifier_evenement,
        outil_supprimer_evenement,
        outil_rechercher_evenements,
        outil_resoudre_date_relative
    ],
)

print("[WEB INIT] après Elise", flush=True)


vocal_event = Event()


gestionnaire_tts = tts.GestionnaireTTS()

gestionnaire_tts.callback_debut_lecture = (
    lambda: assistant.etat.changer("SPEAKING")
)

gestionnaire_tts.callback_fin_lecture = (
    lambda: assistant.etat.changer("IDLE")
)
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
    if not qwen_actif:
        def qwen_desactive():
            yield "Qwen est actuellement désactivé."

        return StreamingResponse(
            qwen_desactive(),
            media_type="text/plain"
        )
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
    if not qwen_actif:
        def qwen_desactive():
            yield "Qwen est actuellement désactivé."

        return StreamingResponse(
            qwen_desactive(),
            media_type="text/plain"
        )
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
        print("[VOCAL] Worker démarré", flush=True)

        while True:
            print("[VOCAL] En attente activation", flush=True)
            vocal_event.wait()

            print("[VOCAL] Activation reçue", flush=True)

            assistant.etat.changer("LISTENING")

            print(
                "[VOCAL] TTS occupé :",
                gestionnaire_tts.est_occupe(),
                flush=True
            )

            while gestionnaire_tts.est_occupe():
                time.sleep(0.05)

            print("[VOCAL] TTS libre", flush=True)

            moteur_stt = stt.obtenir()

            print(
                "[VOCAL] moteur STT :",
                moteur_stt,
                flush=True
            )

            if moteur_stt is None:
                print("[VOCAL] Aucun moteur STT", flush=True)

                vocal_event.clear()
                assistant.etat.changer("IDLE")
                time.sleep(0.2)
                continue

            try:
                print("[VOCAL] Entrée dans ecouter()", flush=True)

                message = moteur_stt.ecouter(
                    stop_event=vocal_event
                )

                print(
                    "[VOCAL] Sortie de ecouter() :",
                    repr(message),
                    flush=True
                )

            except Exception as erreur:
                print(
                    "[VOCAL] ERREUR STT :",
                    repr(erreur),
                    flush=True
                )

                assistant.etat.changer("IDLE")
                vocal_event.clear()
                continue

            if message is None:
                print("[VOCAL] Écoute annulée", flush=True)
                assistant.etat.changer("IDLE")
                continue

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


def envoyer_au_tts(phrase):
    if assistant.debut_reponse is not None:
        delai = time.perf_counter() - assistant.debut_reponse

        print(
            f"[PERF] Première phrase envoyée au TTS : {delai:.3f}s",
            flush=True
        )

    gestionnaire_tts.envoyer(phrase)



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

@app.get("/")
def afficher_interface():
    response = FileResponse("interfaces/static/index.html")
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    return response

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

    assistant.etat.changer("IDLE")

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

@app.get("/services/fish")
def etat_fish():
    return {
        "service": "fish",
        "actif": fish.est_actif()
    }

@app.post("/services/fish/demarrer")
def route_demarrer_fish():
    succes = fish.demarrer()

    return {
        "service": "fish",
        "actif": succes
    }


@app.post("/services/fish/arreter")
def route_arreter_fish():
    succes = fish.arreter()

    return {
        "service": "fish",
        "actif": False if succes else fish.est_actif()
    }

@app.get("/services/whisper")
def etat_whisper():
    return {
        "service": "whisper",
        "actif": stt.est_actif()
    }


@app.post("/services/whisper/demarrer")
def route_demarrer_whisper():
    succes = stt.demarrer()

    return {
        "service": "whisper",
        "actif": succes
    }


@app.post("/services/whisper/arreter")
def route_arreter_whisper():
    succes = stt.arreter()

    return {
        "service": "whisper",
        "actif": False if succes else stt.est_actif()
    }

@app.get("/services/qwen")
def etat_qwen():
    return {
        "service": "qwen",
        "actif": qwen_actif
    }


@app.post("/services/qwen/demarrer")
def route_demarrer_qwen():
    global qwen_actif

    succes = ollama.charger_modele()

    if succes:
        qwen_actif = True

    return {
        "service": "qwen",
        "actif": qwen_actif
    }


@app.post("/services/qwen/arreter")
def route_arreter_qwen():
    global qwen_actif

    succes = ollama.decharger_modele()

    if succes:
        qwen_actif = False

    return {
        "service": "qwen",
        "actif": qwen_actif
    }

