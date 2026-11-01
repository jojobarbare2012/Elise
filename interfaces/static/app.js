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

const protocoleWs = location.protocol === "https:" ? "wss:" : "ws:";
const socket = new WebSocket(`${protocoleWs}//${location.host}/ws`);

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
    if (donnees.type === "calendrier_modifie") {
        chargerEvenements();
        return;
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

        // Rattrape une notification manquée (WebSocket coupé, onglet en veille).
        if (viewId === "calendar-view") {
            chargerEvenements();
        }

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

// Événements de la grille affichée, rangés par jour : "YYYY-MM-DD" → [événements]
let evenementsParJour = new Map();
let numeroRequeteCalendrier = 0;

const MAX_EVENEMENTS_PAR_CASE = 3;
const NOMBRE_CASES_GRILLE = 42;

function memeJour(dateA, dateB) {
    return (
        dateA.getFullYear() === dateB.getFullYear() &&
        dateA.getMonth() === dateB.getMonth() &&
        dateA.getDate() === dateB.getDate()
    );
}

function deuxChiffres(nombre) {
    return String(nombre).padStart(2, "0");
}

// "YYYY-MM-DD" en heure locale (toISOString passerait en UTC).
function cleJour(date) {
    return `${date.getFullYear()}-${deuxChiffres(date.getMonth() + 1)}-${deuxChiffres(date.getDate())}`;
}

// Même format que le backend : heure locale sans fuseau.
function dateLocaleIso(date) {
    return `${cleJour(date)}T${deuxChiffres(date.getHours())}:${deuxChiffres(date.getMinutes())}:${deuxChiffres(date.getSeconds())}`;
}

function calculerDebutGrille() {
    const premierJourMois = new Date(
        dateAffichee.getFullYear(),
        dateAffichee.getMonth(),
        1
    );

    // JS : dimanche = 0
    // Nous : lundi = 0
    const decalagePremierJour =
        (premierJourMois.getDay() + 6) % 7;

    return new Date(
        premierJourMois.getFullYear(),
        premierJourMois.getMonth(),
        1 - decalagePremierJour
    );
}

async function chargerEvenements() {
    const numeroRequete = ++numeroRequeteCalendrier;

    const debutGrille = calculerDebutGrille();
    const finGrille = new Date(debutGrille);
    finGrille.setDate(debutGrille.getDate() + NOMBRE_CASES_GRILLE);

    const parametres = new URLSearchParams({
        debut: dateLocaleIso(debutGrille),
        fin: dateLocaleIso(finGrille)
    });

    try {
        const reponse = await fetch(`/calendrier/evenements?${parametres}`);

        if (!reponse.ok) {
            throw new Error(`HTTP ${reponse.status}`);
        }

        const donnees = await reponse.json();

        // Une réponse plus récente est déjà arrivée (changement de mois rapide).
        if (numeroRequete !== numeroRequeteCalendrier) {
            return;
        }

        evenementsParJour = new Map();

        for (const evenement of donnees.evenements) {
            const jour = evenement.debut.slice(0, 10);

            if (!evenementsParJour.has(jour)) {
                evenementsParJour.set(jour, []);
            }

            evenementsParJour.get(jour).push(evenement);
        }

        renderCalendar();

        // Le popup ouvert suit les modifications faites par Élise.
        if (jourPopupOuvert !== null) {
            remplirPopupJour(jourPopupOuvert);
        }

    } catch (erreur) {
        console.error("Erreur chargement calendrier :", erreur);
    }
}

function creerElementEvenement(evenement) {
    const element = document.createElement("div");
    element.classList.add("calendar-event");

    const heureDebut = evenement.debut.slice(11, 16);
    const heureFin = evenement.fin ? evenement.fin.slice(11, 16) : null;

    if (!evenement.jour_entier) {
        const heure = document.createElement("span");
        heure.classList.add("calendar-event-heure");
        heure.textContent = heureDebut;
        element.appendChild(heure);
    }

    element.appendChild(document.createTextNode(evenement.titre));

    const details = [evenement.titre];

    if (evenement.jour_entier) {
        details.push("Toute la journée");
    } else {
        details.push(heureFin ? `${heureDebut} – ${heureFin}` : heureDebut);
    }

    if (evenement.lieu) {
        details.push(evenement.lieu);
    }

    if (evenement.description) {
        details.push(evenement.description);
    }

    element.title = details.join("\n");

    return element;
}

function renderCalendar() {
    calendarGrid.innerHTML = "";

    const annee = dateAffichee.getFullYear();
    const mois = dateAffichee.getMonth();

    const premierJourMois = new Date(annee, mois, 1);
    const debutGrille = calculerDebutGrille();

    const formatter = new Intl.DateTimeFormat("fr-FR", {
        month: "long",
        year: "numeric"
    });

    calendarMonthLabel.textContent =
        formatter.format(premierJourMois);

    const aujourdHui = new Date();

    // 6 semaines × 7 jours
    for (let i = 0; i < NOMBRE_CASES_GRILLE; i++) {
        const dateCase = new Date(debutGrille);
        dateCase.setDate(debutGrille.getDate() + i);

        const day = document.createElement("div");
        day.classList.add("calendar-day");
        day.dataset.jour = cleJour(dateCase);

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

        const evenementsDuJour =
            evenementsParJour.get(cleJour(dateCase)) || [];

        evenementsDuJour
            .slice(0, MAX_EVENEMENTS_PAR_CASE)
            .forEach((evenement) => {
                events.appendChild(creerElementEvenement(evenement));
            });

        const restants =
            evenementsDuJour.length - MAX_EVENEMENTS_PAR_CASE;

        if (restants > 0) {
            const plus = document.createElement("div");
            plus.classList.add("calendar-event-plus");
            plus.textContent = `+${restants} autre${restants > 1 ? "s" : ""}`;
            plus.title = evenementsDuJour
                .slice(MAX_EVENEMENTS_PAR_CASE)
                .map((evenement) => evenement.titre)
                .join("\n");
            events.appendChild(plus);
        }

        day.appendChild(numero);
        day.appendChild(events);

        calendarGrid.appendChild(day);
    }
}

/* ---------------------------------------------------------
   Popup des événements d'un jour (appui long sur une case)
   --------------------------------------------------------- */

const popupFond = document.getElementById("calendar-popup-fond");
const popupTitre = document.getElementById("calendar-popup-titre");
const popupListe = document.getElementById("calendar-popup-liste");
const popupFermer = document.getElementById("calendar-popup-fermer");

const DUREE_APPUI_LONG_MS = 500;
const TOLERANCE_MOUVEMENT_PX = 10;

let jourPopupOuvert = null;
let minuteurAppui = null;
let positionAppui = null;

const formatJourPopup = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long"
});

const formatJourCourt = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short"
});

function texteHorairePopup(evenement, jour) {
    if (evenement.jour_entier) {
        return "Toute la journée";
    }

    const heureDebut = evenement.debut.slice(11, 16);

    if (!evenement.fin) {
        return heureDebut;
    }

    const heureFin = evenement.fin.slice(11, 16);

    if (evenement.fin.slice(0, 10) === jour) {
        return `${heureDebut} – ${heureFin}`;
    }

    const jourFin = new Date(`${evenement.fin.slice(0, 10)}T00:00:00`);
    return `${heureDebut} → ${formatJourCourt.format(jourFin)} ${heureFin}`;
}

function remplirPopupJour(jour) {
    popupTitre.textContent =
        formatJourPopup.format(new Date(`${jour}T00:00:00`));

    popupListe.innerHTML = "";

    const evenements = evenementsParJour.get(jour) || [];

    if (evenements.length === 0) {
        const vide = document.createElement("div");
        vide.classList.add("calendar-popup-vide");
        vide.textContent = "Aucun événement ce jour-là.";
        popupListe.appendChild(vide);
        return;
    }

    for (const evenement of evenements) {
        const bloc = document.createElement("div");
        bloc.classList.add("calendar-popup-evenement");

        const horaire = document.createElement("div");
        horaire.classList.add("calendar-popup-heure");
        horaire.textContent = texteHorairePopup(evenement, jour);

        const titre = document.createElement("div");
        titre.classList.add("calendar-popup-titre-evenement");
        titre.textContent = evenement.titre;

        bloc.append(horaire, titre);

        for (const detail of [evenement.lieu, evenement.description]) {
            if (detail) {
                const ligne = document.createElement("div");
                ligne.classList.add("calendar-popup-detail");
                ligne.textContent = detail;
                bloc.appendChild(ligne);
            }
        }

        popupListe.appendChild(bloc);
    }
}

function ouvrirPopupJour(jour) {
    jourPopupOuvert = jour;
    remplirPopupJour(jour);
    popupFond.hidden = false;
}

function fermerPopupJour() {
    jourPopupOuvert = null;
    popupFond.hidden = true;
}

function annulerAppuiLong() {
    clearTimeout(minuteurAppui);
    minuteurAppui = null;
    positionAppui = null;
}

calendarGrid.addEventListener("pointerdown", (event) => {
    const caseJour = event.target.closest(".calendar-day");

    if (!caseJour || (event.pointerType === "mouse" && event.button !== 0)) {
        return;
    }

    annulerAppuiLong();
    positionAppui = { x: event.clientX, y: event.clientY };

    minuteurAppui = setTimeout(() => {
        minuteurAppui = null;
        positionAppui = null;

        if (navigator.vibrate) {
            navigator.vibrate(15);
        }

        ouvrirPopupJour(caseJour.dataset.jour);
    }, DUREE_APPUI_LONG_MS);
});

// Le doigt qui bouge (défilement de la grille) annule l'appui long.
calendarGrid.addEventListener("pointermove", (event) => {
    if (positionAppui === null) {
        return;
    }

    const distance = Math.hypot(
        event.clientX - positionAppui.x,
        event.clientY - positionAppui.y
    );

    if (distance > TOLERANCE_MOUVEMENT_PX) {
        annulerAppuiLong();
    }
});

["pointerup", "pointercancel", "pointerleave"].forEach((type) => {
    calendarGrid.addEventListener(type, annulerAppuiLong);
});

// Pas de menu contextuel natif sur les cases (appui long Android).
calendarGrid.addEventListener("contextmenu", (event) => {
    if (event.target.closest(".calendar-day")) {
        event.preventDefault();
    }
});

popupFermer.addEventListener("click", fermerPopupJour);

popupFond.addEventListener("click", (event) => {
    if (event.target === popupFond) {
        fermerPopupJour();
    }
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && jourPopupOuvert !== null) {
        fermerPopupJour();
    }
});

// Changement de mois : on dessine tout de suite la grille, puis on charge
// les événements du nouveau mois.
function changerMois(nouvelleDate) {
    dateAffichee = nouvelleDate;
    renderCalendar();
    chargerEvenements();
}

prevButton.addEventListener("click", () => {
    changerMois(new Date(
        dateAffichee.getFullYear(),
        dateAffichee.getMonth() - 1,
        1
    ));
});

nextButton.addEventListener("click", () => {
    changerMois(new Date(
        dateAffichee.getFullYear(),
        dateAffichee.getMonth() + 1,
        1
    ));
});

todayButton.addEventListener("click", () => {
    changerMois(new Date());
});

renderCalendar();
chargerEvenements();

mettreAJourEtat();
setInterval(mettreAJourEtat, 300);