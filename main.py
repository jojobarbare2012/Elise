from module import function
from module import tache
from module import applications



def interface_elise():
    commandes={"tache":tache.interface_tache, "applications":applications.interface_application}
    profil=function.charger_donnees("data/profil.json", {})
    if "prenom" not in profil:
        prenom = input("Quel est votre nom?\n")
        profil["prenom"] = prenom
        function.sauvegarder_donnees("data/profil.json", profil)
    else:
        prenom = profil["prenom"]
    while True:
        print(f"Bonjour {prenom}.\n")
        for commande in commandes:
            print(commande)
        print("quitter\n")
        reponse=function.normalisation_choix(input('Que souhaites-tu faire?\n'))
        if reponse == "quitter":
            break
        elif reponse in commandes:
            commandes[reponse](prenom)
        else:
            print("Réponse invalide\n")


interface_elise()




