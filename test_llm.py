import ollama

from module.applications import lancer_application_locale
from module.tache import (
    outil_ajouter_tache,
    outil_lister_taches,
    outil_modifier_statut,
    outil_supprimer_tache
)

conversation=[{"role":"system",
               "content":"Tu te nommes Élise, tu es l'assistante personnelle de Jonathan, l'humain à qui tu parles en ce moment. Ta langue de communication est le français par défaut. Tu dois être concise et utile. Pas d'émoji dans les réponses. Tu n'inventes pas que tu as exécuté une action si aucun outil à ta disposition te l'a confirmé.Quand un outil fournit l’état actuel d’une donnée, considère toujours le résultat de l’outil comme source de vérité, même si l’historique de conversation contient une information différente ou plus ancienne.Ne cite jamais une tâche absente du résultat actuel de l’outil de liste des tâches.N'effectue aucune action et n'appelle aucun outil impliquant une action ou une modification sans demande explicite de l'utilisateur. Ne réalise pas d'action supplémentaire que l'utilisateur n'a pas demandée. Après une action, indique simplement son résultat, sans effectuer d'autres opérations sauf si elles sont nécessaires pour accomplir la demande."}]



while True:
    prompt= input()
    if prompt == "quit":
        break
    conversation.append({'role': 'user', 'content': prompt})
    response = ollama.chat(model='qwen3:8b',
                           messages=conversation,
                           tools=[
                               lancer_application_locale,
                               outil_ajouter_tache,
                               outil_lister_taches,
                               outil_modifier_statut,
                               outil_supprimer_tache
                           ])
    outils_disponibles = {
        "lancer_application_locale": lancer_application_locale,
        "outil_ajouter_tache": outil_ajouter_tache,
        "outil_lister_taches": outil_lister_taches,
        "outil_modifier_statut": outil_modifier_statut,
        "outil_supprimer_tache": outil_supprimer_tache
    }
    conversation.append(response.message)
    if response.message.tool_calls:
        for call in response.message.tool_calls:
            fonction_cible = outils_disponibles.get(call.function.name)
            if fonction_cible:
                resultat = fonction_cible(**call.function.arguments)
                conversation.append({
                    'role': 'tool',
                    'tool_name': call.function.name,
                    'content': str(resultat)
                })
        response_finale = ollama.chat(model='qwen3:8b', messages=conversation)
        conversation.append(response_finale.message)
        print(response_finale.message.content)
    else:
        print(response.message.content)
