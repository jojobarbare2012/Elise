import { marked } from "./marked.esm.js";

creerControleService(
    "fish",
    "fish-dot",
    "fish-toggle"
);

creerControleService(
    "whisper",
    "whisper-dot",
    "whisper-toggle"
);

creerControleService(
    "qwen",
    "qwen-dot",
    "qwen-toggle"
);
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



function creerControleService(nom, dotId, boutonId) {
    const dot = document.getElementById(dotId);
    const bouton = document.getElementById(boutonId);

    let actif = false;

    function afficherEtat(nouvelEtat) {
        actif = nouvelEtat;

        dot.classList.toggle("on", actif);
        dot.classList.toggle("off", !actif);

        bouton.textContent =
            actif ? "Arrêter" : "Démarrer";
    }

    async function actualiser() {
        try {
            const reponse = await fetch(`/services/${nom}`);
            const donnees = await reponse.json();

            afficherEtat(donnees.actif);

        } catch (erreur) {
            console.error(
                `Erreur état ${nom} :`,
                erreur
            );

            afficherEtat(false);
        }
    }

    bouton.addEventListener("click", async () => {
        bouton.disabled = true;
        bouton.textContent = "...";

        const action =
            actif ? "arreter" : "demarrer";

        try {
            const reponse = await fetch(
                `/services/${nom}/${action}`,
                {
                    method: "POST"
                }
            );

            const donnees = await reponse.json();

            afficherEtat(donnees.actif);

        } catch (erreur) {
            console.error(
                `Erreur contrôle ${nom} :`,
                erreur
            );

            await actualiser();
        }

        bouton.disabled = false;
    });

    actualiser();
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



const burgerButton = document.getElementById("burger-button");
const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebar-overlay");

const navItems = document.querySelectorAll(".nav-item");
const appViews = document.querySelectorAll(".app-view");

function ouvrirSidebar() {
    sidebar.classList.add("open");
    sidebarOverlay.classList.add("visible");
}

function fermerSidebar() {
    sidebar.classList.remove("open");
    sidebarOverlay.classList.remove("visible");
}

burgerButton.addEventListener("click", ouvrirSidebar);
sidebarOverlay.addEventListener("click", fermerSidebar);

navItems.forEach((item) => {
    item.addEventListener("click", () => {
        const viewId = item.dataset.view;

        navItems.forEach((nav) => nav.classList.remove("active"));
        item.classList.add("active");

        appViews.forEach((view) => {
            view.classList.toggle("active", view.id === viewId);
        });

        fermerSidebar();
    });
});


/* =========================================================
   CALENDRIER
   ========================================================= */

const calendarGrid = document.getElementById("calendar-grid");
const calendarMonthLabel = document.getElementById("calendar-month-label");

const prevButton = document.getElementById("calendar-prev");
const nextButton = document.getElementById("calendar-next");
const todayButton = document.getElementById("calendar-today");

let dateAffichee = new Date();

function memeJour(dateA, dateB) {
    return (
        dateA.getFullYear() === dateB.getFullYear() &&
        dateA.getMonth() === dateB.getMonth() &&
        dateA.getDate() === dateB.getDate()
    );
}

function renderCalendar() {
    calendarGrid.innerHTML = "";

    const annee = dateAffichee.getFullYear();
    const mois = dateAffichee.getMonth();

    const premierJourMois = new Date(annee, mois, 1);

    // JS : dimanche = 0
    // Nous : lundi = 0
    const decalagePremierJour =
        (premierJourMois.getDay() + 6) % 7;

    const debutGrille = new Date(
        annee,
        mois,
        1 - decalagePremierJour
    );

    const formatter = new Intl.DateTimeFormat("fr-FR", {
        month: "long",
        year: "numeric"
    });

    calendarMonthLabel.textContent =
        formatter.format(premierJourMois);

    const aujourdHui = new Date();

    // 6 semaines × 7 jours
    for (let i = 0; i < 42; i++) {
        const dateCase = new Date(debutGrille);
        dateCase.setDate(debutGrille.getDate() + i);

        const day = document.createElement("div");
        day.classList.add("calendar-day");

        if (dateCase.getMonth() !== mois) {
            day.classList.add("other-month");
        }

        if (memeJour(dateCase, aujourdHui)) {
            day.classList.add("today");
        }

        const numero = document.createElement("div");
        numero.classList.add("calendar-day-number");
        numero.textContent = dateCase.getDate();

        const events = document.createElement("div");
        events.classList.add("calendar-events");

        day.appendChild(numero);
        day.appendChild(events);

        calendarGrid.appendChild(day);
    }
}

prevButton.addEventListener("click", () => {
    dateAffichee.setMonth(dateAffichee.getMonth() - 1);
    renderCalendar();
});

nextButton.addEventListener("click", () => {
    dateAffichee.setMonth(dateAffichee.getMonth() + 1);
    renderCalendar();
});

todayButton.addEventListener("click", () => {
    dateAffichee = new Date();
    renderCalendar();
});

renderCalendar();

mettreAJourEtat();
setInterval(mettreAJourEtat, 300);