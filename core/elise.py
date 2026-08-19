import ollama
from .etat import EtatElise



def extraire_phrases(buffer):
    phrases = []
    debut = 0

    for i, caractere in enumerate(buffer):
        est_fin_phrase = caractere in "!?\n"

        if caractere == ".":
            avant = buffer[i - 1] if i > 0 else ""

            # Si le point suit un chiffre, on considère que ça peut être
            # un numéro de liste et on ne coupe pas dessus.
            if not avant.isdigit():
                est_fin_phrase = True

        if est_fin_phrase:
            phrase = buffer[debut:i + 1].strip()

            if phrase:
                phrases.append(phrase)

            debut = i + 1

    reste = buffer[debut:]

    return phrases, reste


class Elise:
    def __init__(self,model,outils):
        self.model = model
        self.conversation = [{"role":"system",
                              "content": """Tu te nommes Élise, tu es l'assistante personnelle de Jonathan, l'humain à qui tu parles en ce moment.
                                Ta langue de communication est le français par défaut.
                                Tu devez être concise et utile. Pas d'émoji dans les réponses.
                                Tu n'inventes pas que tu as exécuté une action si aucun outil à ta disposition te l'a confirmé.
                                Quand un outil fournit l’état actuel d’une donnée, considère toujours le résultat de l’outil comme source de vérité, même si l’historique de conversation contient une information différente ou plus ancienne.
                                Ne cite jamais une tâche absente du résultat actuel de l’outil de liste des tâches.
                                N'effectue aucune action et n'appelle aucun outil impliquant une action ou une modification sans demande explicite de l'utilisateur.
                                Ne réalise pas d'action supplémentaire que l'utilisateur n'a pas demandée.
                                Après une action, indique simplement son résultat, sans effectuer d'autres opérations sauf si elles sont nécessaires pour accomplir la demande."""}]
        self.outils = outils
        self.outils_disponibles = {
            outil.__name__: outil
            for outil in outils
        }
        self.etat = EtatElise()

    def _traiter_stream(self, stream, callback=None,callback_stream=None):
        texte_complet = ""
        buffer_phrase = ""
        tool_calls = []

        for chunk in stream:
            morceau = chunk.message.content or ""

            if callback_stream and morceau:
                callback_stream(morceau)

            texte_complet += morceau
            buffer_phrase += morceau

            phrases, buffer_phrase = extraire_phrases(buffer_phrase)

            for phrase in phrases:
                if callback:
                    callback(phrase)

            if chunk.message.tool_calls:
                tool_calls.extend(chunk.message.tool_calls)

            print(morceau, end="", flush=True)

        if buffer_phrase.strip() and callback:
            callback(buffer_phrase.strip())

        print()

        return texte_complet, tool_calls

    def _executer_outils(self, tool_calls):
        for call in tool_calls:
            fonction_cible = self.outils_disponibles.get(call.function.name)
            if fonction_cible:
                resultat = fonction_cible(**call.function.arguments)
                self.conversation.append({
                        'role': 'tool',
                        'tool_name': call.function.name,
                        'content': str(resultat)
                })

    def repondre(self,message,callback=None,callback_stream=None, callback_fin=None):
        self.conversation.append({'role': 'user', 'content': message})
        self.etat.changer("THINKING")
        try:
            stream = ollama.chat(
                model=self.model,
                messages=self.conversation,
                tools=self.outils,
                stream=True
            )

            texte_complet, tool_calls = self._traiter_stream(
                stream,
                callback,
                callback_stream
            )
            message_assistant = {
                "role": "assistant",
                "content": texte_complet
            }

            if tool_calls:
                message_assistant["tool_calls"] = tool_calls

            self.conversation.append(message_assistant)

            if tool_calls:
                self._executer_outils(tool_calls)
                stream_final = ollama.chat(
                              model=self.model,
                              messages=self.conversation,
                              stream=True)
                texte_final, _ = self._traiter_stream(
                    stream_final,
                    callback,
                    callback_stream
                )
                self.conversation.append({
                    "role": "assistant",
                    "content": texte_final
                })
                if callback_fin:
                    callback_fin()
                return texte_final
            if callback_fin:
                callback_fin()
            return texte_complet
        finally:
            self.etat.changer("IDLE")