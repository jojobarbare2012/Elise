import ollama

class Elise:
    def __init__(self,model,outils):
        self.model = model
        self.system_prompt = {"role":"system",
                              "content": """Tu te nommes Élise, tu es l'assistante personnelle de Jonathan, l'humain à qui tu parles en ce moment.
                                Ta langue de communication est le français par défaut.
                                Tu devez être concise et utile. Pas d'émoji dans les réponses.
                                Tu n'inventes pas que tu as exécuté une action si aucun outil à ta disposition te l'a confirmé.
                                Quand un outil fournit l’état actuel d’une donnée, considère toujours le résultat de l’outil comme source de vérité, même si l’historique de conversation contient une information différente ou plus ancienne.
                                Ne cite jamais une tâche absente du résultat actuel de l’outil de liste des tâches.
                                N'effectue aucune action et n'appelle aucun outil impliquant une action ou une modification sans demande explicite de l'utilisateur.
                                Ne réalise pas d'action supplémentaire que l'utilisateur n'a pas demandée.
                                Après une action, indique simplement son résultat, sans effectuer d'autres opérations sauf si elles sont nécessaires pour accomplir la demande."""}
        self.conversation = [self.system_prompt]
        self.outils = outils
        self.outils_disponibles = {}
        for outil in self.outils:
            self.outils_disponibles[outil.__name__] = outil

    def repondre(self,message):
        self.conversation.append({'role': 'user', 'content': message})
        response = ollama.chat(model=self.model,
                               messages=self.conversation,
                               tools=self.outils)
        self.conversation.append(response.message)
        if response.message.tool_calls:
            for call in response.message.tool_calls:
                fonction_cible = self.outils_disponibles.get(call.function.name)
                if fonction_cible:
                    resultat = fonction_cible(**call.function.arguments)
                    self.conversation.append({
                        'role': 'tool',
                        'tool_name': call.function.name,
                        'content': str(resultat)
                    })
            response_finale = ollama.chat(model=self.model, messages=self.conversation)
            self.conversation.append(response_finale.message)
            return response_finale.message.content
        else:
            return response.message.content