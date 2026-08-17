const conversation = document.getElementById("conversation");
const champMessage = document.getElementById("message");
const boutonEnvoyer = document.getElementById("envoyer");

function ajouterMessage(auteur, texte) {
    const message = document.createElement("div");

    message.textContent = `${auteur} : ${texte}`;

    conversation.appendChild(message);
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
    }
}

boutonEnvoyer.addEventListener("click", envoyerMessage);
champMessage.addEventListener("keydown", function (e) {
    if (e.key === 'Enter') {
      envoyerMessage()
    }
});