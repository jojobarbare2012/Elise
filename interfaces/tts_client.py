import httpx

class TTSClient:
    def __init__(self):
        self.adresse = "http://127.0.0.1:5000"

    def parler(self, texte):
        reponse = httpx.post(
            self.adresse + "/parler",
            json={"texte": texte},
            timeout=None
        )

        print("STATUS :", reponse.status_code)
        print("REPONSE :", reponse.text)
        return reponse.text