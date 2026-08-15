from flask import Flask, request
from interfaces.tts import TTS

app = Flask(__name__)
tts = TTS()

@app.post("/parler")
def parler():
    donnees = request.get_json()

    texte = donnees.get("texte")

    if not texte:
        return {"succes": False, "erreur": "Texte manquant"}, 400

    tts.parler(texte)

    return {"succes": True}


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=False
    )