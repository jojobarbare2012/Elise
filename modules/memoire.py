"""
Outils de mémoire : ce que Jonathan demande explicitement à Élise.
La mémorisation automatique reste dans core/memoire.py.
"""
from datetime import datetime, timedelta

from core.memoire import (
    NIVEAUX_IMPORTANCE,
    TYPES_SOUVENIRS,
    appliquer_modification_en_attente,
    desactiver_souvenir,
    lister_souvenirs_actifs,
    rechercher_echanges,
    traiter_nouveau_souvenir,
    trouver_souvenir_actif,
    trouver_souvenirs_similaires,
)

JOURS_SEMAINE = [
    "lundi",
    "mardi",
    "mercredi",
    "jeudi",
    "vendredi",
    "samedi",
    "dimanche",
]

TAILLE_MAX_EXTRAIT = 200
NOMBRE_MAX_SOUVENIRS = 50
NOMBRE_CHOIX_OUBLI = 3


def resoudre_periode_passee(expression: str):
    """
    Résout une période passée en dates ISO [debut, fin[.
    Le module calendrier ne gère que le futur.
    Retourne None si l'expression n'est pas comprise.
    """
    expression = expression.strip().lower().replace("’", "'")
    expression = expression.removeprefix("la ").removeprefix("le ").strip()
    aujourd_hui = datetime.now().date()
    lundi_courant = aujourd_hui - timedelta(days=aujourd_hui.weekday())
    nombre_jours = 1

    if expression in {"aujourd'hui", "aujourdhui"}:
        debut = aujourd_hui

    elif expression == "hier":
        debut = aujourd_hui - timedelta(days=1)

    elif expression in {"avant-hier", "avant hier"}:
        debut = aujourd_hui - timedelta(days=2)

    elif expression == "cette semaine":
        debut = lundi_courant
        nombre_jours = 7

    elif expression == "semaine dernière":
        debut = lundi_courant - timedelta(days=7)
        nombre_jours = 7

    elif expression.split()[:1] and expression.split()[0] in JOURS_SEMAINE:
        # « lundi » ou « lundi dernier » : le dernier lundi écoulé.
        jour = JOURS_SEMAINE.index(expression.split()[0])
        ecart = (aujourd_hui.weekday() - jour) % 7 or 7
        debut = aujourd_hui - timedelta(days=ecart)

    else:
        try:
            debut = datetime.fromisoformat(expression).date()

        except ValueError:
            return None

    return (
        debut.isoformat(),
        (debut + timedelta(days=nombre_jours)).isoformat(),
    )


def outil_retenir(
    information: str,
    type_souvenir: str = "personnel",
    importance: str = "forte",
) -> dict:
    """
    Enregistre une information dans la mémoire persistante.
    À utiliser uniquement quand Jonathan demande explicitement de retenir
    ou de noter quelque chose sur lui (« retiens que », « souviens-toi que »).

    Args:
        information: Une seule information, phrase complète qui nomme
            Jonathan, par exemple "Jonathan est allergique au kiwi."
        type_souvenir: preference, projet, personnel, contexte ou objectif.
        importance: faible, moyenne, forte, ou critique pour la santé
            et la sécurité.

    Returns:
        Le résultat, avec les anciens souvenirs remplacés s'il y en a.
    """
    if type_souvenir not in TYPES_SOUVENIRS:
        type_souvenir = "personnel"

    resultat = traiter_nouveau_souvenir({
        "contenu": information,
        "type": type_souvenir,
        "importance": NIVEAUX_IMPORTANCE.get(
            importance,
            NIVEAUX_IMPORTANCE["forte"]
        ),
    })

    if resultat is None:
        return {
            "succes": False,
            "erreur": "Analyse impossible, rien n'a été retenu."
        }

    if resultat is True:
        return {"succes": True, "statut": "retenu"}

    if resultat is False:
        return {"succes": True, "statut": "déjà connu"}

    # Jonathan vient de le demander : pas besoin de reconfirmer.
    appliquer_modification_en_attente(resultat["id_modification"])

    return {
        "succes": True,
        "statut": "retenu, anciens souvenirs remplacés",
        "remplaces": [
            souvenir["contenu"]
            for souvenir in resultat["anciens_souvenirs"]
        ],
    }


def outil_oublier(description: str, id_souvenir: int = 0) -> dict:
    """
    Retire un souvenir de la mémoire quand Jonathan demande de l'oublier.
    Se fait en deux temps : sans id_souvenir, l'outil ne retire rien et
    propose des souvenirs ; demande alors à Jonathan lequel oublier, puis
    rappelle l'outil avec son id, seulement après sa confirmation.

    Args:
        description: Ce que Jonathan veut faire oublier.
        id_souvenir: Identifiant confirmé par Jonathan. 0 pour chercher.

    Returns:
        Les souvenirs proposés, ou le souvenir retiré.
    """
    if id_souvenir:
        souvenir = trouver_souvenir_actif(id_souvenir)

        if souvenir is None:
            return {"succes": False, "erreur": "Souvenir introuvable."}

        desactiver_souvenir(id_souvenir)

        return {"succes": True, "oublie": souvenir["contenu"]}

    candidats = trouver_souvenirs_similaires(description)[:NOMBRE_CHOIX_OUBLI]

    return {
        "succes": False,
        "statut": "rien retiré, confirmation requise",
        "propositions": [
            {
                "id": candidat["souvenir"]["id"],
                "contenu": candidat["souvenir"]["contenu"],
            }
            for candidat in candidats
        ],
    }


def outil_chercher_memoire(recherche: str = "", periode: str = "") -> dict:
    """
    Cherche dans les souvenirs et dans les anciennes conversations.
    À utiliser quand Jonathan demande ce que tu sais de lui, ce qu'il
    t'a dit, ou de quoi vous avez parlé.

    Args:
        recherche: Sujet cherché. Vide pour tout lister.
        periode: Période passée des conversations : aujourd'hui, hier,
            avant-hier, cette semaine, semaine dernière, lundi, ou une
            date AAAA-MM-JJ. Vide pour ne pas filtrer.

    Returns:
        Les souvenirs et les extraits de conversations trouvés.
    """
    debut = fin = None

    if periode:
        bornes = resoudre_periode_passee(periode)

        if bornes is None:
            return {"succes": False, "erreur": f"Période inconnue : {periode}"}

        debut, fin = bornes

    if recherche:
        souvenirs = [
            candidat["souvenir"]["contenu"]
            for candidat in trouver_souvenirs_similaires(recherche)
        ]

    elif periode:
        souvenirs = []

    else:
        souvenirs = [
            souvenir["contenu"]
            for souvenir in lister_souvenirs_actifs()
        ][:NOMBRE_MAX_SOUVENIRS]

    conversations = [
        {
            "date": echange["date"],
            "role": echange["role"],
            "extrait": echange["contenu"][:TAILLE_MAX_EXTRAIT],
        }
        for echange in rechercher_echanges(recherche, debut, fin)
    ]

    return {
        "succes": True,
        "souvenirs": souvenirs,
        "conversations": conversations,
    }
