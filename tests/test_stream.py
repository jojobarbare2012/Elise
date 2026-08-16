import ollama

stream = ollama.chat(
    model="qwen3:8b",
    messages=[
        {
            "role": "user",
            "content": "Explique en trois phrases ce qu'est une mitochondrie."
        }
    ],
    stream=True
)

texte_complet = ""

for chunk in stream:
    morceau = chunk.message.content or ""
    texte_complet += morceau

    print(morceau, end="", flush=True)

print("\n")
print("Réponse complète :", texte_complet)