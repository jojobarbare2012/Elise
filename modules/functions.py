import json

def conversion_en_entier(nombre):
    try:
        return int(nombre)
    except (ValueError, TypeError):
        return None

def normalisation_choix(commande_saisie):
    sans_espace=commande_saisie.strip()
    sans_majuscule=sans_espace.lower()
    return sans_majuscule



def charger_donnees(fichier, valeur_defaut):
    try:
        with open(fichier, "r", encoding="utf-8") as f:
            return json.load(f)

    except FileNotFoundError:
        sauvegarder_donnees(fichier, valeur_defaut)
        return valeur_defaut


def sauvegarder_donnees(fichier, donnees):
    with open(fichier, "w", encoding="utf-8") as f:
        json.dump(
            donnees,
            f,
            ensure_ascii=False,
            indent=2,
        )