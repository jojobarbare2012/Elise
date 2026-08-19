class EtatElise:
    def __init__(self):
        self.etat = "IDLE"
        self.etat_autorises=["IDLE","THINKING","SPEAKING","LISTENING"]

    def changer(self, nouveau_etat):
        if nouveau_etat in self.etat_autorises:
            self.etat = nouveau_etat
            return True
        return False

    def obtenir(self):
        return self.etat