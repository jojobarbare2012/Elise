from interfaces.tts_client import TTSClient

tts = TTSClient()

tts.parler(
    """Réviser biochimie, priorité cinq, statut en cours.
Manger, priorité huit, statut non commencé."""
)