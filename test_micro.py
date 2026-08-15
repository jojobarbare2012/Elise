from interfaces import tts_client,stt
from core import elise
from module.applications import lancer_application_locale
from module.tache import (
    outil_ajouter_tache,
    outil_lister_taches,
    outil_modifier_statut,
    outil_supprimer_tache
)

tts = tts_client.TTSClient()
elise = elise.Elise('qwen3:8b',[lancer_application_locale,
    outil_ajouter_tache,
    outil_lister_taches,
    outil_modifier_statut,
    outil_supprimer_tache])
stt=stt.STT()

message = stt.ecouter()

reponse = elise.repondre(message)

tts.parler(reponse)