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
NOMBRES_TEXTE = {
    "un": 1,
    "une": 1,
    "deux": 2,
    "trois": 3,
    "quatre": 4,
    "cinq": 5,
    "six": 6,
    "sept": 7,
    "huit": 8,
    "neuf": 9,
    "dix": 10,
    "quinze": 15,
}


def lire_nombre(mot: str, expression: str):
    if mot.isdigit():
        return int(mot)

    if mot in NOMBRES_TEXTE:
        return NOMBRES_TEXTE[mot]

    raise ValueError(f"Expression temporelle invalide : {expression}")


def premier_jour_semaine(mots):
    """Renvoie l'index (lundi = 0) du premier jour de semaine cité, ou None."""
    for mot in mots:
        if mot in JOURS_INDEX:
            return JOURS_INDEX[mot]

    return None


def resoudre_date_relative(expression: str):
    """
    Résout une expression temporelle simple en une période ISO.

    Exemples supportés :
    - aujourd'hui, demain, après-demain
    - lundi, mardi, mercredi...
    - lundi prochain, mardi prochain...
    - dans 1 jour, dans 3 jours, dans deux jours
    - dans une semaine, dans 2 semaines
    - cette semaine (du lundi au dimanche de la semaine en cours)
    - semaine prochaine, la semaine prochaine (semaine entière)
    - mardi de la semaine prochaine, mardi semaine prochaine

    Returns:
        Un dictionnaire avec :
        - date : premier jour de la période
        - debut_periode
        - fin_periode (exclusive)
    """

    aujourd_hui = datetime.now().date()
    lundi_courant = aujourd_hui - timedelta(days=aujourd_hui.weekday())

    expression = expression.strip().lower().replace("’", "'")
    mots = expression.split()
    nombre_jours_periode = 1

    if expression in {"aujourd'hui", "aujourdhui"}:
        date_cible = aujourd_hui

    elif expression == "demain":
        date_cible = aujourd_hui + timedelta(days=1)

    elif expression in {"après-demain", "apres-demain"}:
        date_cible = aujourd_hui + timedelta(days=2)

    elif (
        len(mots) == 3
        and mots[0] == "dans"
        and mots[2] in {"jour", "jours", "semaine", "semaines"}
    ):
        nombre = lire_nombre(mots[1], expression)

        if mots[2].startswith("semaine"):
            nombre *= 7

        date_cible = aujourd_hui + timedelta(days=nombre)

    elif expression == "cette semaine":
        date_cible = lundi_courant
        nombre_jours_periode = 7

    elif "semaine prochaine" in expression:
        lundi_prochain = lundi_courant + timedelta(days=7)
        index_jour = premier_jour_semaine(mots)

        if index_jour is None:
            date_cible = lundi_prochain
            nombre_jours_periode = 7
        else:
            date_cible = lundi_prochain + timedelta(days=index_jour)

    else:
        index_cible = premier_jour_semaine(mots)

        if index_cible is None:
            raise ValueError(
                f"Expression temporelle non reconnue : {expression}"
            )

        decalage = (index_cible - aujourd_hui.weekday()) % 7

        # "mardi" = prochain mardi à venir.
        # Si aujourd'hui est mardi, on considère aujourd'hui.
        if "prochain" in mots or "prochaine" in mots:
            if decalage == 0:
                decalage = 7

        date_cible = aujourd_hui + timedelta(days=decalage)

    # Bornes en heure locale sans fuseau, même format que la base.
    debut = datetime.combine(
        date_cible,
        datetime.min.time()
    )

    fin = debut + timedelta(days=nombre_jours_periode)

    return {
        "date": date_cible.isoformat(),
        "debut_periode": debut.isoformat(timespec="seconds"),
        "fin_periode": fin.isoformat(timespec="seconds"),
    }

# Fonctions appelées après chaque ajout, modification ou suppression
# (ex. l'interface web qui prévient les clients). Le module ne dépend
# ainsi d'aucune interface.
abonnes_modifications = []


def abonner_modifications(callback):
    """callback(action, id_evenement) avec action = ajout | modification | suppression."""
    abonnes_modifications.append(callback)


def notifier_modification(action: str, id_evenement: int):
    for callback in list(abonnes_modifications):
        try:
            callback(action, id_evenement)
        except Exception as erreur:
            # Une interface en erreur ne doit pas faire échouer l'écriture.
            print(
                "[CALENDRIER] erreur abonné :",
                repr(erreur),
                flush=True
            )


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

        migrer_dates_vers_format_local(connexion)


def migrer_dates_vers_format_local(connexion):
    """
    Convertit les dates déjà enregistrées avec fuseau (ex. +02:00)
    en heure locale sans fuseau. Ne touche pas aux lignes déjà normalisées.
    """
    lignes = connexion.execute(
        "SELECT id, debut, fin FROM evenements"
    ).fetchall()

    for ligne in lignes:
        try:
            nouveau_debut = normaliser_date(ligne["debut"])
            nouvelle_fin = normaliser_date(ligne["fin"])
        except ValueError:
            print(
                f"[CALENDRIER] date illisible, événement {ligne['id']} ignoré",
                flush=True
            )
            continue

        if nouveau_debut != ligne["debut"] or nouvelle_fin != ligne["fin"]:
            connexion.execute(
                "UPDATE evenements SET debut = ?, fin = ? WHERE id = ?",
                (nouveau_debut, nouvelle_fin, ligne["id"]),
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
    debut = normaliser_date(debut)
    fin = normaliser_date(fin)
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

    # Notification après la sortie du with : la ligne est alors commitée.
    notifier_modification("ajout", curseur.lastrowid)

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

    debut_periode = normaliser_date(debut_periode)
    fin_periode = normaliser_date(fin_periode)

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

    succes = curseur.rowcount > 0

    if succes:
        notifier_modification("suppression", id_evenement)

    return succes

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

    debut = normaliser_date(debut)
    fin = normaliser_date(fin)

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

    succes = curseur.rowcount > 0

    if succes:
        notifier_modification("modification", id_evenement)

    return succes

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


def normaliser_date(date_texte: str | None):
    """
    Ramène une date ISO à un format unique : heure locale, sans fuseau,
    YYYY-MM-DDTHH:MM:SS. Une date avec fuseau (+02:00, Z...) est convertie
    en heure locale. Ce format fixe rend la comparaison texte de SQLite fiable.
    """
    date_dt = valider_date_iso(date_texte)

    if date_dt is None:
        return None

    if date_dt.tzinfo is not None:
        date_dt = date_dt.astimezone().replace(tzinfo=None)

    return date_dt.isoformat(timespec="seconds")

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

    debut_periode = normaliser_date(debut_periode)
    fin_periode = normaliser_date(fin_periode)

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
    comme "demain", "mardi prochain", "dans 3 jours", "dans une semaine",
    "cette semaine", "la semaine prochaine" ou "vendredi".

    Cet outil doit être utilisé avant les outils du calendrier lorsque la date
    exacte n'est pas explicitement fournie.

    Args:
        expression:
            Expression temporelle seule, sans l'heure.
            Exemples : "mardi prochain", "dans 2 jours", "semaine prochaine",
            "jeudi de la semaine prochaine".

    Returns:
        Un dictionnaire contenant la date résolue ainsi que debut_periode et
        fin_periode (exclusive). Pour une journée, la période couvre ce jour ;
        pour "cette semaine" ou "semaine prochaine", elle couvre la semaine
        entière du lundi au dimanche.
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