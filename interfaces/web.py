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
from threading import Thread

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