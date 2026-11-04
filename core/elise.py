import ollama
from .etat import EtatElise
import time
from .memoire import (
    initialiser_memoire,
    enregistrer_echange,
    analyser_message_pour_memoire,
    traiter_nouveau_souvenir,
    trouver_souvenirs_similaires,
    lister_socle,
    appliquer_modification_en_attente,
    annuler_modification_en_attente
)
from threading import Thread, Lock
from .personnalite import PROMPT_PERSONNALITE
from services.ollama import TAILLE_CONTEXTE

# La question posée à Jonathan est à la fin de la réplique.
TAILLE_MAX_REPLIQUE = 300

PROMPT_BASE = """
Tu te nommes Élise, tu es l'assistante personnelle de Jonathan.

Ta langue de communication est le français par défaut.

Tu n'inventes pas que tu as exécuté une action si aucun outil à ta disposition
ne te l'a confirmé.

Quand un outil fournit l'état actuel d'une donnée, considère toujours son résultat
comme source de vérité, même si l'historique de conversation contient une
information différente ou plus ancienne.

Ne cite jamais une tâche absente du résultat actuel de l'outil de liste des tâches.

N'effectue aucune action et n'appelle aucun outil impliquant une action ou une
modification sans demande explicite de Jonathan.

Ne réalise pas d'action supplémentaire qu'il n'a pas demandée.

Après une action, indique simplement son résultat, sans effectuer d'autres
opérations sauf si elles sont nécessaires pour accomplir la demande.

Quand Jonathan demande du code dans un langage précis, réponds uniquement dans
ce langage sauf si un autre langage est strictement nécessaire.

Exemples :
- S'il demande du JavaScript, ne génère pas une page HTML complète.
  Fournis uniquement le JavaScript dans un bloc ```javascript```.
- S'il demande du Python, utilise ```python```.
- S'il demande du HTML, utilise ```html```.
- Si plusieurs langages sont réellement nécessaires, utilise un bloc séparé
  pour chacun.

Ne mélange jamais plusieurs langages dans un même bloc si cela peut être évité.

=== MÉMOIRE ===

Quand Jonathan te dit de retenir, noter ou te souvenir de quelque chose,
utilise outil_retenir, même si c'est dit comme une consigne.

Quand il demande ce que tu sais sur lui, utilise outil_chercher_memoire sans
recherche : la mémoire ajoutée à son message n'est qu'un extrait.

=== CALENDRIER ===

Lorsqu'une demande concerne une date ou une heure relative, utilise toujours
le contexte temporel actuel pour la résoudre.

Ne prétends jamais qu'un événement existe sans consulter le calendrier lorsque
la question porte sur les événements actuellement enregistrés.

Pour créer, modifier ou supprimer un événement, utilise les outils du calendrier.

N'invente jamais une heure, une durée, un lieu ou une date absente de la demande.

Si une information temporelle nécessaire est réellement ambiguë, demande une
précision au lieu de choisir arbitrairement.

Lorsqu'un événement existant doit être retrouvé à partir de son nom, de sa
description ou de son lieu, utilise l'outil de recherche d'événements plutôt
que de filtrer arbitrairement par la nouvelle heure demandée.

Lorsqu'une demande contient une date relative ou un jour de semaine
comme "demain", "mardi", "mardi prochain" ou "dans 3 jours",
utilise toujours l'outil de résolution de date avant d'appeler
les outils du calendrier.

Ne calcule pas toi-même la date correspondante.

=== UTILISATION DES OUTILS ===

Tu peux appeler plusieurs outils successivement si une demande nécessite
plusieurs étapes.

Si une action nécessite d'abord de consulter une information pour obtenir
un identifiant ou un état actuel, consulte d'abord l'outil approprié,
puis utilise son résultat pour effectuer l'action demandée.

Ne demande pas à Jonathan un identifiant technique si tu peux le retrouver
toi-même avec les outils disponibles.
"""
MAX_TOURS_OUTILS = 5

REPONSES_POSITIVES = {
    "oui",
    "yes",
    "ok",
    "d'accord",
    "vas-y",
    "go"
}

REPONSES_NEGATIVES = {
    "non",
    "no",
    "annule",
    "laisse",
    "ne change rien"
}

from datetime import datetime, timedelta


JOURS_FR = [
    "lundi",
    "mardi",
    "mercredi",
    "jeudi",
    "vendredi",
    "samedi",
    "dimanche",
]


def obtenir_contexte_temporel():
    maintenant = datetime.now().astimezone()

    return (
        "=== CONTEXTE TEMPOREL ACTUEL ===\n"
        f"Date actuelle : {maintenant.date().isoformat()}\n"
        f"Jour actuel : {JOURS_FR[maintenant.weekday()]}\n"
        f"Heure actuelle : {maintenant.strftime('%H:%M:%S')}\n"
        f"Fuseau horaire : {maintenant.tzinfo}\n\n"
        "Pour toute date relative, utilise l'outil de résolution temporelle. "
        "Ne calcule pas toi-même la date correspondante."
    )

def filtrer_code_pour_tts(texte, dans_bloc_code):
    sortie = []
    i = 0

    while i < len(texte):
        if texte.startswith("```", i):
            dans_bloc_code = not dans_bloc_code
            i += 3

            # saute éventuellement le nom du langage
            if dans_bloc_code:
                while i < len(texte) and texte[i] != "\n":
                    i += 1

            continue

        if not dans_bloc_code:
            sortie.append(texte[i])

        i += 1

    return "".join(sortie), dans_bloc_code


def normaliser_reponse_confirmation(message: str):
    # "Oui." (Whisper), " OK ! " → "oui", "ok"
    message = message.lower().strip(" \t\n.!?,;…")
    message = " ".join(message.split())

    if message in REPONSES_POSITIVES:
        return True

    if message in REPONSES_NEGATIVES:
        return False

    return None


def formater_souvenir(souvenir):
    # La date permet de situer « il y a deux semaines » ou « en mars ».
    return f"- {souvenir['contenu']} (noté le {souvenir['date_ajout']})"


def construire_texte_confirmation(confirmation):
    # Les souvenirs finissent souvent par un point : on l'enlève
    # pour éviter « ... . ». dans la phrase.
    anciens = [
        souvenir["contenu"].rstrip(" .")
        for souvenir in confirmation["anciens_souvenirs"]
    ]
    nouveau = confirmation["nouveau_souvenir"]["contenu"].rstrip(" .")

    texte_anciens = " ".join(f"« {ancien} »" for ancien in anciens)

    return (
        f"Tu m'avais dit : {texte_anciens}. "
        f"Nouvelle information : « {nouveau} ». "
        "Je mets à jour ma mémoire ?"
    )

def decouper_pour_tts(texte):
    """Découpe un texte complet, hors streaming, en phrases pour le TTS."""
    segments, reste = extraire_segments_tts(texte)

    if reste.strip():
        segments.append(reste.strip())

    return segments


def extraire_segments_tts(
    buffer,
    taille_min_coupure=90,
    taille_max_phrase=160,
    taille_hard_max=190
):
    segments = []

    while buffer:
        # ============================================================
        # 1. PRIORITÉ ABSOLUE : vraie fin de phrase
        # ============================================================

        fin_phrase = None

        for i, caractere in enumerate(buffer):
            if caractere in "!?":
                fin_phrase = i + 1
                break

            if caractere == ".":
                avant = buffer[i - 1] if i > 0 else ""
                apres = buffer[i + 1] if i + 1 < len(buffer) else ""

                # évite certains cas comme 1.5 ou listes "1."
                if not (avant.isdigit() and apres.isdigit()):
                    fin_phrase = i + 1
                    break

            if caractere == "\n":
                fin_phrase = i + 1
                break

        # Phrase complète et taille acceptable :
        # on la garde ENTIÈRE.
        if fin_phrase is not None and fin_phrase <= taille_max_phrase:
            segment = buffer[:fin_phrase].strip()
            buffer = buffer[fin_phrase:].lstrip()

            if segment:
                segments.append(segment)

            continue

        # ============================================================
        # 2. PAS ENCORE ASSEZ LONG → on attend Qwen
        # ============================================================

        if len(buffer) < taille_max_phrase:
            break

        # ============================================================
        # 3. PHRASE LONGUE :
        # chercher une vraie respiration syntaxique
        # ============================================================

        limite = min(len(buffer), taille_hard_max)

        position_coupure = None

        # D'abord ; et :
        for i in range(limite - 1, taille_min_coupure - 1, -1):
            if buffer[i] in ";:":
                position_coupure = i + 1
                break

        # Puis virgule seulement si nécessaire
        if position_coupure is None:
            for i in range(limite - 1, taille_min_coupure - 1, -1):
                if buffer[i] == ",":
                    position_coupure = i + 1
                    break

        # ============================================================
        # 4. HARD LIMIT :
        # uniquement pour empêcher une phrase monstrueuse
        # ============================================================

        if position_coupure is None and len(buffer) >= taille_hard_max:
            for i in range(taille_hard_max - 1, taille_min_coupure - 1, -1):
                if buffer[i].isspace():
                    position_coupure = i
                    break

        if position_coupure is None:
            break

        segment = buffer[:position_coupure].strip()
        buffer = buffer[position_coupure:].lstrip()

        if segment:
            segments.append(segment)

    return segments, buffer

import re

EMOJI_PATTERN = re.compile(
    "["
    "\U0001F300-\U0001F5FF"
    "\U0001F600-\U0001F64F"
    "\U0001F680-\U0001F6FF"
    "\U0001F700-\U0001F77F"
    "\U0001F780-\U0001F7FF"
    "\U0001F800-\U0001F8FF"
    "\U0001F900-\U0001F9FF"
    "\U0001FA00-\U0001FAFF"
    "\U00002600-\U000026FF"
    "\U00002700-\U000027BF"
    "]+",
    flags=re.UNICODE,
)

def nettoyer_morceau(texte):
    return EMOJI_PATTERN.sub("", texte)

def nettoyer_reponse_complete(texte):
    texte = texte.strip()

    if (
        len(texte) >= 2
        and texte.startswith('"')
        and texte.endswith('"')
    ):
        texte = texte[1:-1]

    return texte

class FiltreTTSCODE:
    def __init__(self):
        self.dans_bloc_code = False
        self.buffer = ""

    def traiter(self, morceau):
        self.buffer += morceau
        sortie = []

        while True:
            # Cherche une fence complète
            pos = self.buffer.find("```")

            if pos == -1:
                # Important :
                # on garde les 2 derniers caractères,
                # car ils peuvent devenir le début de ``` au chunk suivant
                if len(self.buffer) > 2:
                    texte_sur = self.buffer[:-2]

                    if not self.dans_bloc_code:
                        sortie.append(texte_sur)

                    self.buffer = self.buffer[-2:]

                break

            # Texte avant la fence
            avant = self.buffer[:pos]

            if not self.dans_bloc_code:
                sortie.append(avant)

            # On bascule code / hors code
            self.dans_bloc_code = not self.dans_bloc_code

            # Retire la fence
            self.buffer = self.buffer[pos + 3:]

            # À l'entrée d'un bloc code :
            # supprimer "python", "javascript", etc. jusqu'au retour ligne
            if self.dans_bloc_code:
                fin_ligne = self.buffer.find("\n")

                if fin_ligne != -1:
                    self.buffer = self.buffer[fin_ligne + 1:]
                else:
                    # Le nom du langage peut arriver au prochain chunk
                    break

        return "".join(sortie)

    def flush(self):
        if self.dans_bloc_code:
            self.buffer = ""
            return ""

        texte = self.buffer
        self.buffer = ""
        return texte







class Elise:
    def __init__(self,model,outils):
        self.model = model
        self.conversation = [{"role":"system",
                              "content": PROMPT_BASE + "\n\n" + PROMPT_PERSONNALITE }]
        self.outils = outils
        self.outils_disponibles = {
            outil.__name__: outil
            for outil in outils
        }
        self.etat = EtatElise()
        # dans Elise.__init__
        self.debut_reponse = None
        # Une seule réponse à la fois (vocal, PC, téléphone).
        self.verrou_reponse = Lock()
        # Modification mémoire proposée à l'utilisateur, valable
        # uniquement pour son prochain message.
        self.id_modification_proposee = None
        # Confirmations qui attendent un moment sans question en cours.
        self.confirmations_en_file = []
        initialiser_memoire()


    def _journaliser(self, role, contenu, source):
        """Une panne du journal ne doit jamais bloquer une réponse."""
        if not contenu:
            return

        try:
            enregistrer_echange(role, contenu, source)

        except Exception as erreur:
            print("[JOURNAL] ERREUR :", repr(erreur), flush=True)

    def _lancer_memorisation_background(
            self,
            message,
            callback_stream=None,
            replique_precedente=None
    ):
        """
        Lance la mémorisation dans un thread daemon afin de ne pas
        ralentir la réponse visible par l'utilisateur.
        """
        Thread(
            target=self._memoriser_message_background,
            args=(message, callback_stream, replique_precedente),
            daemon=True
        ).start()

    def _derniere_replique(self):
        """Fin de la dernière réplique d'Élise, pour l'extraction."""
        for message in reversed(self.conversation):
            if message["role"] == "assistant" and message["content"]:
                return message["content"][-TAILLE_MAX_REPLIQUE:]

        return None

    def _dernier_message_jonathan(self):
        for message in reversed(self.conversation):
            if message["role"] == "user":
                return message["content"]

        return None

    def _recuperer_contexte_memoire(self, message, message_precedent=None):
        socle = lister_socle()
        ids_socle = {souvenir["id"] for souvenir in socle}

        souvenirs = list(socle) + [
            candidat["souvenir"]
            for candidat in trouver_souvenirs_similaires(
                message,
                message_precedent
            )
            if candidat["souvenir"]["id"] not in ids_socle
        ]

        if not souvenirs:
            return None

        return (
            "[Mémoire, à appliquer si c'est utile, sans la citer mot à mot]\n"
            + "\n".join(
                formater_souvenir(souvenir)
                for souvenir in souvenirs
            )
        )

    def _traiter_stream(self, stream, callback=None,callback_stream=None,debut_reponse=None):
        filtre_code_tts = FiltreTTSCODE()
        premier_chunk_recu = False
        texte_complet = ""
        dans_bloc_code = False
        buffer_phrase = ""
        tool_calls = []
        dernier_chunk=None
        premier_morceau_texte = True
        for chunk in stream:
            dernier_chunk = chunk
            morceau = chunk.message.content or ""
            morceau = nettoyer_morceau(morceau)
            if morceau and not premier_chunk_recu and premier_morceau_texte:
                premier_chunk_recu = True
                premier_morceau_texte = False
                if morceau.startswith('"'):
                    morceau = morceau[1:]
                if debut_reponse is not None:
                    delai = time.perf_counter() - debut_reponse
                    print(f"[PERF] Premier chunk LLM : {delai:.3f}s")

            if callback_stream and morceau:
                callback_stream(morceau)

            texte_complet += morceau
            texte_tts, dans_bloc_code = filtrer_code_pour_tts(
                morceau,
                dans_bloc_code
            )
            morceau_tts = filtre_code_tts.traiter(morceau)

            if morceau_tts:
                buffer_phrase += morceau_tts

            segments, buffer_phrase = extraire_segments_tts(buffer_phrase)

            for segment in segments:
                if callback:
                    callback(segment)

            if chunk.message.tool_calls:
                tool_calls.extend(chunk.message.tool_calls)

            print(morceau, end="", flush=True)
        reste_tts = filtre_code_tts.flush()

        if reste_tts:
            buffer_phrase += reste_tts

        if buffer_phrase.strip() and callback:
            callback(buffer_phrase.strip())

        print()
        if dernier_chunk is not None:
            if chunk.done:
                print("\n=== PERF OLLAMA ===", flush=True)

                print(
                    f"total_duration      : {getattr(chunk, 'total_duration', None)}",
                    flush=True
                )

                print(
                    f"load_duration       : {getattr(chunk, 'load_duration', None)}",
                    flush=True
                )

                print(
                    f"prompt_eval_count   : {getattr(chunk, 'prompt_eval_count', None)}",
                    flush=True
                )

                print(
                    f"prompt_eval_duration: {getattr(chunk, 'prompt_eval_duration', None)}",
                    flush=True
                )

                print(
                    f"eval_count          : {getattr(chunk, 'eval_count', None)}",
                    flush=True
                )

                print(
                    f"eval_duration       : {getattr(chunk, 'eval_duration', None)}",
                    flush=True
                )

                print("===================\n", flush=True)

        return texte_complet, tool_calls

    def _executer_outils(self, tool_calls):
        nombre_executes = 0

        for call in tool_calls:
            fonction_cible = self.outils_disponibles.get(
                call.function.name
            )

            if fonction_cible:
                print(
                    "[TOOL]",
                    call.function.name,
                    call.function.arguments,
                    flush=True
                )

                try:
                    resultat = fonction_cible(
                        **call.function.arguments
                    )

                except Exception as erreur:
                    print(
                        "[TOOL ERROR]",
                        call.function.name,
                        repr(erreur),
                        flush=True
                    )

                    resultat = {
                        "succes": False,
                        "erreur": f"{type(erreur).__name__} : {erreur}"
                    }

                print(
                    "[TOOL RESULT]",
                    resultat,
                    flush=True
                )

                self.conversation.append({
                    "role": "tool",
                    "tool_name": call.function.name,
                    "content": str(resultat)
                })

                nombre_executes += 1

        return nombre_executes

    def _memoriser_message(self, message, replique_precedente=None):
        analyse = analyser_message_pour_memoire(
            message,
            replique_precedente
        )

        resultats = []

        for souvenir in analyse["souvenirs"]:
            resultat = traiter_nouveau_souvenir(souvenir)

            print(
                f"[MEMOIRE] {souvenir['contenu']} -> {resultat}"
            )

            resultats.append(resultat)

        return resultats

    def _memoriser_message_background(
            self,
            message,
            callback_confirmation=None,
            replique_precedente=None
    ):
        print("[MEMOIRE] THREAD lancé pour :", repr(message), flush=True)

        try:
            resultats = self._memoriser_message(message, replique_precedente)

        except Exception as erreur:
            print("[MEMOIRE] ERREUR :", repr(erreur), flush=True)
            return

        confirmations = [
            resultat
            for resultat in resultats
            if isinstance(resultat, dict)
            and resultat.get("statut") == "confirmation_requise"
        ]

        if not confirmations:
            return

        # Attend la fin d'une éventuelle réponse en cours.
        with self.verrou_reponse:
            self.confirmations_en_file.extend(confirmations)
            self._proposer_confirmation(callback_confirmation)

    def _proposer_confirmation(self, callback_confirmation=None):
        """
        Pose la prochaine question mémoire, à appeler sous verrou_reponse.
        Si Élise vient de poser une question, on attend : le « oui » de
        Jonathan lui répondrait à elle, pas à la mémoire.
        """
        if self.id_modification_proposee is not None:
            return

        if not self.confirmations_en_file:
            return

        derniere_replique = self._derniere_replique() or ""

        if derniere_replique.rstrip().endswith("?"):
            print("[MEMOIRE] Confirmation différée.", flush=True)
            return

        confirmation = self.confirmations_en_file.pop(0)
        self.id_modification_proposee = confirmation["id_modification"]

        texte_confirmation = construire_texte_confirmation(confirmation)

        # Qwen doit savoir ce qui a été demandé si Jonathan répond à côté.
        self.conversation.append({
            "role": "assistant",
            "content": texte_confirmation
        })
        self._journaliser("assistant", texte_confirmation, "memoire")

        if callback_confirmation:
            callback_confirmation(texte_confirmation)

    def repondre(
            self,
            message,
            callback=None,
            callback_stream=None,
            callback_fin=None,
            callback_confirmation=None,
            source="web"
    ):
        """
        Une seule réponse à la fois : les appels concurrents
        attendent leur tour.
        """
        with self.verrou_reponse:
            return self._repondre(
                message,
                callback,
                callback_stream,
                callback_fin,
                callback_confirmation,
                source
            )

    def _repondre(
            self,
            message,
            callback=None,
            callback_stream=None,
            callback_fin=None,
            callback_confirmation=None,
            source="web"
    ):
        self._journaliser("user", message, source)

        # À lire avant d'ajouter le message de Jonathan et la réponse.
        replique_precedente = self._derniere_replique()
        message_precedent = self._dernier_message_jonathan()

        id_modification = self.id_modification_proposee

        if id_modification is not None:
            # La question ne vaut que pour ce message : on la consomme.
            self.id_modification_proposee = None

            confirmation = normaliser_reponse_confirmation(message)

            if confirmation is None:
                # Question ignorée : dans le doute, on ne modifie pas.
                annuler_modification_en_attente(id_modification)

                print(
                    "[MEMOIRE] Question ignorée, modification annulée.",
                    flush=True
                )

            else:
                self.conversation.append({
                    "role": "user",
                    "content": message
                })

                if confirmation:
                    appliquer_modification_en_attente(
                        id_modification
                    )
                    texte_confirmation = "Mémoire mise à jour."

                else:
                    annuler_modification_en_attente(
                        id_modification
                    )
                    texte_confirmation = "Modification de mémoire annulée."

                self.conversation.append({
                    "role": "assistant",
                    "content": texte_confirmation
                })

                self._journaliser(
                    "assistant",
                    texte_confirmation,
                    source
                )

                if callback_stream:
                    callback_stream(texte_confirmation)

                if callback:
                    callback(texte_confirmation)

                if callback_fin:
                    callback_fin()

                self._proposer_confirmation(callback_confirmation)

                return texte_confirmation

        self.conversation.append({
            "role": "user",
            "content": message
        })

        contexte_memoire = self._recuperer_contexte_memoire(
            message,
            message_precedent
        )

        messages_pour_reponse = [
            message.copy()
            for message in self.conversation
        ]

        contexte_temporel = obtenir_contexte_temporel()

        messages_pour_reponse[0]["content"] += (
                "\n\n"
                + contexte_temporel
        )

        # Dans le message et non dans le système : mesuré le 2026-11-04,
        # Qwen ignorait une allergie placée dans le système (0/4) et en
        # tient compte ici (4/4). self.conversation reste sans mémoire.
        if contexte_memoire:
            messages_pour_reponse[-1]["content"] += (
                    "\n\n"
                    + contexte_memoire
            )

        self.etat.changer("THINKING")

        try:
            self.debut_reponse = time.perf_counter()

            print("[PERF] Début reponse")
            print("\n=== MESSAGES ENVOYÉS À QWEN ===")

            for message_debug in messages_pour_reponse:
                print(
                    message_debug["role"],
                    "=>",
                    message_debug["content"]
                )

            print("=== FIN MESSAGES ===\n")

            # ------------------------------------------------------------
            # Premier appel au modèle
            # ------------------------------------------------------------

            stream = ollama.chat(
                model=self.model,
                messages=messages_pour_reponse,
                tools=self.outils,
                stream=True,
                options={
                    "num_predict": 4096,
                    "num_ctx": TAILLE_CONTEXTE
                },
                think=False
            )

            texte_complet, tool_calls = self._traiter_stream(
                stream,
                callback,
                callback_stream,
                self.debut_reponse
            )

            texte_complet = nettoyer_reponse_complete(texte_complet)

            message_assistant = {
                "role": "assistant",
                "content": texte_complet
            }

            if tool_calls:
                message_assistant["tool_calls"] = tool_calls

            self.conversation.append(message_assistant)

            # ------------------------------------------------------------
            # Boucle multi-tools
            # ------------------------------------------------------------

            tour_outils = 0

            while tool_calls and tour_outils < MAX_TOURS_OUTILS:
                tour_outils += 1

                print(
                    f"[TOOLS] Tour {tour_outils}/{MAX_TOURS_OUTILS}",
                    flush=True
                )

                self._executer_outils(tool_calls)

                # Système (date) et message (mémoire) enrichis, puis
                # ce qui s'est ajouté depuis : réponses et outils.
                # self.conversation reste sans contexte temporaire.
                messages_tour = (
                    messages_pour_reponse
                    + self.conversation[len(messages_pour_reponse):]
                )

                stream = ollama.chat(
                    model=self.model,
                    messages=messages_tour,
                    tools=self.outils,
                    stream=True,
                    options={
                        "num_predict": 4096,
                        "num_ctx": TAILLE_CONTEXTE
                    },
                    think=False
                )

                texte_complet, tool_calls = self._traiter_stream(
                    stream,
                    callback,
                    callback_stream,
                    self.debut_reponse
                )

                texte_complet = nettoyer_reponse_complete(texte_complet)

                message_assistant = {
                    "role": "assistant",
                    "content": texte_complet
                }

                if tool_calls:
                    message_assistant["tool_calls"] = tool_calls

                self.conversation.append(message_assistant)

            # ------------------------------------------------------------
            # Sécurité anti-boucle infinie
            # ------------------------------------------------------------

            if tool_calls:
                print(
                    "[TOOLS] Limite maximale de tours atteinte.",
                    flush=True
                )

                texte_complet = (
                    "Je n'ai pas réussi à terminer l'action correctement."
                )

                self.conversation.append({
                    "role": "assistant",
                    "content": texte_complet
                })

                if callback_stream:
                    callback_stream(texte_complet)

            # ------------------------------------------------------------
            # Fin de réponse
            # ------------------------------------------------------------

            self._journaliser("assistant", texte_complet, source)

            if callback_fin:
                callback_fin()

            self._proposer_confirmation(callback_confirmation)

            self._lancer_memorisation_background(
                message,
                callback_confirmation,
                replique_precedente
            )

            return texte_complet

        finally:
            self.etat.changer("IDLE")