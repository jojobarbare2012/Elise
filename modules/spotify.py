"""
Pilotage de Spotify via l'API Web (compte Premium requis pour la lecture).

Dépendance cloud assumée : sans Internet, ces outils échouent proprement,
le reste d'Élise n'est pas concerné.

Connexion (une seule fois) :
    python -m modules.spotify connexion

La méthode PKCE est utilisée : pas de « client secret » à stocker.
- data/spotify.json        : client_id + redirect_uri (non suivi par Git)
- data/spotify_jeton.json  : jetons d'accès (non suivi par Git)
"""

import base64
import hashlib
import json
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from threading import Lock


CHEMIN_CONFIG = Path("data/spotify.json")
CHEMIN_JETON = Path("data/spotify_jeton.json")

URL_AUTORISATION = "https://accounts.spotify.com/authorize"
URL_JETON = "https://accounts.spotify.com/api/token"
URL_API = "https://api.spotify.com/v1"

PERMISSIONS = " ".join([
    "user-read-private",  # type d'offre (Premium) du compte
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    "playlist-read-private",
    "playlist-read-collaborative",
])

DELAI_CONNEXION_S = 180
MARGE_EXPIRATION_S = 60
DELAI_RESEAU_S = 15

_verrou_jeton = Lock()


class ErreurSpotify(Exception):
    def __init__(self, message, statut=None):
        super().__init__(message)
        self.statut = statut


# =========================================================
# Configuration et jeton
# =========================================================

def charger_config():
    try:
        config = json.loads(CHEMIN_CONFIG.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise ErreurSpotify(
            "Spotify n'est pas configuré (data/spotify.json manquant ou illisible)."
        )

    if not config.get("client_id") or not config.get("redirect_uri"):
        raise ErreurSpotify("data/spotify.json doit contenir client_id et redirect_uri.")

    return config


def charger_jeton():
    try:
        return json.loads(CHEMIN_JETON.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def sauvegarder_jeton(reponse_jeton, jeton_precedent=None):
    jeton = {
        "access_token": reponse_jeton["access_token"],
        # Spotify ne renvoie pas toujours un nouveau refresh_token.
        "refresh_token": reponse_jeton.get("refresh_token")
        or (jeton_precedent or {}).get("refresh_token"),
        "expire_a": time.time() + int(reponse_jeton.get("expires_in", 3600)),
        "permissions": reponse_jeton.get("scope", ""),
    }

    CHEMIN_JETON.parent.mkdir(parents=True, exist_ok=True)
    CHEMIN_JETON.write_text(json.dumps(jeton, indent=4), encoding="utf-8")

    return jeton


def demander_jeton(donnees):
    requete = urllib.request.Request(
        URL_JETON,
        data=urllib.parse.urlencode(donnees).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(requete, timeout=DELAI_RESEAU_S) as reponse:
            return json.loads(reponse.read().decode("utf-8"))

    except urllib.error.HTTPError as erreur:
        detail = erreur.read().decode("utf-8", errors="replace")
        raise ErreurSpotify(f"Jeton refusé par Spotify : {detail}", erreur.code)

    except (urllib.error.URLError, TimeoutError) as erreur:
        raise ErreurSpotify(f"Spotify injoignable : {erreur}")


def obtenir_jeton_acces(forcer_renouvellement=False):
    with _verrou_jeton:
        jeton = charger_jeton()

        if jeton is None or not jeton.get("refresh_token"):
            raise ErreurSpotify(
                "Spotify n'est pas connecté. Lancer : python -m modules.spotify connexion"
            )

        if forcer_renouvellement or time.time() > jeton["expire_a"] - MARGE_EXPIRATION_S:
            config = charger_config()
            reponse = demander_jeton({
                "grant_type": "refresh_token",
                "refresh_token": jeton["refresh_token"],
                "client_id": config["client_id"],
            })
            jeton = sauvegarder_jeton(reponse, jeton)

        return jeton["access_token"]


# =========================================================
# Connexion initiale (PKCE)
# =========================================================

def generer_pkce():
    verificateur = secrets.token_urlsafe(64)[:128]
    empreinte = hashlib.sha256(verificateur.encode("ascii")).digest()
    defi = base64.urlsafe_b64encode(empreinte).decode("ascii").rstrip("=")

    return verificateur, defi


def connexion():
    """Ouvre le navigateur pour autoriser Élise, puis enregistre le jeton."""
    config = charger_config()
    redirection = urllib.parse.urlparse(config["redirect_uri"])

    verificateur, defi = generer_pkce()
    etat = secrets.token_urlsafe(16)
    resultat = {}

    class ReceptionCode(BaseHTTPRequestHandler):
        def do_GET(self):
            url = urllib.parse.urlparse(self.path)

            if url.path != redirection.path:
                self.send_response(404)
                self.end_headers()
                return

            parametres = urllib.parse.parse_qs(url.query)
            resultat["code"] = parametres.get("code", [None])[0]
            resultat["erreur"] = parametres.get("error", [None])[0]
            resultat["etat"] = parametres.get("state", [None])[0]

            succes = resultat["code"] and resultat["etat"] == etat
            message = (
                "Élise est connectée à Spotify. Tu peux fermer cet onglet."
                if succes
                else "Connexion Spotify refusée ou invalide. Tu peux fermer cet onglet."
            )

            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(
                f"<html><body style='font-family:sans-serif'><h2>{message}</h2></body></html>"
                .encode("utf-8")
            )

        def log_message(self, *args):
            pass

    serveur = HTTPServer((redirection.hostname, redirection.port), ReceptionCode)
    serveur.timeout = 1

    url = URL_AUTORISATION + "?" + urllib.parse.urlencode({
        "client_id": config["client_id"],
        "response_type": "code",
        "redirect_uri": config["redirect_uri"],
        "code_challenge_method": "S256",
        "code_challenge": defi,
        "scope": PERMISSIONS,
        "state": etat,
    })

    print("[SPOTIFY] ouverture du navigateur pour autoriser Élise...", flush=True)
    print("[SPOTIFY] si rien ne s'ouvre, copier cette adresse :", url, flush=True)
    webbrowser.open(url)

    limite = time.time() + DELAI_CONNEXION_S

    with serveur:
        while "code" not in resultat and time.time() < limite:
            serveur.handle_request()

    if "code" not in resultat:
        raise ErreurSpotify("Délai dépassé : aucune réponse de Spotify.")

    if resultat["erreur"] or not resultat["code"]:
        raise ErreurSpotify(f"Autorisation refusée : {resultat['erreur']}")

    if resultat["etat"] != etat:
        raise ErreurSpotify("Réponse Spotify invalide (state différent).")

    reponse = demander_jeton({
        "grant_type": "authorization_code",
        "code": resultat["code"],
        "redirect_uri": config["redirect_uri"],
        "client_id": config["client_id"],
        "code_verifier": verificateur,
    })

    sauvegarder_jeton(reponse)
    print("[SPOTIFY] connexion enregistrée.", flush=True)


# =========================================================
# Appels à l'API
# =========================================================

def appel_api(methode, chemin, parametres=None, corps=None, _deja_renouvele=False):
    url = URL_API + chemin

    if parametres:
        url += "?" + urllib.parse.urlencode(parametres)

    entetes = {"Authorization": f"Bearer {obtenir_jeton_acces()}"}
    donnees = None

    if corps is not None:
        donnees = json.dumps(corps).encode("utf-8")
        entetes["Content-Type"] = "application/json"

    requete = urllib.request.Request(url, data=donnees, headers=entetes, method=methode)

    try:
        with urllib.request.urlopen(requete, timeout=DELAI_RESEAU_S) as reponse:
            contenu = reponse.read()
            return json.loads(contenu.decode("utf-8")) if contenu else None

    except urllib.error.HTTPError as erreur:
        if erreur.code == 401 and not _deja_renouvele:
            obtenir_jeton_acces(forcer_renouvellement=True)
            return appel_api(methode, chemin, parametres, corps, _deja_renouvele=True)

        detail = erreur.read().decode("utf-8", errors="replace")

        try:
            detail = json.loads(detail)["error"]["message"]
        except (ValueError, KeyError, TypeError):
            pass

        raise ErreurSpotify(f"Spotify a refusé la requête ({erreur.code}) : {detail}", erreur.code)

    except (urllib.error.URLError, TimeoutError) as erreur:
        raise ErreurSpotify(f"Spotify injoignable : {erreur}")


# =========================================================
# Ligne de commande
# =========================================================

def afficher_etat_compte():
    profil = appel_api("GET", "/me")
    print("[SPOTIFY] compte :", profil.get("display_name"), "| offre :", profil.get("product"))

    appareils = appel_api("GET", "/me/player/devices").get("devices", [])

    if not appareils:
        print("[SPOTIFY] aucun appareil actif (Spotify fermé partout ?)")

    for appareil in appareils:
        print(
            "[SPOTIFY] appareil :",
            appareil.get("name"),
            "|",
            appareil.get("type"),
            "| actif" if appareil.get("is_active") else "| inactif",
        )


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    action = sys.argv[1] if len(sys.argv) > 1 else "etat"

    try:
        if action == "connexion":
            connexion()

        afficher_etat_compte()

    except ErreurSpotify as erreur:
        print("[SPOTIFY] ERREUR :", erreur)
        sys.exit(1)
