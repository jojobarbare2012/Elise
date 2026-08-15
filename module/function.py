import json

def conversion_en_entier(nombre):
    try:
        nombre_converti=int(nombre)
        return nombre_converti
    except ValueError:
        return None

def normalisation_choix(commande_saisie):
    sans_espace=commande_saisie.strip()
    sans_majuscule=sans_espace.lower()
    return sans_majuscule


def charger_donnees(fichier, valeur_defaut):
    try:
        with open(fichier, "r") as f:
            return json.load(f)
    except FileNotFoundError:
        with open(fichier, "w") as f:
            json.dump(valeur_defaut, f)
            return  valeur_defaut


def sauvegarder_donnees(fichier, donnees):
    with open(fichier,'w') as f:
        json.dump(donnees, f)