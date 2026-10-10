import sqlite3
from datetime import datetime, timedelta
from pathlib import Path


CHEMIN_BDD = Path("data/calendrier.db")
JOURS_INDEX = {
    "lundi": 0,
    "mardi": 1,
    "mercredi": 2,
    "jeudi": 3,
    "vendredi": 4,
    "samedi": 5,
    "dimanche": 6,
}

def resoudre_date_relative(expression: str):
    """
    Résout une expression temporelle simple en une période ISO.

    Exemples supportés :
    - aujourd'hui
    - demain
    - après-demain
    - lundi, mardi, mercredi...
    - lundi prochain, mardi prochain...
    - dans 3 jours

    Returns:
        Un dictionnaire avec :
        - debut_periode
        - fin_periode
        - date
    """

    maintenant = datetime.now().astimezone()
    aujourd_hui = maintenant.date()

    expression = expression.strip().lower()

    if expression in {"aujourd'hui", "aujourdhui"}:
        date_cible = aujourd_hui

    elif expression == "demain":
        date_cible = aujourd_hui + timedelta(days=1)

    elif expression in {"après-demain", "apres-demain"}:
        date_cible = aujourd_hui + timedelta(days=2)

    elif expression.startswith("dans ") and expression.endswith(" jours"):
        morceaux = expression.split()

        try:
            nombre_jours = int(morceaux[1])
        except (ValueError, IndexError):
            raise ValueError(
                f"Expression temporelle invalide : {expression}"
            )

        date_cible = aujourd_hui + timedelta(days=nombre_jours)

    else:
        mots = expression.split()

        jour_trouve = None

        for mot in mots:
            if mot in JOURS_INDEX:
                jour_trouve = mot
                break

        if jour_trouve is None:
            raise ValueError(
                f"Expression temporelle non reconnue : {expression}"
            )

        index_cible = JOURS_INDEX[jour_trouve]
        index_actuel = aujourd_hui.weekday()

        decalage = (index_cible - index_actuel) % 7

        # "mardi" = prochain mardi à venir.
        # Si aujourd'hui est mardi, on considère aujourd'hui.
        if "prochain" in mots:
            if decalage == 0:
                decalage = 7

        date_cible = aujourd_hui + timedelta(days=decalage)

    debut = datetime.combine(
        date_cible,
        datetime.min.time()
    ).astimezone()

    fin = debut + timedelta(days=1)

    return {
        "date": date_cible.isoformat(),
        "debut_periode": debut.isoformat(timespec="seconds"),
        "fin_periode": fin.isoformat(timespec="seconds"),
    }

def connexion_bdd():
    CHEMIN_BDD.parent.mkdir(parents=True, exist_ok=True)

    connexion = sqlite3.connect(CHEMIN_BDD)
    connexion.row_factory = sqlite3.Row

    return connexion


def initialiser_bdd():
    with connexion_bdd() as connexion:
        connexion.execute(
            """
            CREATE TABLE IF NOT EXISTS evenements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                titre TEXT NOT NULL,
                debut TEXT NOT NULL,
                fin TEXT,
                description TEXT,
                lieu TEXT,
                jour_entier INTEGER NOT NULL DEFAULT 0,
                precision TEXT NOT NULL DEFAULT 'exacte',
                cree_le TEXT NOT NULL
            )
            """
        )


def ajouter_evenement(
    titre: str,
    debut: str,
    fin: str | None = None,
    description: str | None = None,
    lieu: str | None = None,
    jour_entier: bool = False,
    precision: str = "exacte",
):
    debut_dt = valider_date_iso(debut)
    fin_dt = valider_date_iso(fin)
    if fin_dt is not None and fin_dt < debut_dt:
        raise ValueError("La date de fin ne peut pas être avant la date de début.")
    cree_le = datetime.now().isoformat(timespec="seconds")

    with connexion_bdd() as connexion:
        curseur = connexion.execute(
            """
            INSERT INTO evenements (
                titre,
                debut,
                fin,
                description,
                lieu,
                jour_entier,
                precision,
                cree_le
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                titre,
                debut,
                fin,
                description,
                lieu,
                int(jour_entier),
                precision,
                cree_le,
            ),
        )

        return curseur.lastrowid


def lister_evenements(
    debut_periode: str | None = None,
    fin_periode: str | None = None,
):
    requete = """
        SELECT *
        FROM evenements
    """

    parametres = []
    conditions = []

    if debut_periode is not None:
        conditions.append("debut >= ?")
        parametres.append(debut_periode)

    if fin_periode is not None:
        conditions.append("debut < ?")
        parametres.append(fin_periode)

    if conditions:
        requete += " WHERE " + " AND ".join(conditions)

    requete += " ORDER BY debut ASC"

    with connexion_bdd() as connexion:
        lignes = connexion.execute(requete, parametres).fetchall()

    return [dict(ligne) for ligne in lignes]


def supprimer_evenement(id_evenement: int):
    with connexion_bdd() as connexion:
        curseur = connexion.execute(
            """
            DELETE FROM evenements
            WHERE id = ?
            """,
            (id_evenement,),
        )

        return curseur.rowcount > 0

def modifier_evenement(
    id_evenement: int,
    titre: str | None = None,
    debut: str | None = None,
    fin: str | None = None,
    description: str | None = None,
    lieu: str | None = None,
    jour_entier: bool | None = None,
    precision: str | None = None,
):
    evenement = obtenir_evenement(id_evenement)

    if evenement is None:
        return False

    nouveau_debut = debut if debut is not None else evenement["debut"]
    nouvelle_fin = fin if fin is not None else evenement["fin"]

    debut_dt = valider_date_iso(nouveau_debut)
    fin_dt = valider_date_iso(nouvelle_fin)

    if fin_dt is not None and fin_dt < debut_dt:
        raise ValueError(
            "La date de fin ne peut pas être avant la date de début."
        )

    modifications = []
    parametres = []

    if titre is not None:
        modifications.append("titre = ?")
        parametres.append(titre)

    if debut is not None:
        modifications.append("debut = ?")
        parametres.append(debut)

    if fin is not None:
        modifications.append("fin = ?")
        parametres.append(fin)

    if description is not None:
        modifications.append("description = ?")
        parametres.append(description)

    if lieu is not None:
        modifications.append("lieu = ?")
        parametres.append(lieu)

    if jour_entier is not None:
        modifications.append("jour_entier = ?")
        parametres.append(int(jour_entier))

    if precision is not None:
        modifications.append("precision = ?")
        parametres.append(precision)

    if not modifications:
        return False

    parametres.append(id_evenement)

    requete = f"""
        UPDATE evenements
        SET {", ".join(modifications)}
        WHERE id = ?
    """

    with connexion_bdd() as connexion:
        curseur = connexion.execute(requete, parametres)

    return curseur.rowcount > 0

def obtenir_evenement(id_evenement: int):
    with connexion_bdd() as connexion:
        ligne = connexion.execute(
            """
            SELECT *
            FROM evenements
            WHERE id = ?
            """,
            (id_evenement,),
        ).fetchone()

    if ligne is None:
        return None

    return dict(ligne)

def valider_date_iso(date_texte: str | None):
    if date_texte is None:
        return None

    try:
        return datetime.fromisoformat(date_texte)
    except ValueError:
        raise ValueError(
            f"Date invalide : {date_texte}. "
            "Format attendu : YYYY-MM-DDTHH:MM:SS"
        )

def rechercher_evenements(
    recherche: str,
    debut_periode: str | None = None,
    fin_periode: str | None = None,
):
    requete = """
        SELECT *
        FROM evenements
        WHERE (
            LOWER(titre) LIKE ?
            OR LOWER(COALESCE(description, '')) LIKE ?
            OR LOWER(COALESCE(lieu, '')) LIKE ?
        )
    """

    terme = f"%{recherche.lower()}%"
    parametres = [terme, terme, terme]

    if debut_periode is not None:
        requete += " AND debut >= ?"
        parametres.append(debut_periode)

    if fin_periode is not None:
        requete += " AND debut < ?"
        parametres.append(fin_periode)

    requete += " ORDER BY debut ASC"

    with connexion_bdd() as connexion:
        lignes = connexion.execute(
            requete,
            parametres
        ).fetchall()

    return [dict(ligne) for ligne in lignes]


def outil_rechercher_evenements(
    recherche: str,
    debut_periode: str | None = None,
    fin_periode: str | None = None,
):
    """
    Recherche des événements existants dans le calendrier à partir d'un texte.

    À utiliser lorsqu'il faut retrouver un événement existant avant de le
    consulter, le modifier ou le supprimer, notamment lorsque son identifiant
    n'est pas connu.

    La recherche s'effectue dans le titre, la description et le lieu.

    Args:
        recherche:
            Mot ou expression permettant d'identifier l'événement.
            Exemple : "dentiste", "biochimie", "lycée".

        debut_periode:
            Début facultatif de la période de recherche au format ISO 8601.

        fin_periode:
            Fin exclusive facultative de la période de recherche au format ISO 8601.

    Returns:
        Un dictionnaire contenant la liste des événements correspondants.
    """

    return {
        "succes": True,
        "evenements": rechercher_evenements(
            recherche=recherche,
            debut_periode=debut_periode,
            fin_periode=fin_periode,
        ),
    }

initialiser_bdd()

def outil_ajouter_evenement(
    titre: str,
    debut: str,
    fin: str | None = None,
    description: str | None = None,
    lieu: str | None = None,
    jour_entier: bool = False,
    precision: str = "exacte",
):
    """
        Ajoute un nouvel événement au calendrier de l'utilisateur.

        À utiliser uniquement lorsque l'utilisateur demande explicitement
        d'enregistrer, ajouter ou planifier un événement à une date donnée.

        Args:
            titre:
                Nom court et clair de l'événement.

            debut:
                Date et heure de début au format ISO 8601 :
                YYYY-MM-DDTHH:MM:SS.

            fin:
                Date et heure de fin au format ISO 8601.
                Peut être omise si aucune heure de fin n'est connue.

            description:
                Informations complémentaires utiles concernant l'événement.

            lieu:
                Lieu de l'événement si celui-ci est connu.

            jour_entier:
                True uniquement si l'événement concerne toute la journée.

            precision:
                Niveau de précision temporelle.
                Utiliser "exacte" lorsque l'heure est explicitement connue.
                Ne pas inventer une heure absente de la demande.

        Returns:
            Un dictionnaire indiquant si l'événement a été ajouté,
            son identifiant et les informations enregistrées.
        """
    try:
        id_evenement = ajouter_evenement(
            titre=titre,
            debut=debut,
            fin=fin,
            description=description,
            lieu=lieu,
            jour_entier=jour_entier,
            precision=precision,
        )

        return {
            "succes": True,
            "id": id_evenement,
            "evenement": obtenir_evenement(id_evenement),
        }

    except ValueError as erreur:
        return {
            "succes": False,
            "erreur": str(erreur),
        }


def outil_lister_evenements(
    debut_periode: str | None = None,
    fin_periode: str | None = None,
):
    """
       Consulte les événements enregistrés dans le calendrier.

       À utiliser lorsque l'utilisateur demande son emploi du temps,
       ce qu'il a prévu à une date donnée, ou quels événements sont
       présents pendant une période.

       Args:
           debut_periode:
               Début de la période recherchée au format ISO 8601.
               Si omis, aucune limite inférieure n'est appliquée.

           fin_periode:
               Fin exclusive de la période recherchée au format ISO 8601.
               Si omis, aucune limite supérieure n'est appliquée.

       Returns:
           Un dictionnaire contenant la liste des événements correspondants.
       """
    return {
        "succes": True,
        "evenements": lister_evenements(
            debut_periode=debut_periode,
            fin_periode=fin_periode,
        ),
    }


def outil_modifier_evenement(
    id_evenement: int,
    titre: str | None = None,
    debut: str | None = None,
    fin: str | None = None,
    description: str | None = None,
    lieu: str | None = None,
    jour_entier: bool | None = None,
    precision: str | None = None,
):

    """
    Modifie un événement existant du calendrier.

    À utiliser uniquement lorsque l'utilisateur demande explicitement
    de modifier, déplacer ou corriger un événement existant.

    Args:
        id_evenement:
            Identifiant de l'événement à modifier.

        titre:
            Nouveau titre, si celui-ci doit être modifié.

        debut:
            Nouvelle date/heure de début au format ISO 8601.

        fin:
            Nouvelle date/heure de fin au format ISO 8601.

        description:
            Nouvelle description.

        lieu:
            Nouveau lieu.

        jour_entier:
            Nouveau statut d'événement sur toute la journée.

        precision:
            Nouveau niveau de précision temporelle.

    Returns:
        Un dictionnaire indiquant si la modification a réussi
        et contenant l'événement mis à jour.
    """
    try:
        succes = modifier_evenement(
            id_evenement=id_evenement,
            titre=titre,
            debut=debut,
            fin=fin,
            description=description,
            lieu=lieu,
            jour_entier=jour_entier,
            precision=precision,
        )

        if not succes:
            return {
                "succes": False,
                "erreur": f"Événement {id_evenement} introuvable ou aucune modification fournie.",
            }

        return {
            "succes": True,
            "evenement": obtenir_evenement(id_evenement),
        }

    except ValueError as erreur:
        return {
            "succes": False,
            "erreur": str(erreur),
        }


def outil_supprimer_evenement(id_evenement: int):
    """
        Supprime un événement du calendrier.

        À utiliser uniquement lorsque l'utilisateur demande explicitement
        de supprimer ou annuler un événement enregistré.

        Args:
            id_evenement:
                Identifiant de l'événement à supprimer.

        Returns:
            Un dictionnaire indiquant si la suppression a réussi.
        """
    succes = supprimer_evenement(id_evenement)

    if not succes:
        return {
            "succes": False,
            "erreur": f"Événement {id_evenement} introuvable.",
        }

    return {
        "succes": True,
        "id_supprime": id_evenement,
    }

def outil_resoudre_date_relative(expression: str):
    """
    Résout une date relative ou un jour de semaine en une date réelle.

    À utiliser lorsqu'une demande contient une expression temporelle relative
    comme "demain", "mardi prochain", "dans 3 jours" ou "vendredi".

    Cet outil doit être utilisé avant les outils du calendrier lorsque la date
    exacte n'est pas explicitement fournie.

    Args:
        expression:
            Expression temporelle à résoudre.
            Exemple : "mardi prochain".

    Returns:
        Un dictionnaire contenant la date résolue ainsi que le début et la fin
        de la journée correspondante.
    """

    try:
        resultat = resoudre_date_relative(expression)

        return {
            "succes": True,
            **resultat,
        }

    except ValueError as erreur:
        return {
            "succes": False,
            "erreur": str(erreur),
        }


if __name__ == "__main__":
    print(
        outil_ajouter_evenement(
            titre="Rendez-vous dentiste",
            debut="2026-10-06T14:00:00",
            fin="2026-10-06T15:00:00",
            lieu="Dentiste",
        )
    )

    print(
        outil_lister_evenements(
            debut_periode="2026-10-06T00:00:00",
            fin_periode="2026-10-07T00:00:00",
        )
    )