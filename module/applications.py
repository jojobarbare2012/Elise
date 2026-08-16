import subprocess

from . import function


def lancer_application_locale(nom_appli: str) -> str:
    """
    Lance une application installée sur l'ordinateur.

    Args:
        nom_appli: Nom de l'application que l'utilisateur souhaite ouvrir,
            par exemple "vscode", "discord" ou "spotify".

    Returns:
        Un message indiquant si l'application a été lancée avec succès
        ou si son lancement a échoué.
    """
    applications = function.charger_donnees(
        "data/applications.json",
        {}
    )

    if lancer_application(nom_appli, applications):
        return f"Application {nom_appli} lancée avec succès."

    return f"Échec du lancement de l'application {nom_appli}."


def lancer_application(nom_appli, applications):
    if nom_appli not in applications:
        return False

    chemin = applications[nom_appli]["chemin"]

    try:
        subprocess.Popen(chemin)
        return True

    except (FileNotFoundError, PermissionError):
        return False