import subprocess
import time
import urllib.request, urllib.error
from services import fish
from services import ollama
import webbrowser
import threading
import os
from pathlib import Path

RACINE_PROJET = Path(__file__).resolve().parent

DOSSIER_DATA = RACINE_PROJET / "data"
DOSSIER_LOGS = RACINE_PROJET / "logs"

FICHIER_SHUTDOWN = DOSSIER_DATA / "shutdown.flag"

PYTHON_WEB = RACINE_PROJET / ".venv" / "Scripts" / "python.exe"

FICHIER_LOG = DOSSIER_LOGS / "web.log"


demande_arret = threading.Event()

DOSSIER_LOGS.mkdir(exist_ok=True)

print("Launcher démarré.")

def garder_wsl_actif():
    return subprocess.Popen([
        "wsl",
        "-d",
        "Ubuntu-24.04",
        "bash",
        "-lc",        "while true; do sleep 3600; done"
    ])


processus_wsl = garder_wsl_actif()






def lancer_web():

    log = open(
        FICHIER_LOG,
        "w",
        encoding="utf-8"
    )

    processus = subprocess.Popen(
        [
            PYTHON_WEB,
            "-u",
            "-m",
            "uvicorn",
            "interfaces.web:app",
            "--no-access-log"
        ],
        cwd=RACINE_PROJET,

        # Le Web n'hérite plus du stdin du launcher/Tauri
        stdin=subprocess.DEVNULL,

        # Et ses logs vont dans son propre fichier
        stdout=log,
        stderr=subprocess.STDOUT
    )

    log.close()

    return processus

def attendre_web(processus):
    url = "http://127.0.0.1:8000/health"
    debut = time.perf_counter()
    print(f"[DEBUG] Web lancé PID={processus.pid}", flush=True)

    while True:
        if arret_demande():
            print("Démarrage Web interrompu.", flush=True)
            return False

        if processus.poll() is not None:
            print(
                f"Le serveur web s'est arrêté "
                f"(code {processus.returncode})."
            )
            return False

        if time.perf_counter() - debut > 180:
            print("Le serveur web n'a pas démarré dans le délai imparti.")
            return False

        try:
            with urllib.request.urlopen(url, timeout=1) as reponse:
                if reponse.status == 200:
                    print("Serveur web prêt.")
                    return True

        except Exception:
            time.sleep(1)

def web_est_pret():
    url = "http://127.0.0.1:8000/health"
    try:
        with urllib.request.urlopen(url, timeout=1) as reponse:
            return reponse.status == 200
    except urllib.error.HTTPError as erreur:
        print("Serveur trouvé, mais /health répond :", erreur.code)
        return False
    except Exception:
        return False


def arreter_port_8000():
    try:
        sortie = subprocess.check_output(
            ["netstat", "-ano"],
            text=True,
            errors="replace"
        )

        for ligne in sortie.splitlines():
            if "127.0.0.1:8000" in ligne and "LISTENING" in ligne:
                pid = ligne.split()[-1]

                print(
                    f"Arrêt du serveur web PID {pid}...",
                    flush=True
                )

                subprocess.run(
                    ["taskkill", "/PID", pid, "/F"],
                    check=False
                )

                return True

        print("Aucun serveur web actif sur le port 8000.", flush=True)
        return False

    except Exception as erreur:
        print(
            f"Impossible d'arrêter le serveur web : {erreur!r}",
            flush=True
        )
        return False

def ouvrir_interface():
    webbrowser.open("http://127.0.0.1:8000/")


def arreter_processus(processus, nom):
    if processus is None:
        return

    if processus.poll() is None:
        print(f"Arrêt de {nom}...")
        processus.terminate()

        try:
            processus.wait(timeout=5)
        except subprocess.TimeoutExpired:
            print(f"{nom} ne répond pas, arrêt forcé.")
            processus.kill()


def arret_demande():
    return os.path.exists(FICHIER_SHUTDOWN)


if os.path.exists(FICHIER_SHUTDOWN):
    os.remove(FICHIER_SHUTDOWN)

if fish.est_actif():
    print("Fish déjà actif.")
    print("[SETUP] fish READY", flush=True)

else:
    print("[SETUP] fish STARTING", flush=True)

    if fish.demarrer():
        print("[SETUP] fish READY", flush=True)

    else:
        print("[SETUP] fish ERROR", flush=True)
"""
print("[SETUP] fish WARMING", flush=True)

if chauffer_fish():
    print("[SETUP] fish HOT", flush=True)
else:
    print("[SETUP] fish WARMUP ERROR", flush=True)
"""
if ollama.est_actif():
    print("Ollama déjà actif.")
    print("[SETUP] ollama READY", flush=True)

else:
    print("[SETUP] ollama STARTING", flush=True)

    if ollama.demarrer():
        print("[SETUP] ollama READY", flush=True)

    else:
        print("[SETUP] ollama ERROR", flush=True)

print("[SETUP] qwen LOADING", flush=True)

if ollama.charger_modele():
    print("[SETUP] qwen READY", flush=True)

else:
    print("[SETUP] qwen ERROR", flush=True)


processus_web = None

if web_est_pret():
    print("Le serveur web est déjà actif.")
    print("[SETUP] web READY", flush=True)
else:
    processus_web = lancer_web()

    if attendre_web(processus_web):
        print("[SETUP] web READY", flush=True)
    else:
        if not demande_arret.is_set():
            print("[SETUP] web ERROR", flush=True)

        arreter_processus(processus_web, "serveur web")
        processus_web = None





try:
    print("Élise est lancée.", flush=True)

    while not arret_demande():
        time.sleep(0.5)

except KeyboardInterrupt:
    print("\nFermeture d'Élise...")

finally:
    print("Nettoyage des services...", flush=True)

    arreter_processus(processus_web, "serveur web")
    arreter_port_8000()
    ollama.decharger_modele()

    if os.path.exists(FICHIER_SHUTDOWN):
        os.remove(FICHIER_SHUTDOWN)

    print("Élise arrêtée.", flush=True)
    print("[SHUTDOWN] READY", flush=True)