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

PROMPT_ANALYSE_MEMOIRE = """
Tu extrais uniquement les informations DURABLES concernant Jonathan
qui seront réellement utiles dans de futures conversations.

Tu dois être très sélectif.

=== CE QUI DOIT ÊTRE MÉMORISÉ ===

Mémorise principalement :
- préférences durables,
- projets actuels ou futurs importants,
- objectifs,
- informations personnelles durables,
- contraintes importantes,
- contexte de vie susceptible de rester pertinent.

Une information doit pouvoir être utile plusieurs jours, semaines ou mois plus tard.

=== CE QUI NE DOIT PAS ÊTRE MÉMORISÉ ===

Ne mémorise PAS :
- une question posée par Jonathan,
- une demande d'explication,
- le sujet d'une conversation ponctuelle,
- une erreur ou un bug temporaire,
- une réaction émotionnelle momentanée,
- une information générale expliquée par l'assistant,
- une situation ponctuelle sans conséquence future,
- quelque chose que tu déduis sans que Jonathan l'ait réellement affirmé.

Ne transforme jamais le sujet d'une question en information personnelle.

Exemple :

Jonathan :
"Explique-moi les WebSockets simplement."

Résultat :
{"souvenirs":[]}

PAS :
"Jonathan préfère les explications simples des WebSockets."


Jonathan :
"Quelle est la différence entre un thread et une coroutine ?"

Résultat :
{"souvenirs":[]}

Ne mémorise jamais la réponse à cette question.


Jonathan :
"J'ai oublié de sauvegarder mon fichier."

Résultat :
{"souvenirs":[]}

Un événement unique n'est pas une habitude.


Jonathan :
"J'oublie souvent de sauvegarder mes fichiers."

Résultat possible :
{
    "souvenirs":[
        {
            "contenu":"Jonathan a tendance à oublier de sauvegarder ses fichiers.",
            "type":"personnel",
            "importance":"faible"
        }
    ]
}


Jonathan :
"Mon projet principal est de développer Élise, mon IA personnelle.
Je prévois aussi de créer un exosquelette et un lance-toile."

Résultat :
{
    "souvenirs":[
        {
            "contenu":"Le projet principal de Jonathan est de développer Élise, son IA personnelle.",
            "type":"projet",
            "importance":"forte"
        },
        {
            "contenu":"Jonathan prévoit de développer un exosquelette.",
            "type":"projet",
            "importance":"moyenne"
        },
        {
            "contenu":"Jonathan prévoit de développer un lance-toile.",
            "type":"projet",
            "importance":"moyenne"
        }
    ]
}

=== RÈGLES ===

- Un souvenir = une seule information atomique.
- N'invente rien.
- Ne déduis pas une habitude à partir d'un événement unique.
- Ne mémorise pas une connaissance générale.
- Si tu hésites entre mémoriser et ne pas mémoriser, NE MÉMORISE PAS.
- Le contenu doit être compréhensible sans la conversation d'origine.
- Écris les souvenirs en français.

Types autorisés :
- preference
- projet
- personnel
- contexte
- objectif

Importance autorisée :
- faible
- moyenne
- forte
- critique

Réponds uniquement en JSON valide :

{
    "souvenirs": [
        {
            "contenu": "...",
            "type": "...",
            "importance": "..."
        }
    ]
}

Si rien n'est suffisamment durable :

{
    "souvenirs": []
}

Un projet explicitement déclaré par Jonathan doit être mémorisé s'il semble
destiné à durer au-delà de la conversation actuelle.

Ne rejette jamais une information simplement parce qu'elle paraît inhabituelle,
ambitieuse, futuriste ou improbable.

Tu n'as pas à juger si le projet est réaliste.
Tu dois seulement déterminer si Jonathan l'a présenté comme un projet réel.
"""

PROMPT_RELATION_SOUVENIR = """
Tu compares un nouveau souvenir avec plusieurs souvenirs actifs existants.

Pour chaque souvenir existant, indique la relation avec le nouveau souvenir.

Relations autorisées :
- doublon : même information, reformulée différemment.
- contradiction : les deux informations ne peuvent pas être vraies en même temps ou la nouvelle remplace clairement l'ancienne.
- complement : les deux informations concernent le même sujet mais peuvent coexister.
- aucun_conflit : pas de relation suffisamment directe.

Réponds uniquement en JSON valide.

Format :
{
  "relations": [
    {
      "id": 1,
      "relation": "doublon"
    }
  ]
}
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

def analyser_message_pour_memoire(message):
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
        format="json",
        options={
            "temperature": 0
        },
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
        keep_alive = 0,
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

def analyser_relation_souvenir(nouveau_souvenir, candidats):
    donnees = json.dumps(
        {
            "nouveau_souvenir": nouveau_souvenir,
            "souvenirs_existants": [
                {
                    "id": candidat["souvenir"]["id"],
                    "contenu": candidat["souvenir"]["contenu"]
                }
                for candidat in candidats
            ]
        },
        ensure_ascii=False
    )
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
        format="json",
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
    analyse = parser_reponse_memoire(
        reponse.message.content
    )
    print(
        "[RELATION] analyse parsée :",
        analyse,
        flush=True
    )

    if (
        analyse is not None
        and valider_relations_souvenirs(analyse)
    ):
        return analyse
    print("[RELATION] première réponse invalide, retry...", flush=True)

    # Seconde tentative
    reponse_correction = ollama.chat(
        model=MODELE_MEMOIRE,
        messages=[
            {
                "role": "system",
                "content": """
La réponse précédente devait décrire les relations entre souvenirs.

Retourne uniquement un JSON valide sous cette forme :

{
    "relations": [
        {
            "id": 1,
            "relation": "contradiction"
        }
    ]
}

Relations autorisées :
- doublon
- contradiction
- complement
- aucun_conflit

L'id doit être un entier provenant des souvenirs existants.
N'invente aucun souvenir ni aucun id.
"""
            },
            {
                "role": "user",
                "content": (
                    "Données originales :\n"
                    + donnees
                    + "\n\nRéponse invalide :\n"
                    + reponse.message.content
                )
            }
        ],
        keep_alive=0,
    )

    analyse_corrigee = parser_reponse_memoire(
        reponse_correction.message.content
    )

    if (
        analyse_corrigee is not None
        and valider_relations_souvenirs(analyse_corrigee)
    ):
        return analyse_corrigee

    return None


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