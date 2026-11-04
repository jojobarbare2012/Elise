"""
Lecture vocale des confirmations mémoire. Ni micro, ni haut-parleur, ni
Whisper : le flux audio et les modèles sont simulés.

Depuis la racine du projet, avec .venv :
    python -m unittest tests.test_confirmation_vocale
"""
import threading
import types
import unittest
from unittest import mock

import numpy as np

from core.confirmation_vocale import ConfirmationVocale
from core.elise import decouper_pour_tts
from services import stt


class TestConfirmationVocale(unittest.TestCase):
    def test_lue_une_seule_fois(self):
        file = ConfirmationVocale()
        file.proposer(7, "Je mets à jour ma mémoire ?")

        self.assertTrue(file.evenement.is_set())
        self.assertEqual(file.prendre(7), "Je mets à jour ma mémoire ?")
        self.assertFalse(file.evenement.is_set())
        self.assertIsNone(file.prendre(7))

    def test_ignoree_si_jonathan_a_deja_repondu(self):
        file = ConfirmationVocale()
        file.proposer(7, "Question.")

        self.assertIsNone(file.prendre(None))
        self.assertFalse(file.evenement.is_set())

    def test_ignoree_si_une_autre_question_a_pris_sa_place(self):
        file = ConfirmationVocale()
        file.proposer(7, "Question.")

        self.assertIsNone(file.prendre(8))

    def test_rien_en_attente(self):
        self.assertIsNone(ConfirmationVocale().prendre(7))


class TestDecoupage(unittest.TestCase):
    def test_rien_n_est_perdu(self):
        texte = (
            "Tu m'avais dit : « Jonathan habite à Nantes ». "
            "Nouvelle information : « Jonathan a déménagé à Lyon ». "
            "Je mets à jour ma mémoire ?"
        )

        segments = decouper_pour_tts(texte)

        self.assertEqual(
            "".join(segments).replace(" ", ""),
            texte.replace(" ", "")
        )
        self.assertTrue(segments[-1].endswith("?"))

    def test_texte_sans_ponctuation(self):
        self.assertEqual(decouper_pour_tts("Mémoire"), ["Mémoire"])


class FauxMicro:
    """Délivre les blocs un par un, puis un silence sans fin."""

    def __init__(self, blocs, callback):
        self.blocs = blocs
        self.callback = callback
        self.fini = threading.Event()

    def __enter__(self):
        def debiter():
            for bloc in self.blocs:
                if self.fini.wait(0.001):
                    return
                self.callback(bloc, 0, None, None)

            while not self.fini.wait(0.001):
                self.callback(np.zeros((512, 1), dtype=np.float32), 0, None, None)

        threading.Thread(target=debiter, daemon=True).start()
        return self

    def __exit__(self, *arguments):
        self.fini.set()


class TestEcoute(unittest.TestCase):
    VOIX = np.ones((512, 1), dtype=np.float32)
    SILENCE = np.zeros((512, 1), dtype=np.float32)

    def moteur(self, blocs):
        moteur = stt.STT.__new__(stt.STT)
        moteur.frequence = 16000
        moteur.taille_bloc = 512
        moteur.duree_bloc = 512 / 16000
        moteur.duree_silence = 0.1
        moteur.vad_model = lambda bloc, frequence: types.SimpleNamespace(
            item=lambda: float(bloc.abs().max())
        )
        moteur.model = types.SimpleNamespace(
            transcribe=lambda *arguments, **options: (
                [types.SimpleNamespace(text="oui")],
                None
            )
        )

        def flux(callback, **options):
            return FauxMicro(blocs, callback)

        for cible, nom, valeur in (
                (stt.sd, "InputStream", flux),
                (stt, "write", lambda *arguments: None),
        ):
            remplacement = mock.patch.object(cible, nom, valeur)
            remplacement.start()
            self.addCleanup(remplacement.stop)

        return moteur

    def test_interrompue_si_jonathan_ne_parle_pas(self):
        interruption = threading.Event()
        interruption.set()
        actif = threading.Event()
        actif.set()

        resultat = self.moteur([]).ecouter(actif, interruption)

        self.assertIsNone(resultat)

    def test_ne_coupe_pas_jonathan_quand_il_parle(self):
        interruption = threading.Event()
        actif = threading.Event()
        actif.set()
        moteur = self.moteur([self.VOIX] * 6)
        vrai_vad = moteur.vad_model
        blocs_vus = []

        def vad(bloc, frequence):
            blocs_vus.append(bloc)

            if len(blocs_vus) == 5:
                interruption.set()  # arrive alors qu'il a commencé

            return vrai_vad(bloc, frequence)

        moteur.vad_model = vad

        self.assertEqual(moteur.ecouter(actif, interruption), "oui")
        self.assertTrue(interruption.is_set())  # reste due pour le worker

    def test_sans_interruption_comportement_inchange(self):
        actif = threading.Event()
        actif.set()

        self.assertEqual(self.moteur([self.VOIX] * 6).ecouter(actif), "oui")


if __name__ == "__main__":
    unittest.main()
