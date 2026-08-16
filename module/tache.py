from . import function
import difflib


def outil_ajouter_tache(nom_tache: str, priorite: int) -> str:
    """
        Ajoute une nouvelle tâche à la liste des tâches de l'utilisateur.

        Args:
            nom_tache: Intitulé de la tâche à ajouter.
            priorite: Priorité de la tâche, comprise entre 1 et 10.

        Returns:
            Un message indiquant si la tâche a été ajoutée avec succès
            ou si l'ajout a échoué.
    """
    liste_tache=function.charger_donnees("data/liste_tache.json", [])
    if ajouter(liste_tache,nom_tache, priorite):
        function.sauvegarder_donnees("data/liste_tache.json", liste_tache)
        return "Tâche ajouté avec succés"
    else:
        return "Tâche non ajouté"


def outil_lister_taches()-> list:
    """
       Retourne la liste actuelle des tâches de l'utilisateur.

       Returns:
           Une liste contenant les tâches actuelles avec leur intitulé,
           leur priorité et leur statut.
    """
    liste_tache = function.charger_donnees("data/liste_tache.json", [])
    return montrer(liste_tache)


def outil_modifier_statut(nom_tache: str, nouveau_statut: str) -> str:
    """
    Modifie le statut d'une tâche existante.

    Si le nouveau statut est "terminé", la tâche est retirée
    de la liste des tâches actives.

    Args:
        nom_tache: Nom de la tâche à modifier.
        nouveau_statut: Nouveau statut à appliquer à la tâche.
            Les statuts actifs autorisés sont "non commencé" et "en cours".
            La valeur "terminé" permet de terminer et retirer la tâche.

    Returns:
        Un message indiquant si la modification a réussi,
        si la tâche est introuvable ou si le statut est invalide.
    """
    liste_tache = function.charger_donnees("data/liste_tache.json", [])
    tache=trouver_tache(nom_tache, liste_tache)
    nouveau_statut_normalisation=function.normalisation_choix(nouveau_statut)
    if tache is not None:
        if nouveau_statut_normalisation == "terminé":
            supprimer(liste_tache, nom_tache)
            function.sauvegarder_donnees("data/liste_tache.json", liste_tache)
            return "Tâche modifié avec succés"
        if verification_statut(nouveau_statut_normalisation):
            modifier_statut(nouveau_statut_normalisation,tache)
            function.sauvegarder_donnees("data/liste_tache.json", liste_tache)
            return "Tâche modifié avec succés"
        else:
            return "Statut invalide"
    else:
        return "Tâche non trouvé"


def outil_supprimer_tache(nom_tache: str) -> str:
    """
    Supprime une tâche existante de la liste des tâches.

    Args:
        nom_tache: Nom de la tâche à supprimer.
            Une correspondance approximative peut être utilisée
            si le nom n'est pas strictement identique.

    Returns:
        Un message indiquant si la tâche a été supprimée avec succès
        ou si aucune tâche correspondante n'a été trouvée.
    """
    liste_tache = function.charger_donnees("data/liste_tache.json", [])
    if supprimer(liste_tache,nom_tache):
        function.sauvegarder_donnees("data/liste_tache.json", liste_tache)
        return "Tâche supprimé avec succés"
    else:
        return "Tâche non supprimé"


def ajouter(liste_tache, intitule, priorite):
    priorite_convertie = function.conversion_en_entier(priorite)

    if priorite_convertie is None:
        return False

    if priorite_convertie not in range(1, 11):
        return False

    liste_tache.append({
        "nom_tache": intitule,
        "priorite": priorite_convertie,
        "statut": "non commencé",
    })

    return True


def montrer( liste_tache):
    taches=[]
    for index, tache in enumerate(liste_tache, start=1):
        taches.append((index, f'Intitulé: {tache["nom_tache"]} / Priorité: {tache["priorite"]} / Statut: {tache["statut"]}'))
    return taches


def supprimer( liste_tache, nom_tache):
    tache=trouver_tache(nom_tache, liste_tache)
    if tache is None:
        return False
    liste_tache.remove(tache)
    return True


def trouver_tache(nom_recherche, liste_tache):
    nom_normalise = function.normalisation_choix(nom_recherche)
    noms_normalises = []

    for tache in liste_tache:
        nom_tache = function.normalisation_choix(tache["nom_tache"])
        noms_normalises.append(nom_tache)

        if nom_tache == nom_normalise:
            return tache

    correspondances = difflib.get_close_matches(
        nom_normalise,
        noms_normalises,
        n=1,
        cutoff=0.9,
    )

    if correspondances:
        indice = noms_normalises.index(correspondances[0])
        return liste_tache[indice]

    return None


def verification_statut(nouveau_statut):
    STATUTS_POSSIBLES = {"non commencé", "en cours"}
    return nouveau_statut in STATUTS_POSSIBLES

def modifier_statut(nouveau_statut, tache_modifie):
    tache_modifie["statut"] = nouveau_statut

