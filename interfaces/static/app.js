import { marked } from "./marked.esm.js";

console.log("[MARKED TEST]", marked.parse("**Salut**"));

const conversation = document.getElementById("conversation");
const champMessage = document.getElementById("message");
const boutonEnvoyer = document.getElementById("envoyer");
const champEtat = document.getElementById("etat");
const boutonVocal = document.getElementById("vocal");

let vocalActif = false;
let autoScrollActif = true;
let scrollAutomatiqueEnCours = false;
const textesEtat = {
    IDLE: "En ligne",
    THINKING: "Réflexion...",
    SPEAKING: "Parle...",
    LISTENING: "Écoute..."
};

function coloriserCode(conteneur) {
    const blocsCode = conteneur.querySelectorAll("pre code");

    blocsCode.forEach((code) => {
        hljs.highlightElement(code);
    });
}

/**
 * Améliore les blocs de code générés par Marked.
 *
 * Pour chaque bloc :
 * - récupère le langage depuis la classe `language-*`
 * - ajoute un header visuel
 * - ajoute un bouton de copie
 * - garde le code intact pour Highlight.js
 */
function ameliorerBlocsCode(conteneur) {
    const blocs = conteneur.querySelectorAll("pre");

    blocs.forEach((bloc) => {
        const code = bloc.querySelector("code");

        if (!code) {
            return;
        }

        // Évite de recréer plusieurs headers pendant le streaming.
        if (bloc.dataset.ameliore === "true") {
            return;
        }

        const classeLangage = [...code.classList].find(
            classe => classe.startsWith("language-")
        );

        const langage = classeLangage
            ? classeLangage.replace("language-", "")
            : "code";

        const header = document.createElement("div");
        header.classList.add("code-header");

        const labelLangage = document.createElement("span");
        labelLangage.classList.add("code-language");
        labelLangage.textContent = langage;

        const boutonCopier = document.createElement("button");
        boutonCopier.classList.add("code-copy");
        boutonCopier.textContent = "Copier";

        boutonCopier.addEventListener("click", async () => {
            await navigator.clipboard.writeText(code.textContent);

            boutonCopier.textContent = "Copié ✓";

            setTimeout(() => {
                boutonCopier.textContent = "Copier";
            }, 1500);
        });

        header.appendChild(labelLangage);
        header.appendChild(boutonCopier);

        bloc.prepend(header);

        bloc.dataset.ameliore = "true";
    });
}

function scrollerEnBas() {
    if (!autoScrollActif) {
        return;
    }

    requestAnimationFrame(() => {
        scrollAutomatiqueEnCours = true;

        conversation.scrollTop = conversation.scrollHeight;

        requestAnimationFrame(() => {
            scrollAutomatiqueEnCours = false;
        });
    });
}

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
    autoScrollActif = true;
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
    messageElise.classList.add("message", "elise");

    conversation.appendChild(messageElise);

    let texteComplet = "";

    while (true) {
        const { value, done } = await lecteur.read();

        if (done) {
            break;
        }

        const morceau = decodeur.decode(
            value,
            { stream: true }
        );

        texteComplet += morceau;

        messageElise.innerHTML = marked.parse(texteComplet);
        coloriserCode(messageElise);
        ameliorerBlocsCode(messageElise);
        scrollerEnBas()
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
let texteEliseCourant = "";

socket.addEventListener("message", (event) => {
    const donnees = JSON.parse(event.data);

    if (donnees.type === "transcription") {
        autoScrollActif = true;
        ajouterMessage("Vous", donnees.contenu);

        messageEliseCourant = document.createElement("div");
        messageEliseCourant.classList.add("message", "elise");
        texteEliseCourant = "";
        conversation.appendChild(messageEliseCourant);
        requestAnimationFrame(() => {
    conversation.scrollTop = conversation.scrollHeight;
});
    }

    if (donnees.type === "reponse") {
    texteEliseCourant += donnees.contenu;

    messageEliseCourant.innerHTML =
        marked.parse(texteEliseCourant);
        coloriserCode(messageEliseCourant);
        ameliorerBlocsCode(messageEliseCourant);

    scrollerEnBas()
    }
    if (donnees.type === "memory_confirmation") {
        ajouterMessage("elise", donnees.content);
        scrollerEnBas();
        return;

}
});

conversation.addEventListener(
    "wheel",
    (event) => {
        if (event.deltaY < 0) {
            autoScrollActif = false;
        }
    },
    { passive: true }
);

conversation.addEventListener("scroll", () => {
    if (scrollAutomatiqueEnCours) {
        return;
    }

    const distanceDuBas =
        conversation.scrollHeight
        - conversation.scrollTop
        - conversation.clientHeight;

    if (distanceDuBas <= 5) {
        autoScrollActif = true;
    }
});

mettreAJourEtat();
setInterval(mettreAJourEtat, 300);