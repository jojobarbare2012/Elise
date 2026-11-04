"""
Tests de la mémoire d'Élise. Données fictives, base temporaire : la vraie
data/memoire.db n'est jamais ouverte.

Depuis la racine du projet, avec .venv :
    python -m unittest tests.test_memoire

Sans Ollama par défaut (embeddings et LLM simulés). Pour ajouter les
vérifications avec les vrais modèles (bge-m3 et qwen3:4b, environ 1 minute) :
    ELISE_TESTS_OLLAMA=1 python -m unittest tests.test_memoire
"""
import os
import shutil
import sqlite3
import tempfile
import threading
import time
import types
import unittest
import zlib
from datetime import datetime, timedelta
from unittest import mock

from core import elise, memoire
from modules import memoire as outils
from services.ollama import TAILLE_CONTEXTE


def faux_embedding(texte):
    """Vecteur de mots stable : deux phrases proches restent proches."""
    vecteur = [0.0] * 64

    for mot in texte.lower().split():
        vecteur[zlib.crc32(mot.encode("utf-8")) % 64] += 1.0

    return vecteur


class BaseTemporaire(unittest.TestCase):
    """Chaque test a sa propre base, jamais data/memoire.db."""

    embeddings_simules = True

    def setUp(self):
        self.dossier = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dossier, ignore_errors=True)
        self.base = os.path.join(self.dossier, "memoire.db")

        self.simuler(memoire, "CHEMIN_BDD", self.base)

        if self.embeddings_simules:
            self.simuler(memoire, "generer_embedding", faux_embedding)

        memoire.initialiser_memoire()

    def simuler(self, cible, nom, valeur):
        remplacement = mock.patch.object(cible, nom, valeur)
        remplacement.start()
        self.addCleanup(remplacement.stop)

    def requete(self, sql, *parametres):
        connexion = sqlite3.connect(self.base)
        lignes = connexion.execute(sql, parametres).fetchall()
        connexion.commit()
        connexion.close()
        return lignes

    def ajouter(self, contenu, type_souvenir="personnel", importance=5):
        self.assertTrue(
            memoire.ajouter_souvenir(contenu, type_souvenir, importance, "test")
        )


class FauxMorceau:
    def __init__(self, contenu, appels_outils=None):
        self.message = types.SimpleNamespace(
            content=contenu,
            tool_calls=appels_outils
        )
        self.done = True


class AvecElise(BaseTemporaire):
    """Élise réelle, Ollama simulé : réponses données par self.reponses."""

    def setUp(self):
        super().setUp()
        self.reponses = []
        self.appels = []

        def faux_chat(**arguments):
            self.appels.append(arguments)
            return iter([self.reponses.pop(0)])

        self.simuler(elise.ollama, "chat", faux_chat)
        self.elise = elise.Elise("fictif", [])
        self.simuler(
            self.elise,
            "_lancer_memorisation_background",
            lambda *arguments: None
        )

    def reponse(self, texte):
        self.reponses.append(FauxMorceau(texte))


class TestJournal(AvecElise):
    def test_enregistre_les_deux_roles_et_la_source(self):
        self.reponse("Salut.")
        self.elise.repondre("bonjour", source="vocal")

        self.assertEqual(
            self.requete("SELECT role, contenu, source FROM echanges ORDER BY id"),
            [("user", "bonjour", "vocal"), ("assistant", "Salut.", "vocal")]
        )

    def test_une_panne_ne_bloque_pas_la_reponse(self):
        def panne(*arguments):
            raise sqlite3.OperationalError("base verrouillée")

        self.simuler(elise, "enregistrer_echange", panne)
        self.reponse("Salut.")

        self.assertEqual(self.elise.repondre("bonjour"), "Salut.")

    def test_recherche_sans_accents_et_sans_le_message_en_cours(self):
        memoire.enregistrer_echange("user", "Mon déménagement me stresse.", "web")
        memoire.enregistrer_echange("user", "déménagement en cours", "web")

        trouves = memoire.rechercher_echanges("demenagement")

        self.assertEqual(
            [echange["contenu"] for echange in trouves],
            ["Mon déménagement me stresse."]
        )

    def test_recherche_par_periode(self):
        for date, contenu in (
                ("2026-01-02T09:00:00", "janvier"),
                ("2026-03-02T09:00:00", "mars"),
                ("2026-05-02T09:00:00", "message en cours"),
        ):
            self.requete(
                "INSERT INTO echanges(date, role, contenu, source) "
                "VALUES (?, 'user', ?, 'web')",
                date,
                contenu
            )

        trouves = memoire.rechercher_echanges("", "2026-03-01", "2026-04-01")

        self.assertEqual([echange["contenu"] for echange in trouves], ["mars"])

    def test_caracteres_speciaux_sans_erreur(self):
        memoire.enregistrer_echange("user", "bonjour", "web")
        memoire.enregistrer_echange("user", "suite", "web")

        self.assertEqual(memoire.rechercher_echanges('a"b (* OR NEAR'), [])


class TestExtraction(AvecElise):
    def test_replique_d_elise_transmise_a_l_extraction(self):
        message = memoire.formater_message_analyse(
            "Léa.",
            "Elle s'appelle comment, ta copine ?"
        )

        self.assertIn("Élise a dit : « Elle s'appelle comment", message)
        self.assertIn("Message : « Léa. »", message)

    def test_sans_replique(self):
        self.assertEqual(
            memoire.formater_message_analyse("Léa."),
            "Message : « Léa. »"
        )

    def test_derniere_replique_lue_avant_le_message(self):
        self.reponse("Tu as des frères et sœurs ?")
        self.elise.repondre("salut")

        captures = []
        self.simuler(
            self.elise,
            "_lancer_memorisation_background",
            lambda *arguments: captures.append(arguments)
        )
        self.reponse("Noté.")
        self.elise.repondre("Oui, deux sœurs.")

        self.assertEqual(captures[0][2], "Tu as des frères et sœurs ?")


class TestSocle(AvecElise):
    def test_preferences_fortes_et_infos_critiques_seulement(self):
        self.ajouter("Jonathan aime le thé vert.", "preference", 5)
        self.ajouter("Jonathan conduit une Clio.", "personnel", 8)
        self.ajouter("Jonathan ne veut pas d'emojis.", "preference", 8)
        self.ajouter("Jonathan est allergique aux arachides.", "personnel", 10)

        self.assertEqual(
            [souvenir["contenu"] for souvenir in memoire.lister_socle()],
            [
                "Jonathan est allergique aux arachides.",
                "Jonathan ne veut pas d'emojis.",
            ]
        )

    def test_taille_limitee_critique_d_abord(self):
        for numero in range(memoire.TAILLE_MAX_SOCLE + 5):
            self.ajouter(f"Préférence numéro {numero}.", "preference", 8)

        self.ajouter("Jonathan est allergique aux arachides.", "personnel", 10)
        socle = memoire.lister_socle()

        self.assertEqual(len(socle), memoire.TAILLE_MAX_SOCLE)
        self.assertEqual(socle[0]["importance"], 10)

    def test_souvenir_inactif_exclu(self):
        self.ajouter("Jonathan est allergique aux arachides.", "personnel", 10)
        memoire.desactiver_souvenir(1)

        self.assertEqual(memoire.lister_socle(), [])

    def test_memoire_dans_le_message_et_pas_dans_le_systeme(self):
        self.ajouter("Jonathan est allergique aux arachides.", "personnel", 10)
        self.reponse("Salut.")
        self.elise.repondre("bonjour")

        messages = self.appels[0]["messages"]

        self.assertTrue(messages[-1]["content"].startswith("bonjour"))
        self.assertIn("arachides", messages[-1]["content"])
        self.assertIn("(noté le ", messages[-1]["content"])
        self.assertNotIn("arachides", messages[0]["content"])

    def test_souvenir_du_socle_cite_une_seule_fois(self):
        self.ajouter("Jonathan est allergique aux arachides.", "personnel", 10)
        self.reponse("Non.")
        self.elise.repondre("Jonathan est allergique aux arachides ?")

        self.assertEqual(
            self.appels[0]["messages"][-1]["content"].count("noté le"),
            1
        )

    def test_historique_garde_le_message_d_origine(self):
        self.ajouter("Jonathan est allergique aux arachides.", "personnel", 10)
        self.reponse("Salut.")
        self.reponse("Re.")
        self.elise.repondre("bonjour")
        self.elise.repondre("et là")

        for message in self.elise.conversation[1:]:
            self.assertNotIn("arachides", message["content"])

        messages = self.appels[1]["messages"]
        self.assertEqual(
            sum("arachides" in message["content"] for message in messages),
            1
        )

    def test_memoire_conservee_apres_un_outil(self):
        self.ajouter("Jonathan est allergique aux arachides.", "personnel", 10)

        def outil_fictif():
            return "ok"

        self.elise.outils_disponibles["outil_fictif"] = outil_fictif
        appel_outil = types.SimpleNamespace(
            function=types.SimpleNamespace(name="outil_fictif", arguments={})
        )
        self.reponses.append(FauxMorceau("", [appel_outil]))
        self.reponse("Fini.")

        self.assertEqual(self.elise.repondre("bonjour"), "Fini.")

        second_tour = self.appels[1]["messages"]
        self.assertTrue(any(
            message["role"] == "user" and "arachides" in message["content"]
            for message in second_tour
        ))
        self.assertTrue(any(
            message["role"] == "tool" for message in second_tour
        ))

    def test_taille_de_contexte_sur_tous_les_appels(self):
        def outil_fictif():
            return "ok"

        self.elise.outils_disponibles["outil_fictif"] = outil_fictif
        appel_outil = types.SimpleNamespace(
            function=types.SimpleNamespace(name="outil_fictif", arguments={})
        )
        self.reponses.append(FauxMorceau("", [appel_outil]))
        self.reponse("Fini.")
        self.elise.repondre("bonjour")

        self.assertEqual(len(self.appels), 2)

        for appel in self.appels:
            self.assertEqual(appel["options"]["num_ctx"], TAILLE_CONTEXTE)


class TestReindexation(BaseTemporaire):
    def ancienne_ligne(self, contenu, actif=1):
        self.requete(
            "INSERT INTO souvenirs(contenu, type, importance, date_ajout, "
            "date_modification, actif, source, embedding, modele_embedding) "
            "VALUES (?, 'personnel', 5, '2026-01-01', '2026-01-01', ?, 't', "
            "'[0.1, 0.2]', 'ancien-modele')",
            contenu,
            actif
        )

    def test_schema_ancien_migre(self):
        os.remove(self.base)
        connexion = sqlite3.connect(self.base)
        connexion.execute(
            "CREATE TABLE souvenirs(id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "contenu TEXT NOT NULL, type TEXT NOT NULL, importance INT NOT NULL, "
            "date_ajout TEXT NOT NULL, date_modification TEXT NOT NULL, "
            "actif INT NOT NULL, source TEXT NOT NULL, embedding TEXT NOT NULL)"
        )
        connexion.execute(
            "INSERT INTO souvenirs(contenu, type, importance, date_ajout, "
            "date_modification, actif, source, embedding) VALUES "
            "('Jonathan conduit une Clio.', 'personnel', 5, '2026-01-01', "
            "'2026-01-01', 1, 't', '[0.1]')"
        )
        connexion.commit()
        connexion.close()

        memoire.initialiser_memoire()

        self.assertEqual(
            self.requete("SELECT contenu, modele_embedding FROM souvenirs"),
            [("Jonathan conduit une Clio.", memoire.MODELE_EMBEDDING)]
        )

    def test_reindexe_aussi_les_inactifs(self):
        self.ancienne_ligne("Actif.")
        self.ancienne_ligne("Inactif.", actif=0)

        memoire.initialiser_memoire()

        self.assertEqual(
            self.requete("SELECT actif, modele_embedding FROM souvenirs ORDER BY id"),
            [(1, memoire.MODELE_EMBEDDING), (0, memoire.MODELE_EMBEDDING)]
        )

    def test_ollama_absent_vecteurs_jamais_melanges(self):
        self.ancienne_ligne("Jonathan conduit une Clio.")

        def panne(texte):
            raise ConnectionError("Ollama absent")

        self.simuler(memoire, "generer_embedding", panne)
        memoire.initialiser_memoire()

        self.assertEqual(memoire.lister_souvenirs_actifs(), [])

    def test_rien_a_faire_au_demarrage_suivant(self):
        self.ajouter("Jonathan conduit une Clio.")
        appels = []
        self.simuler(memoire, "generer_embedding", appels.append)

        memoire.initialiser_memoire()

        self.assertEqual(appels, [])


class TestRecherche(BaseTemporaire):
    def test_message_precedent_utilise(self):
        self.ajouter("Hugo est kiné à Rennes.")
        self.ajouter("Jonathan conduit une Clio.")

        sans_contexte = memoire.trouver_souvenirs_similaires("Et lui il fait quoi ?")
        avec_contexte = memoire.trouver_souvenirs_similaires(
            "Et lui il fait quoi ?",
            "Hugo est kiné à Rennes"
        )

        self.assertEqual(sans_contexte, [])
        self.assertEqual(
            avec_contexte[0]["souvenir"]["contenu"],
            "Hugo est kiné à Rennes."
        )

    def test_message_precedent_ne_penalise_pas(self):
        self.ajouter("Jonathan conduit une Clio.")

        requete = "Jonathan conduit une Clio."
        seul = memoire.trouver_souvenirs_similaires(requete)
        avec_bruit = memoire.trouver_souvenirs_similaires(
            requete,
            "Merci pour tout à l'heure, c'était clair."
        )

        self.assertGreaterEqual(avec_bruit[0]["score"], seul[0]["score"])

    def test_conflit_cherche_dans_tous_les_types(self):
        self.ajouter("Jonathan habite à Nantes.", "contexte")

        candidats = memoire.trouver_candidats_conflit({
            "contenu": "Jonathan habite à Lyon.",
            "type": "personnel",
        })

        self.assertEqual(len(candidats), 1)


class TestRelations(BaseTemporaire):
    NOUVEAU = {"contenu": "Nouveau.", "type": "personnel", "importance": 5}

    def scenario(self, relation, score):
        self.ajouter("Jonathan possède un Raspberry Pi.")
        souvenir = memoire.lister_souvenirs_actifs()[0]

        self.simuler(
            memoire,
            "trouver_candidats_conflit",
            lambda nouveau: [{"souvenir": souvenir, "score": score}]
        )
        self.simuler(
            memoire,
            "analyser_relation_souvenir",
            lambda nouveau, candidats: {
                "relations": [{"id": souvenir["id"], "relation": relation}]
            }
        )

    def test_vrai_doublon_refuse(self):
        self.scenario("doublon", 0.97)

        self.assertIs(memoire.traiter_nouveau_souvenir(self.NOUVEAU), False)

    def test_doublon_trop_eloigne_garde_l_information(self):
        self.scenario("doublon", 0.90)

        self.assertIs(memoire.traiter_nouveau_souvenir(self.NOUVEAU), True)
        self.assertEqual(len(memoire.lister_souvenirs_actifs()), 2)

    def test_analyse_impossible_ne_passe_pas_pour_un_doublon(self):
        self.scenario("doublon", 0.97)
        self.simuler(
            memoire,
            "analyser_relation_souvenir",
            lambda nouveau, candidats: None
        )

        self.assertIsNone(memoire.traiter_nouveau_souvenir(self.NOUVEAU))


class TestConfirmations(AvecElise):
    @staticmethod
    def confirmation(identifiant):
        return {
            "statut": "confirmation_requise",
            "id_modification": identifiant,
            "anciens_souvenirs": [{"contenu": "Jonathan habite à Nantes."}],
            "nouveau_souvenir": {"contenu": f"Jonathan habite à Ville{identifiant}."},
        }

    def setUp(self):
        super().setUp()
        self.questions = []
        self.appliquees = []
        self.annulees = []
        self.simuler(elise, "appliquer_modification_en_attente", self.appliquees.append)
        self.simuler(elise, "annuler_modification_en_attente", self.annulees.append)

    def memoriser(self, *resultats):
        self.simuler(
            self.elise,
            "_memoriser_message",
            lambda *arguments: list(resultats)
        )
        self.elise._memoriser_message_background("x", self.questions.append)

    def test_question_d_elise_prioritaire_sur_la_memoire(self):
        self.reponse("Tu veux que je l'ajoute au calendrier ?")
        self.elise.repondre("J'ai dentiste vendredi.")
        self.memoriser(self.confirmation(7))

        self.assertEqual(self.questions, [])
        self.assertIsNone(self.elise.id_modification_proposee)

        self.reponse("C'est ajouté.")
        reponse = self.elise.repondre(
            "oui",
            callback_confirmation=self.questions.append
        )

        self.assertEqual(reponse, "C'est ajouté.")
        self.assertEqual(self.appliquees, [])
        self.assertIn("Ville7", self.questions[0])
        self.assertEqual(self.elise.id_modification_proposee, 7)

    def test_question_memoire_visible_par_qwen_et_journalisee(self):
        self.reponse("Noté.")
        self.elise.repondre("J'ai déménagé.")
        self.memoriser(self.confirmation(7))

        self.assertEqual(self.elise.conversation[-1]["content"], self.questions[0])
        self.assertEqual(
            self.requete("SELECT contenu FROM echanges WHERE source = 'memoire'"),
            [(self.questions[0],)]
        )

    def test_plusieurs_confirmations_posees_a_la_suite(self):
        self.reponse("Noté.")
        self.elise.repondre("J'ai déménagé.")
        self.memoriser(self.confirmation(8), True, self.confirmation(9))

        self.assertEqual(self.elise.id_modification_proposee, 8)

        self.elise.repondre("non", callback_confirmation=self.questions.append)

        self.assertEqual(self.annulees, [8])
        self.assertEqual(self.elise.id_modification_proposee, 9)
        self.assertIn("Ville9", self.questions[-1])

        self.elise.repondre("oui")

        self.assertEqual(self.appliquees, [9])

    def test_attend_la_fin_de_la_reponse_en_cours(self):
        self.reponse("Noté.")
        self.elise.repondre("J'ai déménagé.")
        self.simuler(
            self.elise,
            "_memoriser_message",
            lambda *arguments: [self.confirmation(10)]
        )

        self.elise.verrou_reponse.acquire()
        fil = threading.Thread(
            target=self.elise._memoriser_message_background,
            args=("x", self.questions.append),
            daemon=True
        )
        fil.start()
        time.sleep(0.1)
        self.assertIsNone(self.elise.id_modification_proposee)

        self.elise.verrou_reponse.release()
        fil.join(3)

        self.assertEqual(self.elise.id_modification_proposee, 10)

    def test_erreur_du_thread_sans_plantage(self):
        def panne(*arguments):
            raise ConnectionError("Ollama absent")

        self.simuler(self.elise, "_memoriser_message", panne)

        self.elise._memoriser_message_background("x", self.questions.append)

        self.assertEqual(self.questions, [])


class TestPeriodes(unittest.TestCase):
    def setUp(self):
        self.aujourd_hui = datetime.now().date()

    def debut(self, expression):
        return outils.resoudre_periode_passee(expression)[0]

    def test_jours_proches(self):
        self.assertEqual(self.debut("aujourd'hui"), self.aujourd_hui.isoformat())
        self.assertEqual(
            self.debut("hier"),
            (self.aujourd_hui - timedelta(days=1)).isoformat()
        )
        self.assertEqual(
            self.debut("avant-hier"),
            (self.aujourd_hui - timedelta(days=2)).isoformat()
        )

    def test_semaine_derniere(self):
        lundi = self.aujourd_hui - timedelta(days=self.aujourd_hui.weekday())

        self.assertEqual(
            outils.resoudre_periode_passee("la semaine dernière"),
            ((lundi - timedelta(days=7)).isoformat(), lundi.isoformat())
        )

    def test_jour_de_la_semaine_toujours_passe(self):
        nom = outils.JOURS_SEMAINE[self.aujourd_hui.weekday()]

        self.assertEqual(
            self.debut(nom),
            (self.aujourd_hui - timedelta(days=7)).isoformat()
        )
        self.assertEqual(self.debut(f"{nom} dernier"), self.debut(nom))

    def test_date_iso(self):
        self.assertEqual(
            outils.resoudre_periode_passee("2026-10-01"),
            ("2026-10-01", "2026-10-02")
        )

    def test_inconnue(self):
        self.assertIsNone(outils.resoudre_periode_passee("bientôt"))
        self.assertIsNone(outils.resoudre_periode_passee(""))


class TestOutils(BaseTemporaire):
    def relation(self, relation):
        self.simuler(
            memoire,
            "analyser_relation_souvenir",
            lambda nouveau, candidats: {
                "relations": [
                    {"id": candidat["souvenir"]["id"], "relation": relation}
                    for candidat in candidats
                ]
            }
        )

    def test_retenir(self):
        self.assertEqual(
            outils.outil_retenir("Jonathan conduit une Clio."),
            {"succes": True, "statut": "retenu"}
        )

    def test_retenir_deux_fois(self):
        self.relation("doublon")
        outils.outil_retenir("Jonathan conduit une Clio.")

        self.assertEqual(
            outils.outil_retenir("Jonathan conduit une Clio.")["statut"],
            "déjà connu"
        )

    def test_retenir_remplace_sans_redemander(self):
        self.relation("contradiction")
        outils.outil_retenir("Jonathan habite à Nantes.")

        resultat = outils.outil_retenir("Jonathan habite à Lyon.")

        self.assertEqual(resultat["remplaces"], ["Jonathan habite à Nantes."])
        self.assertEqual(
            [souvenir["contenu"] for souvenir in memoire.lister_souvenirs_actifs()],
            ["Jonathan habite à Lyon."]
        )
        self.assertEqual(
            self.requete("SELECT COUNT(*) FROM modifications_memoire_en_attente"),
            [(0,)]
        )

    def test_retenir_ne_ment_pas_si_l_analyse_echoue(self):
        self.ajouter("Jonathan habite à Nantes.")
        self.simuler(
            memoire,
            "analyser_relation_souvenir",
            lambda nouveau, candidats: None
        )

        resultat = outils.outil_retenir("Jonathan habite à Lyon.")

        self.assertFalse(resultat["succes"])

    def test_type_et_importance_invalides_corriges(self):
        outils.outil_retenir("Jonathan conduit une Clio.", "n'importe", "énorme")

        self.assertEqual(
            self.requete("SELECT type, importance FROM souvenirs"),
            [("personnel", memoire.NIVEAUX_IMPORTANCE["forte"])]
        )

    def test_oublier_propose_sans_rien_retirer(self):
        self.ajouter("Jonathan conduit une Clio.")

        resultat = outils.outil_oublier("Jonathan conduit une Clio.")

        self.assertFalse(resultat["succes"])
        self.assertEqual(resultat["propositions"][0]["id"], 1)
        self.assertEqual(len(memoire.lister_souvenirs_actifs()), 1)

    def test_oublier_avec_identifiant_reversible(self):
        self.ajouter("Jonathan conduit une Clio.")

        resultat = outils.outil_oublier("ma voiture", 1)

        self.assertEqual(
            resultat,
            {"succes": True, "oublie": "Jonathan conduit une Clio."}
        )
        self.assertEqual(memoire.lister_souvenirs_actifs(), [])
        self.assertEqual(
            self.requete("SELECT contenu, actif FROM souvenirs"),
            [("Jonathan conduit une Clio.", 0)]
        )

    def test_oublier_identifiant_invalide(self):
        self.ajouter("Jonathan conduit une Clio.")
        memoire.desactiver_souvenir(1)

        self.assertFalse(outils.outil_oublier("x", 1)["succes"])
        self.assertFalse(outils.outil_oublier("x", 99)["succes"])

    def test_chercher_tout(self):
        self.ajouter("Jonathan conduit une Clio.")
        memoire.enregistrer_echange("user", "message en cours", "web")

        self.assertEqual(
            outils.outil_chercher_memoire(),
            {
                "succes": True,
                "souvenirs": ["Jonathan conduit une Clio."],
                "conversations": [],
            }
        )

    def test_chercher_par_periode(self):
        hier = (datetime.now().date() - timedelta(days=1)).isoformat()
        self.ajouter("Jonathan conduit une Clio.")
        self.requete(
            "INSERT INTO echanges(date, role, contenu, source) "
            "VALUES (?, 'user', 'On a parlé de Lyon.', 'web')",
            f"{hier}T10:00:00"
        )
        memoire.enregistrer_echange("user", "message en cours", "web")

        resultat = outils.outil_chercher_memoire("", "hier")

        self.assertEqual(resultat["souvenirs"], [])
        self.assertEqual(
            [echange["extrait"] for echange in resultat["conversations"]],
            ["On a parlé de Lyon."]
        )

    def test_chercher_periode_inconnue(self):
        self.assertFalse(outils.outil_chercher_memoire("", "bientôt")["succes"])


@unittest.skipUnless(
    os.environ.get("ELISE_TESTS_OLLAMA"),
    "ELISE_TESTS_OLLAMA=1 pour utiliser les vrais modèles"
)
class TestAvecOllama(BaseTemporaire):
    """Non-régressions qui dépendent de bge-m3 et de qwen3:4b."""

    embeddings_simules = False

    SOUVENIRS = [
        "Jonathan habite à Nantes.",
        "Le frère de Jonathan s'appelle Hugo.",
        "Hugo, le frère de Jonathan, est kiné.",
        "La copine de Jonathan s'appelle Léa.",
        "Jonathan conduit une Clio.",
        "Jonathan possède un Raspberry Pi.",
        "Jonathan boit du thé vert.",
        "Jonathan a une chatte nommée Nala.",
        "Jonathan fait de l'escalade le mardi soir.",
    ]

    def setUp(self):
        super().setUp()

        for contenu in self.SOUVENIRS:
            self.ajouter(contenu)

    @staticmethod
    def traiter(contenu):
        return memoire.traiter_nouveau_souvenir({
            "contenu": contenu,
            "type": "personnel",
            "importance": 5,
        })

    def actifs(self):
        return {
            souvenir["contenu"]
            for souvenir in memoire.lister_souvenirs_actifs()
        }

    def test_personnes_differentes_sans_souvenir_perdu(self):
        # Avait désactivé « Jonathan habite à Nantes. » sans rien demander.
        self.assertIs(
            self.traiter("Hugo, le frère de Jonathan, habite à Rennes."),
            True
        )
        self.assertIn("Jonathan habite à Nantes.", self.actifs())

    def test_information_nouvelle_sur_un_sujet_connu(self):
        self.assertIs(
            self.traiter("Jonathan a installé Ubuntu sur son Raspberry Pi."),
            True
        )
        self.assertIn("Jonathan possède un Raspberry Pi.", self.actifs())

    def test_vrais_doublons_refuses(self):
        for contenu in (
                "La copine de Jonathan se prénomme Léa.",
                "Jonathan vit à Nantes.",
                "Jonathan possède une Clio.",
        ):
            self.assertIs(self.traiter(contenu), False, contenu)

    def test_vraie_contradiction(self):
        self.traiter("Jonathan a déménagé à Lyon.")

        self.assertNotIn("Jonathan habite à Nantes.", self.actifs())
        self.assertIn("Jonathan a déménagé à Lyon.", self.actifs())

    def test_recherche_francaise(self):
        for message, attendu in (
                ("Ma voiture fait un bruit bizarre.", "Jonathan conduit une Clio."),
                ("Comment elle va Nala ?", "Jonathan a une chatte nommée Nala."),
        ):
            trouves = [
                candidat["souvenir"]["contenu"]
                for candidat in memoire.trouver_souvenirs_similaires(message)
            ]
            self.assertIn(attendu, trouves)


if __name__ == "__main__":
    unittest.main()
