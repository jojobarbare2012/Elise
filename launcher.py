import subprocess
import time
import urllib.request, urllib.error
import json
import webbrowser
import threading
import os

FICHIER_SHUTDOWN = r"C:\Users\Jonathan\Desktop\EliseV0\data\shutdown.flag"

demande_arret = threading.Event()



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

def lancer_fish():
    return subprocess.Popen([
        "wsl",
        "-d",
        "Ubuntu-24.04",
        "-u",
        "root",
        "systemctl",
        "start",
        "fish-elise.service"
    ])

def attendre_fish():
    url = "http://127.0.0.1:8080/health"
    debut = time.perf_counter()
    while True:
        if arret_demande():
            print("Démarrage Web interrompu.", flush=True)
            return False

        if time.perf_counter()- debut > 240:
            print("Fish n'a pas démarré dans le délai imparti.")
            return False
        try:
            with urllib.request.urlopen(url, timeout=1) as reponse:
                if reponse.status == 200:
                    print("Fish prêt.")
                    return True

        except Exception:
            print("En attente de Fish...")
            time.sleep(1)


def fish_est_pret():
    url = "http://127.0.0.1:8080/health"

    try:
        with urllib.request.urlopen(url, timeout=1) as reponse:
            return reponse.status == 200
    except Exception:
        return False

def lancer_ollama():
    subprocess.Popen([
        "ollama",
        "serve"
        ]
    )

def attendre_ollama():
    url = "http://127.0.0.1:11434/api/tags"
    debut = time.perf_counter()
    while True:
        if arret_demande():
            print("Démarrage Web interrompu.", flush=True)
            return False

        if time.perf_counter()- debut > 60:
            print("Ollama n'a pas démarré dans le délai imparti.")
            return False
        try:
            with urllib.request.urlopen(url, timeout=1) as reponse:
                if reponse.status == 200:
                    print("Ollama prêt.")
                    return True

        except Exception:
            print("En attente de Ollama...")
            time.sleep(1)

def ollama_est_pret():
    url = "http://127.0.0.1:11434/api/tags"

    try:
        with urllib.request.urlopen(url, timeout=1) as reponse:
            return reponse.status == 200
    except Exception:
        return False


def chauffer_qwen():
    url = "http://127.0.0.1:11434/api/chat"

    donnees = json.dumps({
        "model": "qwen3:8b",
        "messages": [
            {
                "role": "user",
                "content": "Réponds uniquement par OK."
            }
        ],
        "stream": False
    }).encode("utf-8")

    requete = urllib.request.Request(
        url,
        data=donnees,
        headers={
            "Content-Type": "application/json"
        },
        method="POST"
    )

    debut = time.perf_counter()

    try:
        with urllib.request.urlopen(
            requete,
            timeout=60
        ) as reponse:
            reponse.read()

        duree = time.perf_counter() - debut
        print(f"Qwen chaud en {duree:.2f}s.")
        return True

    except Exception as erreur:
        print(f"Échec du warm-up Qwen : {erreur}")
        return False


def lancer_web():
    PYTHON_WEB = r"C:\Users\Jonathan\Desktop\EliseV0\.venv\Scripts\python.exe"
    DOSSIER_PROJET = r"C:\Users\Jonathan\Desktop\EliseV0"
    FICHIER_LOG = r"C:\Users\Jonathan\Desktop\EliseV0\web_debug.log"

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
        cwd=DOSSIER_PROJET,

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

def decharger_qwen():
    url = "http://127.0.0.1:11434/api/chat"

    donnees = json.dumps({
        "model": "qwen3:8b",
        "messages": [],
        "keep_alive": 0,
        "stream": False
    }).encode("utf-8")

    requete = urllib.request.Request(
        url,
        data=donnees,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(requete, timeout=30) as reponse:
            reponse.read()

        print("Qwen déchargé de la mémoire.")
        return True

    except Exception as erreur:
        print(f"Impossible de décharger Qwen : {erreur}")
        return False

def arret_demande():
    return os.path.exists(FICHIER_SHUTDOWN)


if os.path.exists(FICHIER_SHUTDOWN):
    os.remove(FICHIER_SHUTDOWN)

if fish_est_pret():
    print("Fish déjà actif.")
    print("[SETUP] fish READY", flush=True)
else:
    lancer_fish()

    if attendre_fish():
        print("[SETUP] fish READY", flush=True)
    else:
        print("[SETUP] fish ERROR", flush=True)


if ollama_est_pret():
    print("Ollama déjà actif.")
    print("[SETUP] ollama READY", flush=True)
else:
    lancer_ollama()

    if attendre_ollama():
        print("[SETUP] ollama READY", flush=True)
    else:
        print("[SETUP] ollama ERROR", flush=True)


print("[SETUP] qwen LOADING", flush=True)

if chauffer_qwen():
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
    decharger_qwen()

    if os.path.exists(FICHIER_SHUTDOWN):
        os.remove(FICHIER_SHUTDOWN)

    print("Élise arrêtée.", flush=True)
    print("[SHUTDOWN] READY", flush=True)