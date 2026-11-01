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
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from threading import Lock

from . import applications


CHEMIN_CONFIG = Path("data/spotify.json")
CHEMIN_JETON = Path("data/spotify_jeton.json")
CHEMIN_MIROIR = Path("data/spotify_miroir.json")

NOM_PLAYLIST_MIROIR = "Titres likés (Élise)"
DESCRIPTION_PLAYLIST_MIROIR = (
    "Copie de tes titres likés, mise à jour par Élise. Ne pas modifier à la main."
)
DELAI_VERIFICATION_S = 6

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
    # Playlist miroir des titres likés (seule playlist modifiée par Élise) :
    "user-library-read",
    "playlist-modify-private",
])

DELAI_CONNEXION_S = 180
MARGE_EXPIRATION_S = 60
DELAI_RESEAU_S = 15
DELAI_DEMARRAGE_SPOTIFY_S = 20

# Type demandé par le LLM → type de l'API de recherche.
TYPES_RECHERCHE = {
    "titre": "track",
    "album": "album",
    "artiste": "artist",
    "playlist": "playlist",
}

# Les titres likés ne sont pas une playlist dans l'API : reconnus à part.
NOMS_TITRES_LIKES = {
    "titres likes",
    "titres like",
    "titres aimes",
    "mes titres likes",
    "mes titres aimes",
    "mes likes",
    "likes",
    "liked songs",
    "coups de coeur",
    "mes coups de coeur",
}

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

        # Certaines commandes (ex. reprise de lecture) répondent 200 avec un
        # corps non JSON : c'est un succès sans données.
        try:
            return json.loads(contenu.decode("utf-8")) if contenu.strip() else None
        except (ValueError, UnicodeDecodeError):
            return None

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
# Appareils
# =========================================================

def lister_appareils():
    return appel_api("GET", "/me/player/devices").get("devices", [])


def choisir_appareil_pc(appareils):
    """Appareil actif du PC, sinon celui qui porte le nom du PC, sinon un ordinateur."""
    ordinateurs = [a for a in appareils if a.get("type") == "Computer"]
    nom_pc = socket.gethostname().lower()

    for critere in (
        lambda a: a.get("is_active"),
        lambda a: (a.get("name") or "").lower() == nom_pc,
        lambda a: True,
    ):
        for appareil in ordinateurs:
            if critere(appareil):
                return appareil

    return None


def demarrer_spotify_pc():
    """Ouvre l'appli Spotify du PC et attend qu'elle soit visible par l'API."""
    resultat = applications.trouver_application(
        "spotify",
        applications.obtenir_index(),
        applications.charger_surnoms(),
    )

    if resultat["statut"] != "trouve":
        raise ErreurSpotify("Application Spotify introuvable sur le PC.")

    applications.lancer_application(resultat["application"])
    print("[SPOTIFY] démarrage de l'application, attente de l'appareil...", flush=True)

    limite = time.time() + DELAI_DEMARRAGE_SPOTIFY_S

    while time.time() < limite:
        time.sleep(1)
        appareil = choisir_appareil_pc(lister_appareils())

        if appareil is not None:
            return appareil

    raise ErreurSpotify("Spotify a été ouvert mais n'est pas apparu à temps.")


def obtenir_appareil_pc():
    appareil = choisir_appareil_pc(lister_appareils())

    if appareil is None:
        appareil = demarrer_spotify_pc()

    return appareil


# =========================================================
# Recherche
# =========================================================

def decrire_element(element):
    """'Titre – Artiste' pour un titre/album, le nom pour le reste."""
    nom = element.get("name", "?")
    artistes = ", ".join(a.get("name", "") for a in element.get("artists", []))

    return f"{nom} – {artistes}" if artistes else nom


def rechercher(recherche: str, type_api: str, limite: int = 5):
    reponse = appel_api("GET", "/search", {
        "q": recherche,
        "type": type_api,
        "limit": limite,
        "market": "from_token",
    })

    # L'API renvoie parfois des éléments null (playlists supprimées...).
    return [e for e in reponse.get(type_api + "s", {}).get("items", []) if e]


def lister_mes_playlists():
    playlists = []
    parametres = {"limit": 50, "offset": 0}

    while True:
        page = appel_api("GET", "/me/playlists", parametres)
        playlists += [p for p in page.get("items", []) if p]

        if not page.get("next"):
            return playlists

        parametres["offset"] += parametres["limit"]


def trouver_ma_playlist(recherche: str, playlists):
    """Même rapprochement déterministe que pour les applications."""
    index = [
        {"nom": p["name"], "source": "menu", "cible": p["uri"], "cle": applications.normaliser_nom(p["name"])}
        for p in playlists
        if p.get("name")
    ]

    return applications.trouver_application(recherche, index)


# =========================================================
# Playlist miroir des titres likés
# =========================================================
#
# L'appli de bureau ignore le contexte « titres likés » envoyé par l'API
# (elle reprend la lecture précédente). On maintient donc une playlist
# privée qui recopie les titres likés, et c'est elle qu'on joue.

def lister_titres_likes():
    """URI des titres likés, du plus récent au plus ancien (hors fichiers locaux)."""
    uris = []
    parametres = {"limit": 50, "offset": 0, "market": "from_token"}

    while True:
        page = appel_api("GET", "/me/tracks", parametres)

        for element in page.get("items", []):
            titre = (element or {}).get("track") or {}
            uri = titre.get("uri", "")

            if uri.startswith("spotify:track:"):
                uris.append(uri)

        if not page.get("next"):
            return uris

        parametres["offset"] += parametres["limit"]


def empreinte_titres_likes():
    """Nombre de titres likés + le plus récent : change dès qu'on like ou retire un titre."""
    page = appel_api("GET", "/me/tracks", {"limit": 1})
    premier = (page.get("items") or [{}])[0] or {}

    return {
        "total": page.get("total"),
        "plus_recent": ((premier.get("track") or {}).get("uri"), premier.get("added_at")),
    }


def charger_etat_miroir():
    try:
        return json.loads(CHEMIN_MIROIR.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def obtenir_playlist_miroir(etat):
    """Retrouve la playlist miroir (par id enregistré, sinon par nom), ou la crée."""
    identifiant_compte = appel_api("GET", "/me")["id"]

    for playlist in lister_mes_playlists():
        proprietaire = (playlist.get("owner") or {}).get("id")

        if proprietaire != identifiant_compte:
            continue

        if playlist["id"] == etat.get("playlist_id") or playlist.get("name") == NOM_PLAYLIST_MIROIR:
            return playlist

    print("[SPOTIFY] création de la playlist miroir des titres likés", flush=True)

    # /users/{id}/playlists répond 403 pour cette appli (mode développeur).
    return appel_api("POST", "/me/playlists", corps={
        "name": NOM_PLAYLIST_MIROIR,
        "public": False,
        "description": DESCRIPTION_PLAYLIST_MIROIR,
    })


def remplacer_contenu_playlist(id_playlist, uris):
    # PUT remplace tout (100 titres max par appel), POST ajoute la suite.
    # /playlists/{id}/tracks répond 403 : l'API utilise désormais /items.
    appel_api("PUT", f"/playlists/{id_playlist}/items", corps={"uris": uris[:100]})

    for debut in range(100, len(uris), 100):
        appel_api("POST", f"/playlists/{id_playlist}/items", corps={"uris": uris[debut:debut + 100]})


def synchroniser_miroir():
    """Met la playlist miroir à jour si les titres likés ont changé. Renvoie son URI."""
    etat = charger_etat_miroir()
    playlist = obtenir_playlist_miroir(etat)
    empreinte = empreinte_titres_likes()

    # JSON transforme les tuples en listes : on compare sous la même forme.
    empreinte_json = json.loads(json.dumps(empreinte))

    if etat.get("playlist_id") == playlist["id"] and etat.get("empreinte") == empreinte_json:
        return playlist["uri"]

    uris = lister_titres_likes()
    remplacer_contenu_playlist(playlist["id"], uris)

    CHEMIN_MIROIR.parent.mkdir(parents=True, exist_ok=True)
    CHEMIN_MIROIR.write_text(json.dumps({
        "playlist_id": playlist["id"],
        "empreinte": empreinte_json,
    }, indent=4, ensure_ascii=False), encoding="utf-8")

    print(f"[SPOTIFY] playlist miroir synchronisée : {len(uris)} titres", flush=True)

    return playlist["uri"]


def resoudre_lecture(recherche: str, type_lecture: str):
    """
    Traduit la demande en ce qu'il faut envoyer à /me/player/play,
    sans rien jouer.

    Returns:
        {"corps": {...}, "description": "..."} ou {"message": "..."} si
        l'utilisateur doit préciser.
    """
    type_lecture = applications.normaliser_nom(type_lecture or "titre").replace(" ", "_")
    cle_recherche = applications.normaliser_nom(recherche)

    if type_lecture == "titres_likes" or cle_recherche in NOMS_TITRES_LIKES:
        return {
            "corps": {
                "context_uri": synchroniser_miroir(),
                "offset": {"position": 0},
            },
            "description": "tes titres likés",
        }

    if type_lecture not in TYPES_RECHERCHE:
        return {"message": f"Type inconnu : {type_lecture}. Types possibles : "
                           + ", ".join(list(TYPES_RECHERCHE) + ["titres_likes"]) + "."}

    if type_lecture == "playlist":
        resultat = trouver_ma_playlist(recherche, lister_mes_playlists())

        if resultat["statut"] == "trouve":
            playlist = resultat["application"]
            return {
                "corps": {"context_uri": playlist["cible"]},
                "description": f"ta playlist {playlist['nom']}",
            }

        if resultat["statut"] in ("ambigu", "proche"):
            return {"message": "Plusieurs de tes playlists peuvent correspondre : "
                               + ", ".join(resultat["candidats"])
                               + ". Demande à l'utilisateur laquelle jouer."}

    type_api = TYPES_RECHERCHE[type_lecture]
    resultats = rechercher(recherche, type_api)

    if not resultats:
        return {"message": f"Aucun résultat Spotify pour « {recherche} » ({type_lecture})."}

    element = resultats[0]

    if type_api == "track":
        # L'appli de bureau ignore {"uris": [...]} (lecteur vidé, rien ne joue) ;
        # le titre est donc lancé dans le contexte de son album.
        corps = {
            "context_uri": element["album"]["uri"],
            "offset": {"uri": element["uri"]},
        }
    else:
        corps = {"context_uri": element["uri"]}

    return {
        "corps": corps,
        "description": decrire_element(element),
    }


# =========================================================
# Lecture
# =========================================================

def jouer_sur_pc(corps):
    appareil = obtenir_appareil_pc()

    # Juste après le démarrage, l'appareil peut encore être refusé : on réessaie.
    for tentative in range(3):
        try:
            appel_api("PUT", "/me/player/play", {"device_id": appareil["id"]}, corps)
            return appareil

        except ErreurSpotify as erreur:
            if erreur.statut != 404 or tentative == 2:
                raise

            time.sleep(1.5)


def verifier_lecture(corps):
    """
    Relit le lecteur jusqu'à voir le bon contexte (et le bon titre) en lecture.
    Spotify peut accepter une commande puis jouer autre chose.

    Returns:
        (True, None) ou (False, description de ce qui joue réellement)
    """
    contexte_attendu = corps.get("context_uri")
    titre_attendu = (corps.get("offset") or {}).get("uri")
    constate = "rien"
    limite = time.time() + DELAI_VERIFICATION_S

    while time.time() < limite:
        time.sleep(1)
        etat = appel_api("GET", "/me/player")

        if not etat or not etat.get("item"):
            constate = "rien"
            continue

        item = etat["item"]
        constate = decrire_element(item)
        contexte = (etat.get("context") or {}).get("uri")
        uris_titre = {item.get("uri"), (item.get("linked_from") or {}).get("uri")}

        if (
            etat.get("is_playing")
            and contexte == contexte_attendu
            and (titre_attendu is None or titre_attendu in uris_titre)
        ):
            return True, None

    return False, constate


def outil_spotify_jouer(recherche: str, type: str = "titre"):
    """
    Lance de la musique sur Spotify, sur le PC de l'utilisateur.

    Spotify est ouvert automatiquement s'il est fermé.

    Args:
        recherche:
            Ce que l'utilisateur veut écouter, tel qu'il le dit.
            Exemples : "Midnight Train to Georgia", "Daft Punk",
            "Random Access Memories", "Sport", "titres likés".

        type:
            "titre" pour un morceau, "album", "artiste", "playlist"
            (les playlists de l'utilisateur sont cherchées en premier),
            ou "titres_likes" pour ses titres likés.

    Returns:
        Un dictionnaire indiquant ce qui est réellement joué, à annoncer
        à l'utilisateur, ou une erreur / une question à lui poser.
    """
    try:
        resolution = resoudre_lecture(recherche, type)

        if "message" in resolution:
            return {"succes": False, "message": resolution["message"]}

        appareil = jouer_sur_pc(resolution["corps"])
        lecture_ok, constate = verifier_lecture(resolution["corps"])

    except ErreurSpotify as erreur:
        print("[SPOTIFY] ERREUR :", erreur, flush=True)
        return {"succes": False, "erreur": str(erreur)}

    if not lecture_ok:
        print(
            "[SPOTIFY] lecture non confirmée :", resolution["description"],
            "| joue réellement :", constate,
            flush=True
        )
        return {
            "succes": False,
            "erreur": (
                f"Spotify a accepté la demande ({resolution['description']}) "
                f"mais ne la joue pas. Lecture actuelle : {constate}."
            ),
        }

    print("[SPOTIFY] lecture :", resolution["description"], "|", appareil.get("name"), flush=True)

    return {
        "succes": True,
        "lecture": resolution["description"],
        "appareil": appareil.get("name"),
    }


# =========================================================
# Commandes de lecture
# =========================================================

ACTIONS_CONTROLE = {
    "pause": "pause",
    "stop": "pause",
    "arreter": "pause",
    "arrete": "pause",
    "reprendre": "reprendre",
    "reprise": "reprendre",
    "play": "reprendre",
    "lecture": "reprendre",
    "continuer": "reprendre",
    "suivant": "suivant",
    "suivante": "suivant",
    "next": "suivant",
    "passer": "suivant",
    "precedent": "precedent",
    "precedente": "precedent",
    "previous": "precedent",
    "en cours": "en_cours",
    "en_cours": "en_cours",
    "titre en cours": "en_cours",
    "quoi": "en_cours",
}


def lire_etat_lecteur():
    """État du lecteur, ou None si aucune lecture Spotify active nulle part."""
    etat = appel_api("GET", "/me/player")

    if not etat or not etat.get("device"):
        return None

    return etat


def decrire_etat(etat):
    item = (etat or {}).get("item")

    if not item:
        return "rien"

    return decrire_element(item)


def attendre_etat(condition, delai=DELAI_VERIFICATION_S):
    """Relit le lecteur jusqu'à ce que condition(etat) soit vraie. Renvoie le dernier état."""
    limite = time.time() + delai
    etat = None

    while time.time() < limite:
        time.sleep(0.8)
        etat = lire_etat_lecteur()

        if etat is not None and condition(etat):
            return etat, True

    return etat, False


def outil_spotify_controle(action: str):
    """
    Contrôle la lecture Spotify en cours, ou indique quel morceau joue.

    Tu ne peux pas savoir quelle musique joue sans cet outil : dès que
    l'utilisateur demande ce qui passe (titre, artiste, « c'est quoi
    cette musique ? »), appelle-le avec action="en_cours" et ne devine
    jamais.

    Args:
        action:
            "pause", "reprendre", "suivant", "precedent", ou "en_cours"
            pour savoir quel morceau est en train de jouer.

    Returns:
        Un dictionnaire avec le résultat réel (morceau en cours après
        l'action), ou une erreur à expliquer à l'utilisateur.
    """
    action_normalisee = ACTIONS_CONTROLE.get(
        applications.normaliser_nom(action or "").replace("_", " ")
    ) or ACTIONS_CONTROLE.get(action)

    if action_normalisee is None:
        return {
            "succes": False,
            "erreur": f"Action inconnue : {action}. Actions possibles : "
                      "pause, reprendre, suivant, precedent, en_cours.",
        }

    try:
        etat = lire_etat_lecteur()

        if etat is None:
            return {"succes": False, "erreur": "Aucune lecture Spotify active."}

        morceau_avant = decrire_etat(etat)
        uri_avant = (etat.get("item") or {}).get("uri")
        progression_avant = etat.get("progress_ms") or 0

        if action_normalisee == "en_cours":
            return {
                "succes": True,
                "morceau": morceau_avant,
                "en_lecture": bool(etat.get("is_playing")),
                "appareil": etat["device"].get("name"),
            }

        if action_normalisee == "pause":
            if not etat.get("is_playing"):
                return {"succes": True, "message": f"Déjà en pause ({morceau_avant})."}

            appel_api("PUT", "/me/player/pause")
            etat, ok = attendre_etat(lambda e: not e.get("is_playing"))

        elif action_normalisee == "reprendre":
            if etat.get("is_playing"):
                return {"succes": True, "message": f"Déjà en lecture ({morceau_avant})."}

            appel_api("PUT", "/me/player/play")
            etat, ok = attendre_etat(lambda e: e.get("is_playing"))

        elif action_normalisee == "suivant":
            appel_api("POST", "/me/player/next")
            etat, ok = attendre_etat(
                lambda e: (e.get("item") or {}).get("uri") != uri_avant
            )

        else:
            appel_api("POST", "/me/player/previous")
            # Selon l'appli, "précédent" change de titre ou revient au début du titre.
            etat, ok = attendre_etat(
                lambda e: (e.get("item") or {}).get("uri") != uri_avant
                or (e.get("progress_ms") or 0) < min(progression_avant, 3000)
            )

    except ErreurSpotify as erreur:
        if erreur.statut == 403:
            return {
                "succes": False,
                "erreur": f"Spotify n'autorise pas « {action_normalisee} » maintenant "
                          "(par exemple pas de titre précédent).",
            }

        print("[SPOTIFY] ERREUR :", erreur, flush=True)
        return {"succes": False, "erreur": str(erreur)}

    morceau = decrire_etat(etat)

    if not ok:
        return {
            "succes": False,
            "erreur": f"Spotify a accepté « {action_normalisee} » mais rien n'a changé. "
                      f"Morceau actuel : {morceau}.",
        }

    print("[SPOTIFY] contrôle :", action_normalisee, "|", morceau, flush=True)

    return {
        "succes": True,
        "action": action_normalisee,
        "morceau": morceau,
        "en_lecture": bool(etat.get("is_playing")),
    }


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
