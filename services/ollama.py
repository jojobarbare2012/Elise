MODELE_PRINCIPAL = "qwen3:14b"

import json
import subprocess
import time
import urllib.request


URL_OLLAMA = "http://127.0.0.1:11434"
MODELE_PRINCIPAL = "qwen3:14b"


def est_actif():
    try:
        with urllib.request.urlopen(
            f"{URL_OLLAMA}/api/tags",
            timeout=1
        ) as reponse:
            return reponse.status == 200

    except Exception:
        return False


def demarrer():
    if est_actif():
        return True

    subprocess.Popen([
        "ollama",
        "serve"
    ])

    return attendre()


def attendre(timeout=60):
    debut = time.perf_counter()

    while time.perf_counter() - debut < timeout:
        if est_actif():
            return True

        time.sleep(1)

    return False


def charger_modele(
    modele=MODELE_PRINCIPAL,
    keep_alive="30m"
):
    donnees = json.dumps({
        "model": modele,
        "messages": [
            {
                "role": "user",
                "content": "Réponds uniquement par OK."
            }
        ],
        "stream": False,
        "think": False,
        "keep_alive": keep_alive
    }).encode("utf-8")

    requete = urllib.request.Request(
        f"{URL_OLLAMA}/api/chat",
        data=donnees,
        headers={
            "Content-Type": "application/json"
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(
            requete,
            timeout=120
        ) as reponse:
            reponse.read()

        return True

    except Exception as erreur:
        print(
            "[OLLAMA] Erreur chargement modèle :",
            repr(erreur),
            flush=True
        )

        return False


def decharger_modele(
    modele=MODELE_PRINCIPAL
):
    donnees = json.dumps({
        "model": modele,
        "messages": [],
        "stream": False,
        "keep_alive": 0
    }).encode("utf-8")

    requete = urllib.request.Request(
        f"{URL_OLLAMA}/api/chat",
        data=donnees,
        headers={
            "Content-Type": "application/json"
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(
            requete,
            timeout=30
        ) as reponse:
            reponse.read()

        return True

    except Exception as erreur:
        print(
            "[OLLAMA] Erreur déchargement modèle :",
            repr(erreur),
            flush=True
        )

        return False