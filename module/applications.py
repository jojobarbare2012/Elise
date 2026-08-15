from . import function
import subprocess

def interface_application(prenom):
    applications = function.charger_donnees("data/applications.json", {})
    while True:
        reponse=function.normalisation_choix(input("Quel application veux-tu lancer ?\n"))
        if reponse == "retour":
            break
        if lancer_application(reponse,applications):
            print("Application lancé avec succès")
        else:
            print("Échec du lancement")


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
    applications = function.charger_donnees("data/applications.json", {})
    if lancer_application(nom_appli, applications):
        return f"Application {nom_appli} lancé avec succès."
    else:
        return f"Échec du lancement de l'application {nom_appli}."

def lancer_application(nom_appli, applications):
    if nom_appli in applications:
        chemin=applications[nom_appli]["chemin"]
        try:
            subprocess.Popen(chemin)
            return True
        except (FileNotFoundError, PermissionError):
            return False
    else:
        return False