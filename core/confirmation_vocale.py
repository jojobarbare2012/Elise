from threading import Event, Lock


class ConfirmationVocale:
    """
    Question mémoire à lire à voix haute. Elle part d'un thread en
    arrière-plan, parfois pendant que le micro écoute : la lire tout de
    suite ferait entendre sa propre voix à Élise. Le worker vocal la lit
    donc entre deux écoutes, micro fermé.
    """

    def __init__(self):
        # Demande au micro de rendre la main si Jonathan ne parle pas.
        self.evenement = Event()
        self._verrou = Lock()
        self._id_modification = None
        self._texte = None

    def proposer(self, id_modification, texte):
        with self._verrou:
            self._id_modification = id_modification
            self._texte = texte

        self.evenement.set()

    def prendre(self, id_modification_courante):
        """
        Retourne le texte à lire, une seule fois. Rien si Jonathan a déjà
        répondu entre-temps : la question n'aurait plus de sens.
        """
        with self._verrou:
            id_modification = self._id_modification
            texte = self._texte
            self._id_modification = None
            self._texte = None

        self.evenement.clear()

        if id_modification is None:
            return None

        if id_modification != id_modification_courante:
            return None

        return texte
