import subprocess
import time
import urllib.request

URL_HEALTH = "http://127.0.0.1:8080/health"
SERVICE = "fish-elise.service"

def attendre(timeout=240):
    debut = time.perf_counter()

    while time.perf_counter() - debut < timeout:
        if est_actif():
            return True

        time.sleep(1)

    return False

def est_actif():
    try:
        with urllib.request.urlopen(URL_HEALTH, timeout=1) as reponse:
            return reponse.status == 200
    except Exception:
        return False


def demarrer():
    if est_actif():
        return True

    subprocess.run([
        "wsl",
        "-d",
        "Ubuntu-24.04",
        "-u",
        "root",
        "systemctl",
        "start",
        SERVICE,
    ])

    for _ in range(60):
        if est_actif():
            return True

        time.sleep(1)

    return False


def arreter():
    subprocess.run([
        "wsl",
        "-d",
        "Ubuntu-24.04",
        "-u",
        "root",
        "systemctl",
        "stop",
        SERVICE,
    ])

    for _ in range(10):
        if not est_actif():
            return True

        time.sleep(0.5)

    return False