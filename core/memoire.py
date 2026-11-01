import sqlite3
from datetime import date
import json
import ollama
import math
import time

CHEMIN_BDD = "data/memoire.db"
TYPES_SOUVENIRS = [
    "preference",
    "projet",
    "personnel",
    "contexte",
    "objectif"
]

MODELE_MEMOIRE = "qwen3:4b"

# nomic-embed-text est petit (~335 Mo) : on le garde chargé pendant une
# conversation pour éviter ~1 s de rechargement à chaque message.
# Ollama le décharge seul après ce délai sans appel.
DUREE_MAINTIEN_EMBEDDING = "5m"

PROMPT_ANALYSE_MEMOIRE = """
Tu lis un message de Jonathan et tu extrais les informations sur lui
qui resteront vraies et utiles dans les jours, semaines ou mois à venir.

=== À RETENIR ===

Dès que Jonathan affirme quelque chose de durable sur lui-même :
- ses proches (famille, couple, amis, animaux) et ce qu'ils font,
- sa santé (allergies, régime, contraintes physiques),
- où il vit, où il va vivre, son travail, ses études,
- ses dates importantes (anniversaire...),
- ses goûts et préférences, y compris sur la façon dont
  l'assistant doit lui répondre,
- ses habitudes, et les CHANGEMENTS d'habitude
  (il a arrêté, il a commencé, il fait désormais...),
- ses projets et objectifs.

Une information future annoncée (déménagement, nouveau travail...)
se retient aussi.

=== À NE PAS RETENIR ===

- une question ou une demande d'explication,
- une commande pour l'assistant (ouvrir une application, ajouter
  un rendez-vous ou une tâche, mettre un minuteur...),
- la politesse et les banalités (salut, merci, la météo),
- un événement unique sans conséquence durable,
- une humeur passagère,
- ce que Jonathan n'a pas réellement affirmé.

=== FORMAT ===

Chaque souvenir :
- contenu : une seule information, en français, compréhensible seule,
  qui commence par « Jonathan » ;
- type : preference, projet, personnel, contexte ou objectif ;
- importance : faible, moyenne, forte ou critique
  (critique = santé ou sécurité, forte = proches, lieu de vie,
  projet principal, préférence de réponse).

Un message peut contenir zéro, un ou plusieurs souvenirs.

=== EXEMPLES ===

Message : « Explique-moi les WebSockets simplement. »
{"souvenirs": []}

Message : « Ajoute dentiste vendredi à 10h dans mon calendrier. »
{"souvenirs": []}

Message : « J'ai oublié de sauvegarder mon fichier. »
{"souvenirs": []}

Message : « J'ai un chat qui s'appelle Pixel. »
{"souvenirs": [
  {"contenu": "Jonathan a un chat nommé Pixel.", "type": "personnel", "importance": "forte"}
]}

Message : « Je suis devenu végétarien, et ne me mets plus d'emojis
dans tes réponses. »
{"souvenirs": [
  {"contenu": "Jonathan est végétarien.", "type": "personnel", "importance": "forte"},
  {"contenu": "Jonathan ne veut pas d'emojis dans les réponses.", "type": "preference", "importance": "forte"}
]}

Message : « Mon projet principal est de développer Élise, mon IA
personnelle. Je prévois aussi de créer un exosquelette. »
{"souvenirs": [
  {"contenu": "Le projet principal de Jonathan est de développer Élise, son IA personnelle.", "type": "projet", "importance": "forte"},
  {"contenu": "Jonathan prévoit de créer un exosquelette.", "type": "projet", "importance": "moyenne"}
]}

Ne juge pas si un projet est réaliste : s'il est présenté comme réel,
retiens-le.
"""

PROMPT_RELATION_SOUVENIR = """
Tu compares un NOUVEAU souvenir avec des souvenirs EXISTANTS numérotés
[1], [2], etc.

Pour chaque souvenir existant, choisis UNE relation :
- doublon : TOUT ce que dit le nouveau souvenir est déjà dit dans
  l'ancien, même avec d'autres mots (synonymes, ordre différent).
  Si le nouveau ajoute un détail absent de l'ancien (un outil,
  un lieu, une date, une précision), ce n'est PAS un doublon.
- contradiction : les deux ne peuvent pas être vrais en même temps,
  ou le nouveau remplace clairement l'ancien.
- complement : même sujet, les deux peuvent être vrais ensemble,
  et l'un apporte une information que l'autre n'a pas.
- aucun_conflit : pas de lien direct.

Règles :
- Pour chaque identifiant, écris d'abord une raison courte
  (une phrase), puis la relation.
- Si deux souvenirs donnent des valeurs différentes à une chose
  unique (le projet principal, la ville où il habite...),
  c'est une contradiction.
- Si le nouveau souvenir change le statut d'une information
  (envisagé → réel, secondaire → principal, ancien → actuel),
  ce n'est PAS un doublon.
- Ne recopie pas les souvenirs.

Exemple :

Nouveau souvenir :
« Jonathan a un chien qui s'appelle Rex. »

Souvenirs existants :
[7] Le chien de Jonathan se nomme Rex.
[8] Jonathan n'a aucun animal de compagnie.
[9] Le chien de Jonathan est un berger allemand.
[10] Jonathan joue aux échecs.

Réponse :
{"relations": {
  "7": {"raison": "Même chien, même nom, simplement reformulé.", "relation": "doublon"},
  "8": {"raison": "Il ne peut pas avoir un chien et aucun animal.", "relation": "contradiction"},
  "9": {"raison": "Même chien, la race est une information en plus.", "relation": "complement"},
  "10": {"raison": "Les échecs n'ont aucun rapport avec le chien.", "relation": "aucun_conflit"}
}}
"""

PROMPT_CORRECTION_MEMOIRE = """
La réponse suivante devait respecter exactement le format de mémoire demandé.

Corrige la réponse afin qu'elle respecte toutes ces règles :

- Retourne uniquement un JSON valide.
- La racine doit contenir la clé "souvenirs".
- "souvenirs" doit être une liste.
- Chaque souvenir doit avoir exactement :
  - "contenu" : chaîne non vide
  - "type" : preference, projet, personnel, contexte ou objectif
  - "importance" : faible, moyenne, forte ou critique
- L'importance ne doit jamais être un nombre.
- N'invente aucune nouvelle information.
- Conserve le sens du contenu original.
- Retourne uniquement le JSON corrigé.
"""

RELATIONS_SOUVENIRS = {
    "doublon",
    "contradiction",
    "complement",
    "aucun_conflit"
}

SEUIL_PERTINENCE = 0.40
SEUIL_CONFLIT = 0.55

NIVEAUX_IMPORTANCE = {
    "faible": 3,
    "moyenne": 5,
    "forte": 8,
    "critique": 10
}

def initialiser_memoire():
    connexion = sqlite3.connect(CHEMIN_BDD)
    curseur = connexion.cursor()
    curseur.execute(
        """
        CREATE TABLE IF NOT EXISTS souvenirs(
                                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                contenu TEXT NOT NULL,
                                                type TEXT NOT NULL,
                                                importance INT NOT NULL,
                                                date_ajout TEXT NOT NULL, 
                                                date_modification TEXT NOT NULL,
                                                actif INT NOT NULL,
                                                source TEXT NOT NULL,
                                                embedding TEXT NOT NULL
        )
        """
    )
    curseur.execute(
        """
        CREATE TABLE IF NOT EXISTS modifications_memoire_en_attente (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nouveau_souvenir TEXT NOT NULL,
            anciens_ids TEXT NOT NULL,
            date_creation TEXT NOT NULL
        )
        """
    )
    connexion.commit()
    connexion.close()

def trouver_candidats_conflit(nouveau_souvenir):
    nouveau_embedding = generer_embedding_souvenir(
        nouveau_souvenir["contenu"]
    )

    candidats = []

    for souvenir in lister_souvenirs_actifs():

        if souvenir["type"] != nouveau_souvenir["type"]:
            continue

        embedding_souvenir = json.loads(
            souvenir["embedding"]
        )

        score = similarite_cosinus(
            embedding_souvenir,
            nouveau_embedding
        )

        if score >= SEUIL_CONFLIT:
            candidats.append({
                "souvenir": souvenir,
                "score": score
            })

    candidats.sort(
        key=lambda candidat: candidat["score"],
        reverse=True
    )

    return candidats[:10]

def ajouter_souvenir(contenu:str, type_souvenir:str, importance:int, source:str):
    if souvenir_existe_deja(contenu):
        return False
    if type_souvenir not in TYPES_SOUVENIRS:
        raise ValueError(
            f"Type de souvenir invalide : {type_souvenir}"
        )

    if not 1 <= importance <= 10:
        raise ValueError(
            "L'importance doit être comprise entre 1 et 10."
        )
    embedding = generer_embedding_souvenir(contenu)
    embedding_json = json.dumps(embedding)
    date_du_jour = date.today().isoformat()
    connexion = sqlite3.connect(CHEMIN_BDD)
    curseur = connexion.cursor()
    curseur.execute(
        """
        INSERT INTO souvenirs(contenu,
                              type,
                              importance,
                              date_ajout,
                              date_modification,
                              actif,
                              source,
                              embedding)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            contenu,
            type_souvenir,
            importance,
            date_du_jour,
            date_du_jour,
            1,
            source,
            embedding_json
        )
    )
    connexion.commit()
    connexion.close()
    return True

def lister_souvenirs_actifs():
    connexion = sqlite3.connect(CHEMIN_BDD)
    connexion.row_factory= sqlite3.Row
    curseur = connexion.cursor()

    curseur.execute(
        """
        SELECT *
        FROM souvenirs
        WHERE actif = 1
        """
    )

    souvenirs = curseur.fetchall()

    connexion.close()

    return souvenirs

def parser_reponse_memoire(contenu: str):
    try:
        return json.loads(contenu)

    except json.JSONDecodeError:
        return None

def construire_schema_analyse_memoire():
    """Schéma JSON imposé à Ollama pour l'extraction des souvenirs."""
    return {
        "type": "object",
        "properties": {
            "souvenirs": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "contenu": {"type": "string", "maxLength": 300},
                        "type": {
                            "type": "string",
                            "enum": list(TYPES_SOUVENIRS)
                        },
                        "importance": {
                            "type": "string",
                            "enum": list(NIVEAUX_IMPORTANCE)
                        }
                    },
                    "required": ["contenu", "type", "importance"]
                }
            }
        },
        "required": ["souvenirs"]
    }


def analyser_message_pour_memoire(message):
    schema = construire_schema_analyse_memoire()

    reponse = ollama.chat(
        model=MODELE_MEMOIRE,
        messages=[
            {
                "role": "system",
                "content": PROMPT_ANALYSE_MEMOIRE
            },
            {
                "role": "user",
                "content": message
            }
        ],
        format=schema,
        options={
            "temperature": 0
        },
        think=False,
        keep_alive = 0,
    )
    contenu = reponse.message.content
    print(
        "[MEMOIRE] Analyse brute :",
        contenu,
        flush=True
    )

    analyse = parser_reponse_memoire(contenu)

    print(
        "[MEMOIRE] Analyse parsée :",
        analyse,
        flush=True
    )
    if analyse is not None and valider_analyse_memoire(analyse):
        for souvenir in analyse["souvenirs"]:
            souvenir["importance"] = convertir_importance(
                souvenir["importance"]
            )

        return analyse

    reponse_correction = ollama.chat(
        model=MODELE_MEMOIRE,
        messages=[
            {
                "role": "system",
                "content": PROMPT_CORRECTION_MEMOIRE
            },
            {
                "role": "user",
                "content": contenu
            }
        ],
        format=schema,
        options={
            "temperature": 0
        },
        think=False,
        keep_alive=0,
    )

    analyse_corrigee = parser_reponse_memoire(
        reponse_correction.message.content
    )

    if (
            analyse_corrigee is not None
            and valider_analyse_memoire(analyse_corrigee)
    ):
        for souvenir in analyse_corrigee["souvenirs"]:
            souvenir["importance"] = convertir_importance(
                souvenir["importance"]
            )

        return analyse_corrigee

    print(
        "[MEMOIRE] Analyse invalide après seconde tentative :",
        reponse_correction.message.content
    )

    return {
        "souvenirs": []
    }

def convertir_importance(importance: str) -> int:
    if importance not in NIVEAUX_IMPORTANCE:
        raise ValueError(
            f"Niveau d'importance invalide : {importance}"
        )

    return NIVEAUX_IMPORTANCE[importance]

def valider_analyse_memoire(analyse):
    if not isinstance(analyse, dict):
        return False

    if "souvenirs" not in analyse:
        return False

    souvenirs = analyse["souvenirs"]

    if not isinstance(souvenirs, list):
        return False

    for souvenir in souvenirs:
        if not isinstance(souvenir, dict):
            return False

        if "contenu" not in souvenir:
            return False

        if "type" not in souvenir:
            return False

        if "importance" not in souvenir:
            return False

        if not isinstance(souvenir["contenu"], str):
            return False

        if not souvenir["contenu"].strip():
            return False

        if not isinstance(souvenir["type"], str):
            return False

        if souvenir["type"] not in TYPES_SOUVENIRS:
            return False

        if not isinstance(souvenir["importance"], str):
            return False

        if souvenir["importance"] not in NIVEAUX_IMPORTANCE:
            return False

    return True


def normaliser_contenu(contenu: str) -> str:
    return " ".join(
        contenu
        .strip()
        .lower()
        .split()
    )


def souvenir_existe_deja(contenu: str) -> bool:
    connexion = sqlite3.connect(CHEMIN_BDD)
    connexion.row_factory = sqlite3.Row
    curseur = connexion.cursor()

    curseur.execute(
        """
        SELECT contenu
        FROM souvenirs
        WHERE actif = 1
        """
    )

    souvenirs = curseur.fetchall()
    connexion.close()

    contenu_normalise = normaliser_contenu(contenu)

    for souvenir in souvenirs:
        if normaliser_contenu(souvenir["contenu"]) == contenu_normalise:
            return True

    return False


def generer_embedding(texte: str):
    reponse = ollama.embeddings(
        model="nomic-embed-text",
        prompt=texte,
        keep_alive=DUREE_MAINTIEN_EMBEDDING,
    )

    return reponse["embedding"]

def generer_embedding_souvenir(texte: str):
    return generer_embedding(
        f"search_document: {texte}"
    )


def generer_embedding_requete(texte: str):
    return generer_embedding(
        f"search_query: {texte}"
    )

def similarite_cosinus(a, b):
    produit_scalaire = sum(x * y for x, y in zip(a, b))

    norme_a = math.sqrt(sum(x * x for x in a))
    norme_b = math.sqrt(sum(y * y for y in b))

    return produit_scalaire / (norme_a * norme_b)


def trouver_souvenirs_similaires(nouveau_contenu):
    nouveau_embedding = generer_embedding_requete(
        nouveau_contenu
    )
    souvenirs = lister_souvenirs_actifs()

    candidats = []

    for souvenir in souvenirs:
        embedding_souvenir = json.loads(
            souvenir["embedding"]
        )

        score = similarite_cosinus(
            embedding_souvenir,
            nouveau_embedding
        )

        candidats.append({
            "souvenir": souvenir,
            "score": score
        })

    candidats.sort(
        key=lambda candidat: candidat["score"],
        reverse=True
    )

    return [
        candidat
        for candidat in candidats[:5]
        if candidat["score"] >= SEUIL_PERTINENCE
    ]

def formater_donnees_relation(nouveau_souvenir, candidats):
    """
    Présente les souvenirs en texte numéroté plutôt qu'en JSON :
    avec une entrée JSON, qwen3:4b avait tendance à la recopier
    au lieu de répondre.
    """
    lignes = [
        "Nouveau souvenir :",
        f"« {nouveau_souvenir['contenu']} »",
        "",
        "Souvenirs existants :",
    ]

    for candidat in candidats:
        lignes.append(
            f"[{candidat['souvenir']['id']}] {candidat['souvenir']['contenu']}"
        )

    return "\n".join(lignes)


def construire_schema_relations(candidats):
    """
    Schéma JSON imposé à Ollama : une clé obligatoire par candidat
    (impossible d'en oublier ou d'en répéter un), chacune avec une
    raison courte écrite AVANT la relation, qui doit être autorisée.
    """
    ids = [str(candidat["souvenir"]["id"]) for candidat in candidats]

    schema_relation = {
        "type": "object",
        "properties": {
            "raison": {
                "type": "string",
                "maxLength": 200
            },
            "relation": {
                "type": "string",
                "enum": sorted(RELATIONS_SOUVENIRS)
            }
        },
        "required": ["raison", "relation"]
    }

    return {
        "type": "object",
        "properties": {
            "relations": {
                "type": "object",
                "properties": {
                    identifiant: schema_relation
                    for identifiant in ids
                },
                "required": ids
            }
        },
        "required": ["relations"]
    }


def convertir_reponse_relations(contenu, candidats):
    """
    Convertit la réponse {"relations": {"1": {"raison", "relation"}}}
    au format attendu par traiter_nouveau_souvenir :
    {"relations": [{"id": 1, "relation": "..."}]}.
    Retourne None si la réponse est inutilisable.
    """
    donnees = parser_reponse_memoire(contenu)

    if not isinstance(donnees, dict):
        return None

    relations = donnees.get("relations")

    if not isinstance(relations, dict):
        return None

    resultat = []

    for candidat in candidats:
        identifiant = candidat["souvenir"]["id"]
        element = relations.get(str(identifiant))

        if not isinstance(element, dict):
            return None

        print(
            f"[RELATION] [{identifiant}] {element.get('relation')} "
            f"— {element.get('raison')}",
            flush=True
        )

        resultat.append({
            "id": identifiant,
            "relation": element.get("relation")
        })

    analyse = {"relations": resultat}

    if not valider_relations_souvenirs(analyse):
        return None

    return analyse


def analyser_relation_souvenir(nouveau_souvenir, candidats):
    donnees = formater_donnees_relation(nouveau_souvenir, candidats)
    schema = construire_schema_relations(candidats)
    print("[RELATION] appel Qwen 1...", flush=True)
    debut = time.perf_counter()

    # Première tentative
    reponse = ollama.chat(
        model=MODELE_MEMOIRE,
        messages=[
            {
                "role": "system",
                "content": PROMPT_RELATION_SOUVENIR
            },
            {
                "role": "user",
                "content": donnees
            }
        ],
        format=schema,
        options={
            "temperature": 0
        },
        think=False,
        keep_alive=0,

    )
    print(
        f"[RELATION] Qwen 1 terminé en "
        f"{time.perf_counter() - debut:.2f}s",
        flush=True
    )
    print(
        "[RELATION] réponse brute :",
        reponse.message.content,
        flush=True
    )
    analyse = convertir_reponse_relations(
        reponse.message.content,
        candidats
    )
    print(
        "[RELATION] analyse convertie :",
        analyse,
        flush=True
    )

    if analyse is not None:
        return analyse
    print("[RELATION] première réponse invalide, retry...", flush=True)

    # Seconde tentative : mêmes réglages que la première
    # (sans think=False, Qwen3 réfléchissait jusqu'à ~30 s ici).
    reponse_correction = ollama.chat(
        model=MODELE_MEMOIRE,
        messages=[
            {
                "role": "system",
                "content": PROMPT_RELATION_SOUVENIR
            },
            {
                "role": "user",
                "content": (
                    donnees
                    + "\n\nTa réponse précédente était invalide. "
                    "Pour chaque identifiant entre crochets, donne une "
                    "raison courte puis une relation."
                )
            }
        ],
        format=schema,
        options={
            "temperature": 0
        },
        think=False,
        keep_alive=0,
    )

    return convertir_reponse_relations(
        reponse_correction.message.content,
        candidats
    )


def valider_relations_souvenirs(analyse):
    if not isinstance(analyse, dict):
        return False

    if "relations" not in analyse:
        return False

    relations = analyse["relations"]

    if not isinstance(relations, list):
        return False

    for relation in relations:
        if not isinstance(relation, dict):
            return False

        if "id" not in relation:
            return False

        if "relation" not in relation:
            return False

        if not isinstance(relation["id"], int):
            return False

        if not isinstance(relation["relation"], str):
            return False

        if relation["relation"] not in RELATIONS_SOUVENIRS:
            return False

    return True

def traiter_nouveau_souvenir(nouveau_souvenir):
    contenu = nouveau_souvenir["contenu"]
    type_souvenir = nouveau_souvenir["type"]
    importance = nouveau_souvenir["importance"]

    print(
        "[MEMOIRE] Nouveau souvenir :",
        nouveau_souvenir
    )

    candidats = trouver_candidats_conflit(
        nouveau_souvenir
    )

    print(
        "[MEMOIRE] Candidats conflit :",
        [
            (
                candidat["souvenir"]["contenu"],
                round(candidat["score"], 3)
            )
            for candidat in candidats
        ]
    )

    if not candidats:
        return ajouter_souvenir(
            contenu,
            type_souvenir,
            importance,
            "utilisateur"
        )

    analyse = analyser_relation_souvenir(
        nouveau_souvenir,
        candidats
    )

    if analyse is None:
        print("[MEMOIRE] Impossible d'analyser les relations.")
        return False

    relations = analyse["relations"]

    # 1. Si un doublon existe, inutile d'aller plus loin.
    for relation in relations:
        if relation["relation"] == "doublon":
            return False

    # 2. Récupération de toutes les contradictions.
    contradictions = []

    for relation in relations:
        if relation["relation"] != "contradiction":
            continue

        ancien_souvenir = next(
            (
                candidat["souvenir"]
                for candidat in candidats
                if candidat["souvenir"]["id"] == relation["id"]
            ),
            None
        )

        if ancien_souvenir is not None:
            contradictions.append(ancien_souvenir)

    # 3. Pas de contradiction :
    # complément / aucun_conflit => on peut ajouter.
    if not contradictions:
        return ajouter_souvenir(
            contenu,
            type_souvenir,
            importance,
            "utilisateur"
        )

    # 4. Une contradiction importante suffit
    # à demander confirmation avant toute modification.

    confirmation_requise = (
        any(
            souvenir["importance"] >= 8
            for souvenir in contradictions
        )
    )

    if confirmation_requise:
        id_modification = enregistrer_modification_en_attente(
            nouveau_souvenir,
            contradictions
        )

        return {
            "statut": "confirmation_requise",
            "id_modification": id_modification,
            "anciens_souvenirs": [
                dict(souvenir)
                for souvenir in contradictions
            ],
            "nouveau_souvenir": nouveau_souvenir
        }

    # 5. Sinon, on désactive tous les souvenirs remplacés.
    for souvenir in contradictions:
        desactiver_souvenir(
            souvenir["id"]
        )

    return ajouter_souvenir(
        contenu,
        type_souvenir,
        importance,
        "utilisateur"
    )


def desactiver_souvenir(id_souvenir: int):
    connexion = sqlite3.connect(CHEMIN_BDD)
    curseur = connexion.cursor()

    curseur.execute(
        """
        UPDATE souvenirs
        SET actif = 0,
            date_modification = ?
        WHERE id = ?
        """,
        (
            date.today().isoformat(),
            id_souvenir
        )
    )

    connexion.commit()
    connexion.close()

def enregistrer_modification_en_attente(
    nouveau_souvenir: dict,
    anciens_souvenirs
):
    date_creation = date.today().isoformat()

    anciens_ids = [
        souvenir["id"]
        for souvenir in anciens_souvenirs
    ]

    connexion = sqlite3.connect(CHEMIN_BDD)
    curseur = connexion.cursor()

    curseur.execute(
        """
        INSERT INTO modifications_memoire_en_attente(
            nouveau_souvenir,
            anciens_ids,
            date_creation
        )
        VALUES (?, ?, ?)
        """,
        (
            json.dumps(
                nouveau_souvenir,
                ensure_ascii=False
            ),
            json.dumps(anciens_ids),
            date_creation
        )
    )

    id_modification = curseur.lastrowid

    connexion.commit()
    connexion.close()

    return id_modification

def appliquer_modification_en_attente(
    id_modification: int
):
    connexion = sqlite3.connect(CHEMIN_BDD)
    connexion.row_factory = sqlite3.Row
    curseur = connexion.cursor()

    curseur.execute(
        """
        SELECT *
        FROM modifications_memoire_en_attente
        WHERE id = ?
        """,
        (id_modification,)
    )

    modification = curseur.fetchone()

    if modification is None:
        connexion.close()
        return False

    nouveau_souvenir = json.loads(
        modification["nouveau_souvenir"]
    )

    anciens_ids = json.loads(
        modification["anciens_ids"]
    )

    connexion.close()

    for id_souvenir in anciens_ids:
        desactiver_souvenir(id_souvenir)

    ajouter_souvenir(
        nouveau_souvenir["contenu"],
        nouveau_souvenir["type"],
        nouveau_souvenir["importance"],
        "utilisateur"
    )

    annuler_modification_en_attente(
        id_modification
    )

    return True


def annuler_modification_en_attente(
    id_modification: int
):
    connexion = sqlite3.connect(CHEMIN_BDD)
    curseur = connexion.cursor()

    curseur.execute(
        """
        DELETE FROM modifications_memoire_en_attente
        WHERE id = ?
        """,
        (id_modification,)
    )

    connexion.commit()
    connexion.close()

    return curseur.rowcount > 0

def recuperer_derniere_modification_en_attente():
    connexion = sqlite3.connect(CHEMIN_BDD)
    connexion.row_factory = sqlite3.Row
    curseur = connexion.cursor()

    curseur.execute(
        """
        SELECT *
        FROM modifications_memoire_en_attente
        ORDER BY id DESC
        LIMIT 1
        """
    )

    modification = curseur.fetchone()

    connexion.close()

    if modification is None:
        return None

    return dict(modification)

def lister_tous_souvenirs():
    connexion = sqlite3.connect(CHEMIN_BDD)
    connexion.row_factory = sqlite3.Row
    curseur = connexion.cursor()

    curseur.execute(
        """
        SELECT id, contenu, importance, actif, date_modification
        FROM souvenirs
        ORDER BY id
        """
    )

    souvenirs = curseur.fetchall()
    connexion.close()

    return souvenirs

if __name__ == "__main__":
    souvenirs = lister_tous_souvenirs()

    print("=== SOUVENIRS ===")
    for souvenir in souvenirs:
        print(dict(souvenir))

    print("\n=== MODIFICATION EN ATTENTE ===")
    print(
        recuperer_derniere_modification_en_attente()
    )