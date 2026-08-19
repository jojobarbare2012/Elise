
const conversation = document.getElementById("conversation");
const champMessage = document.getElementById("message");
const boutonEnvoyer = document.getElementById("envoyer");
const champEtat = document.getElementById("etat");
const boutonVocal = document.getElementById("vocal");

let vocalActif = false;

const textesEtat = {
    IDLE: "En ligne",
    THINKING: "Réflexion...",
    SPEAKING: "Parle...",
    LISTENING: "Écoute..."
};

function ajouterMessage(auteur, texte) {
    const message = document.createElement("div");

    message.classList.add("message");
    message.classList.add(
        auteur === "Vous" ? "user" : "elise"
    );

    message.textContent = texte;
    conversation.appendChild(message);

    return message;
}

async function envoyerMessage() {
    const texte = champMessage.value.trim();

    if (!texte) {
        return;
    }

    ajouterMessage("Vous", texte);
    champMessage.value = "";

    const reponse = await fetch("/message-stream", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            message: texte
        })
    });

    const lecteur = reponse.body.getReader();
    const decodeur = new TextDecoder();

    const messageElise = document.createElement("div");
    messageElise.textContent = "Élise : ";
    conversation.appendChild(messageElise);

    while (true) {
        const { value, done } = await lecteur.read();

        if (done) {
            break;
        }

        const morceau = decodeur.decode(
            value,
            { stream: true }
        );

        messageElise.textContent += morceau;
        conversation.scrollTop = conversation.scrollHeight;
    }
}

boutonEnvoyer.addEventListener("click", envoyerMessage);
champMessage.addEventListener("keydown", function (e) {
    if (e.key === 'Enter') {
      envoyerMessage()
    }
});

async function mettreAJourEtat() {
    const reponse = await fetch("/etat");
    const donnees = await reponse.json();
    if (donnees.etat in textesEtat){
        champEtat.textContent = textesEtat[donnees.etat];
    }

}


async function basculerVocal() {
    const route = vocalActif
        ? "/vocal/desactiver"
        : "/vocal/activer";

    const reponse = await fetch(route, {
        method: "POST"
    });

    const donnees = await reponse.json();

    vocalActif = donnees.vocal_actif;

    boutonVocal.textContent = vocalActif
        ? "Désactiver le vocal"
        : "Activer le vocal";
}

boutonVocal.addEventListener("click", basculerVocal);

const socket = new WebSocket("ws://127.0.0.1:8000/ws");

socket.addEventListener("open", () => {
    console.log("WebSocket connecté");
});

let messageEliseCourant = null;

socket.addEventListener("message", (event) => {
    const donnees = JSON.parse(event.data);

    if (donnees.type === "transcription") {
        ajouterMessage("Vous", donnees.contenu);

        messageEliseCourant = document.createElement("div");
        messageEliseCourant.classList.add("message", "elise");
        conversation.appendChild(messageEliseCourant);
        conversation.scrollTop = conversation.scrollHeight;
    }

    if (donnees.type === "reponse") {
        messageEliseCourant.textContent += donnees.contenu;
    }
});



mettreAJourEtat();
setInterval(mettreAJourEtat, 300);