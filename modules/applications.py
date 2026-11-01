"""
Lancement d'applications installées sur le PC (Windows uniquement).

Au lieu de chemins absolus (qui cassent dès qu'un dossier contient une
version), on demande à Windows la liste de ses applications :
1. le menu Démarrer (Get-StartApps, y compris les applis du Store) ;
2. les raccourcis du Bureau (.lnk, .url) ;
3. les programmes installés du registre (pour les applis sans raccourci).

Le nom demandé est rapproché de cette liste de façon déterministe.
data/applications.json ne contient plus que des surnoms :
{"vscode": "Visual Studio Code"}.

Dépendance Windows assumée : à remplacer lors du portage Linux.
"""

import json
import os
import re
import subprocess
import unicodedata
import winreg
from difflib import SequenceMatcher
from pathlib import Path
from threading import Lock

from . import functions as function


CHEMIN_SURNOMS = "data/applications.json"

PRIORITE_SOURCES = {
    "menu": 0,
    "raccourci": 1,
    "exe": 2,
}

MOTS_EXCLUS = (
    "uninstall",
    "desinstall",
)

SEUIL_FAUTE_DE_FRAPPE = 0.8
SEUIL_SUGGESTION = 0.6
NOMBRE_MAX_CANDIDATS = 8

CLES_PROGRAMMES_INSTALLES = (
    (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
    (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
)

_index_applications = None
_verrou_index = Lock()


# =========================================================
# Normalisation des noms
# =========================================================

def normaliser_nom(texte: str) -> str:
    """
    "PyCharm 2026.2.0.1" → "pycharm", "Bloc-notes" → "bloc notes",
    "Navigateur Opera GX" → "navigateur opera gx".
    """
    texte = unicodedata.normalize("NFKD", texte.lower())
    texte = "".join(c for c in texte if not unicodedata.combining(c))

    # Numéros de version : 2026.2.0.1, v1.2, 1.0.9254...
    texte = re.sub(r"\bv?\d+(\.\d+)+\b", " ", texte)

    texte = re.sub(r"[^a-z0-9]+", " ", texte)

    return " ".join(texte.split())


def est_exclue(cle: str) -> bool:
    return any(mot in cle for mot in MOTS_EXCLUS)


# =========================================================
# Sources Windows
# =========================================================

def lister_menu_demarrer():
    commande = (
        "[Console]::OutputEncoding = [Text.Encoding]::UTF8; "
        "Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress"
    )

    try:
        resultat = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", commande],
            capture_output=True,
            timeout=30,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        donnees = json.loads(resultat.stdout.decode("utf-8", errors="replace") or "[]")

    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as erreur:
        print("[APPLICATIONS] menu Démarrer illisible :", repr(erreur), flush=True)
        return []

    if isinstance(donnees, dict):
        donnees = [donnees]

    applications = []

    for appli in donnees:
        nom = appli.get("Name")
        identifiant = appli.get("AppID")

        if not nom or not identifiant:
            continue

        # Liens web du menu Démarrer (ex. "Steam Support Center").
        if identifiant.lower().startswith(("http://", "https://")):
            continue

        applications.append({
            "nom": nom,
            "source": "menu",
            "cible": identifiant,
        })

    return applications


def lire_url_raccourci_internet(chemin: Path):
    try:
        for ligne in chemin.read_text(encoding="utf-8", errors="replace").splitlines():
            if ligne.upper().startswith("URL="):
                return ligne[4:].strip()
    except OSError:
        pass

    return None


def lister_raccourcis_bureau():
    dossiers = [
        Path(os.environ.get("USERPROFILE", "")) / "Desktop",
        Path(os.environ.get("PUBLIC", "")) / "Desktop",
    ]

    if os.environ.get("OneDrive"):
        dossiers.append(Path(os.environ["OneDrive"]) / "Desktop")

    applications = []

    for dossier in dossiers:
        if not dossier.is_dir():
            continue

        for chemin in dossier.iterdir():
            extension = chemin.suffix.lower()

            if extension not in (".lnk", ".url"):
                continue

            # Un .url vers un site web n'est pas une application
            # (un .url steam:// en est une : jeux Steam).
            if extension == ".url":
                url = lire_url_raccourci_internet(chemin) or ""

                if url.lower().startswith(("http://", "https://")):
                    continue

            applications.append({
                "nom": chemin.stem,
                "source": "raccourci",
                "cible": str(chemin),
            })

    return applications


def lire_valeur_registre(cle, nom):
    try:
        return winreg.QueryValueEx(cle, nom)[0]
    except OSError:
        return None


def extraire_exe_icone(icone: str):
    """'"C:\\...\\pycharm64.exe",0' → 'C:\\...\\pycharm64.exe' (ou None)."""
    chemin = icone.split(",")[0].strip().strip('"')

    if not chemin.lower().endswith(".exe"):
        return None

    if "unins" in Path(chemin).name.lower():
        return None

    if not os.path.isfile(chemin):
        return None

    return chemin


def lister_programmes_installes():
    applications = []

    for racine, chemin_cle in CLES_PROGRAMMES_INSTALLES:
        try:
            cle_parente = winreg.OpenKey(racine, chemin_cle)
        except OSError:
            continue

        with cle_parente:
            nombre_sous_cles = winreg.QueryInfoKey(cle_parente)[0]

            for i in range(nombre_sous_cles):
                try:
                    nom_sous_cle = winreg.EnumKey(cle_parente, i)
                    sous_cle = winreg.OpenKey(cle_parente, nom_sous_cle)
                except OSError:
                    continue

                with sous_cle:
                    nom = lire_valeur_registre(sous_cle, "DisplayName")
                    icone = lire_valeur_registre(sous_cle, "DisplayIcon")
                    composant_systeme = lire_valeur_registre(sous_cle, "SystemComponent")

                if not nom or not isinstance(icone, str) or composant_systeme == 1:
                    continue

                executable = extraire_exe_icone(icone)

                if executable is None:
                    continue

                applications.append({
                    "nom": nom,
                    "source": "exe",
                    "cible": executable,
                })

    return applications


# =========================================================
# Index
# =========================================================

def construire_index(applications):
    """
    Dédoublonne par nom normalisé (menu > raccourci > exe) et retire
    les désinstalleurs. Chaque entrée reçoit sa clé de comparaison.
    """
    index = {}

    for appli in applications:
        cle = normaliser_nom(appli["nom"])

        if not cle or est_exclue(cle):
            continue

        existante = index.get(cle)

        if (
            existante is None
            or PRIORITE_SOURCES[appli["source"]] < PRIORITE_SOURCES[existante["source"]]
        ):
            index[cle] = {**appli, "cle": cle}

    return list(index.values())


def obtenir_index(reconstruire: bool = False):
    global _index_applications

    with _verrou_index:
        if _index_applications is None or reconstruire:
            applications = (
                lister_menu_demarrer()
                + lister_raccourcis_bureau()
                + lister_programmes_installes()
            )
            _index_applications = construire_index(applications)

            print(
                "[APPLICATIONS] index construit :",
                len(_index_applications),
                "applications",
                flush=True
            )

        return _index_applications


# =========================================================
# Recherche
# =========================================================

def charger_surnoms():
    donnees = function.charger_donnees(CHEMIN_SURNOMS, {})

    if not isinstance(donnees, dict):
        return {}

    # Les anciennes entrées {"chemin": ...} sont ignorées.
    return {
        normaliser_nom(surnom): nom
        for surnom, nom in donnees.items()
        if isinstance(nom, str)
    }


def contient_mots(cle: str, recherche: str) -> bool:
    return f" {recherche} " in f" {cle} "


def similarite(recherche: str, cle: str) -> float:
    """Meilleure ressemblance entre la recherche et le nom entier ou un de ses mots."""
    scores = [SequenceMatcher(None, recherche, cle).ratio()]

    nombre_mots = len(recherche.split())
    mots = cle.split()

    for i in range(len(mots) - nombre_mots + 1):
        morceau = " ".join(mots[i:i + nombre_mots])
        scores.append(SequenceMatcher(None, recherche, morceau).ratio())

    return max(scores)


def trouver_application(demande: str, index, surnoms=None):
    """
    Cherche d'abord dans le menu Démarrer et les raccourcis du Bureau ;
    les programmes du registre ne servent qu'en dernier recours (applis
    sans raccourci), pour ne pas doubler une appli déjà présente au menu
    sous un autre nom (ex. "Opera GX Stable 138..." / "Navigateur Opera GX").

    Une simple ressemblance (faute de frappe) ne lance jamais rien :
    elle renvoie "proche" pour que l'utilisateur confirme
    (ex. "photoshop" ressemble à "Photos", "teams" à "Steam").

    Returns:
        {"statut": "trouve", "application": {...}}
        {"statut": "ambigu", "candidats": [noms]}
        {"statut": "proche", "candidats": [noms]}
        {"statut": "introuvable", "suggestions": [noms]}
    """
    surnoms = surnoms or {}
    recherche = normaliser_nom(demande)

    if not recherche:
        return {"statut": "introuvable", "suggestions": []}

    if recherche in surnoms:
        recherche = normaliser_nom(surnoms[recherche])

    principales = [a for a in index if a["source"] != "exe"]
    secours = [a for a in index if a["source"] == "exe"]

    for groupe in (principales, secours):
        resultat = chercher_dans(recherche, groupe)

        if resultat is not None:
            return resultat

    scores = sorted(
        ((similarite(recherche, a["cle"]), a["nom"]) for a in index),
        reverse=True,
    )

    proches = [nom for score, nom in scores if score >= SEUIL_FAUTE_DE_FRAPPE]

    if proches:
        return {
            "statut": "proche",
            "candidats": proches[:NOMBRE_MAX_CANDIDATS],
        }

    return {
        "statut": "introuvable",
        "suggestions": [nom for score, nom in scores[:5] if score >= SEUIL_SUGGESTION],
    }


def chercher_dans(recherche: str, index):
    """Applique les paliers de correspondance ; None si rien ne correspond."""
    paliers = [
        lambda a: a["cle"] == recherche,
        lambda a: a["cle"].startswith(recherche + " "),
        lambda a: contient_mots(a["cle"], recherche),
    ]

    for correspond in paliers:
        candidats = [appli for appli in index if correspond(appli)]

        if len(candidats) == 1:
            return {"statut": "trouve", "application": candidats[0]}

        if len(candidats) > 1:
            candidats.sort(key=lambda a: a["nom"].lower())

            return {
                "statut": "ambigu",
                "candidats": [a["nom"] for a in candidats[:NOMBRE_MAX_CANDIDATS]],
            }

    return None


# =========================================================
# Lancement
# =========================================================

def lancer_application(application):
    source = application["source"]
    cible = application["cible"]

    if source == "menu":
        # Même chemin que le clic dans le menu Démarrer (applis Store comprises).
        subprocess.Popen(["explorer.exe", f"shell:AppsFolder\\{cible}"])

    elif source == "raccourci":
        os.startfile(cible)

    else:
        subprocess.Popen([cible], cwd=os.path.dirname(cible))


def lancer_application_locale(nom_appli: str) -> str:
    """
    Ouvre une application installée sur l'ordinateur de l'utilisateur.

    L'application est cherchée dans le menu Démarrer, les raccourcis du
    Bureau et les programmes installés. Il n'y a aucun chemin à fournir.

    Args:
        nom_appli: Nom de l'application tel que l'utilisateur le dit,
            par exemple "discord", "spotify", "vs code", "bloc-notes"
            ou "calculatrice".

    Returns:
        Un message indiquant l'application lancée. Si le nom est ambigu
        ou seulement proche d'une application, rien n'est lancé : demander
        à l'utilisateur de choisir ou de confirmer, puis rappeler l'outil
        avec le nom exact.
    """
    surnoms = charger_surnoms()
    resultat = trouver_application(nom_appli, obtenir_index(), surnoms)

    # Application peut-être installée depuis la construction de l'index.
    if resultat["statut"] in ("proche", "introuvable"):
        resultat = trouver_application(
            nom_appli,
            obtenir_index(reconstruire=True),
            surnoms,
        )

    if resultat["statut"] == "ambigu":
        return (
            f"Plusieurs applications correspondent à « {nom_appli} » : "
            + ", ".join(resultat["candidats"])
            + ". Demande à l'utilisateur laquelle ouvrir."
        )

    if resultat["statut"] == "proche":
        return (
            f"Aucune application ne s'appelle exactement « {nom_appli} ». "
            "Nom proche : " + ", ".join(resultat["candidats"])
            + ". Rien n'a été lancé : demande à l'utilisateur de confirmer, "
            "puis rappelle cet outil avec le nom exact."
        )

    if resultat["statut"] == "introuvable":
        message = f"Aucune application correspondant à « {nom_appli} » n'a été trouvée."

        if resultat["suggestions"]:
            message += " Applications proches : " + ", ".join(resultat["suggestions"]) + "."

        return message

    application = resultat["application"]

    try:
        lancer_application(application)

    except OSError as erreur:
        print("[APPLICATIONS] échec lancement :", repr(erreur), flush=True)
        return f"Échec du lancement de {application['nom']} : {erreur}"

    print(
        "[APPLICATIONS] lancement :",
        application["nom"],
        "|",
        application["source"],
        "|",
        application["cible"],
        flush=True
    )

    return f"Application {application['nom']} lancée."
