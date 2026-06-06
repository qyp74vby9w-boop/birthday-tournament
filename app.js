import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
    getFirestore,
    collection,
    addDoc,
    doc,
    setDoc,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyBtv2vLTZyzhTyVC58XGV1WDLjTrqKZNLA",
    authDomain: "birthday-tournament-party.firebaseapp.com",
    projectId: "birthday-tournament-party",
    storageBucket: "birthday-tournament-party.firebasestorage.app",
    messagingSenderId: "632430230630",
    appId: "1:632430230630:web:1b51f934a78d3e18fc01a7"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let selectedTournament = null;
let participants = [];
let isRegistering = false;
const brackets = {};
const bracketryInstances = {};
const bracketryDataCache = {};
const bracketSubscriptions = {};
const completedBracketExpanded = {};
let participantsSubscription = null;
let bracketryModulePromise = null;

const modal = document.getElementById("registrationModal");
const message = document.getElementById("message");
const registerBtn = document.getElementById("registerBtn");
const teamType = document.getElementById("teamType");

const tournamentNames = {
    beerpong: "Бир-понг",
    kicker: "Кикер",
    jenga: "Большая дженга"
};

document.querySelectorAll(".registerButton").forEach(btn => {

    btn.addEventListener("click", e => {

        const card = e.currentTarget.closest(".card");
        const isCurrentCard =
            modal.parentElement === card && !modal.classList.contains("hidden");

        if (isCurrentCard) {

            modal.classList.add("hidden");
            selectedTournament = null;
            clearRegistrationForm();
            return;
        }

        selectedTournament = card.dataset.tournament;

        card.appendChild(modal);
        modal.classList.remove("hidden");
    });

});

document.querySelectorAll(".participantsButton").forEach(btn => {

    btn.addEventListener("click", e => {

        const card = e.target.parentElement;
        const tournament = card.dataset.tournament;
        const list = document.getElementById(`list-${tournament}`);

        list.classList.toggle("hidden");
        e.target.textContent = list.classList.contains("hidden")
            ? "Список участников"
            : "Скрыть список";

        renderParticipantsList(tournament);

    });

});

function loadBracketryLibrary() {

    if (!bracketryModulePromise) {
        bracketryModulePromise = import(
            "https://cdn.jsdelivr.net/npm/bracketry@1.1.3/dist/esm/index.js"
        );
    }

    return bracketryModulePromise;
}

async function renderBracketry(tournament, bracket) {

    const container = document.getElementById(`bracketry-${tournament}`);
    const normalizedBracket = normalizeBracket(bracket);

    if (!container) {
        return;
    }

    if (!normalizedBracket || !normalizedBracket.rounds || normalizedBracket.rounds.length === 0) {

        if (bracketryInstances[tournament]) {
            bracketryInstances[tournament].uninstall();
            bracketryInstances[tournament] = null;
        }

        delete bracketryDataCache[tournament];
        delete completedBracketExpanded[tournament];

        container.innerHTML = `
            <div class="bracketryTournament">
                <h3>${escapeHtml(tournamentNames[tournament])}</h3>
                <p>Сетка ещё не создана</p>
            </div>
        `;
        return;
    }

    const isCompleted = isTournamentCompleted(normalizedBracket);
    if (!isCompleted) {
        completedBracketExpanded[tournament] = false;
    }
    const isExpanded = !isCompleted || completedBracketExpanded[tournament] === true;
    const bracketryData = convertBracketToBracketryData(normalizedBracket);
    const bracketryDataKey = getBracketRenderKey(
        normalizedBracket,
        isCompleted,
        isExpanded
    );

    if (
        bracketryInstances[tournament]
        && bracketryDataCache[tournament] === bracketryDataKey
    ) {
        return;
    }

    if (bracketryInstances[tournament]) {
        bracketryInstances[tournament].uninstall();
        bracketryInstances[tournament] = null;
    }

    const bracketryMatchLookup = createBracketryMatchLookup(bracketryData);

    container.innerHTML = `
        <div class="bracketryTournament">
            <h3>${escapeHtml(tournamentNames[tournament])}</h3>
            ${renderChampionCard(tournament, normalizedBracket)}
            ${renderCompletedBracketToggle(tournament, isCompleted, isExpanded)}
            ${isExpanded ? renderPreliminaryRound(tournament, normalizedBracket) : ""}
            ${isExpanded
                ? `
                    <div class="bracketryScroller">
                        <div class="bracketryWrapper"></div>
                    </div>
                `
                : ""
            }
        </div>
    `;

    if (!isExpanded) {
        bracketryDataCache[tournament] = bracketryDataKey;
        return;
    }

    const scroller = container.querySelector(".bracketryScroller");
    const wrapper = container.querySelector(".bracketryWrapper");

    enablePageWheelOverBracketry(scroller);

    try {

        const { createBracket } = await loadBracketryLibrary();

        bracketryInstances[tournament] = createBracket(
            bracketryData,
            wrapper,
            {
                verticalScrollMode: "mixed",
                useClassicalLayout: true,
                disableHighlight: true,
                matchMaxWidth: 250,
                matchMinVerticalGap: 18,
                roundTitlesFontSize: 15,
                matchFontSize: 13,
                getPlayerTitleHTML: (player, context) =>
                    getBracketryPlayerTitleHTML(
                        player,
                        context,
                        bracketryMatchLookup
                    ),
                onMatchSideClick: (match, sideIndex) => {
                    handleBracketrySideClick(
                        tournament,
                        match,
                        sideIndex
                    ).catch(error => {
                        console.error(error);
                    });
                }
            }
        );

        bracketryDataCache[tournament] = bracketryDataKey;

    } catch (error) {

        console.error(error);
        wrapper.innerHTML = "<p>Bracketry не загрузилась. Старая сетка ниже остаётся доступной.</p>";
    }
}

function isTournamentCompleted(bracket) {

    const finalRound = bracket?.rounds?.[bracket.rounds.length - 1];
    const finalMatch = finalRound?.matches?.[0];

    return Boolean(bracket?.rounds?.length && finalMatch?.winnerId);
}

function renderCompletedBracketToggle(tournament, isCompleted, isExpanded) {

    if (!isCompleted) {
        return "";
    }

    return `
        <button class="completedBracketToggle" type="button" data-action="toggle-completed-brackets" data-tournament="${tournament}">
            ${isExpanded ? "Скрыть сетки" : "Показать сетки"}
        </button>
    `;
}

function renderPreliminaryRound(tournament, bracket) {

    const matches = bracket?.preliminaryRound?.matches || [];

    if (!matches.length) {
        return "";
    }

    return `
        <div class="preliminaryRound">
            <h3>Предварительный раунд</h3>
            <div class="preliminaryMatches">
                ${matches.map(match => renderPreliminaryMatch(tournament, match)).join("")}
            </div>
        </div>
    `;
}

function renderPreliminaryMatch(tournament, match) {

    return `
        <div class="adminMatchCard preliminaryMatchCard">
            <div class="matchMeta">Матч ${match.number}</div>
            ${renderPreliminarySlot(tournament, match, "player1")}
            <div class="versus">VS</div>
            ${renderPreliminarySlot(tournament, match, "player2")}
        </div>
    `;
}

function renderPreliminarySlot(tournament, match, slot) {

    const player = match[slot];
    const isWinner = Boolean(player && match.winnerId === player.id);
    const isLoser = Boolean(player && match.winnerId && match.winnerId !== player.id);
    const slotClasses = [
        "bracket-slot",
        "preliminarySlot",
        isWinner ? "winner" : "",
        isLoser ? "loser" : ""
    ].filter(Boolean).join(" ");

    if (!player) {
        return `
            <div class="bracket-slot empty">
                <span class="slot-name">Ожидает соперника</span>
            </div>
        `;
    }

    return `
        <button class="${slotClasses}" type="button" data-action="preliminary-winner" data-tournament="${tournament}" data-match-number="${match.number}" data-winner-id="${player.id}">
            <span class="slot-name">${escapeHtml(player.label)}</span>
        </button>
    `;
}

function getBracketRenderKey(bracket, isCompleted = false, isExpanded = true) {

    const mainKey = bracket.rounds.map((round, roundIndex) => {
        const title = round.title || `Раунд ${roundIndex + 1}`;
        const matches = round.matches.map(match => [
            match.number,
            match.player1?.id || "",
            match.player2?.id || "",
            match.winnerId || ""
        ].join(":")).join("|");

        return `${title}[${matches}]`;
    }).join(";");

    const preliminaryKey = (bracket.preliminaryRound?.matches || [])
        .map(match => [
            match.number,
            match.player1?.id || "",
            match.player2?.id || "",
            match.winnerId || ""
        ].join(":"))
        .join("|");

    return `${mainKey};preliminary[${preliminaryKey}];completed:${isCompleted};expanded:${isExpanded}`;
}

function enablePageWheelOverBracketry(scroller) {

    if (!scroller || scroller.dataset.pageWheelEnabled === "true") {
        return;
    }

    scroller.dataset.pageWheelEnabled = "true";

    scroller.addEventListener("wheel", event => {

        const isVerticalWheel =
            Math.abs(event.deltaY) >= Math.abs(event.deltaX);

        if (event.shiftKey && isVerticalWheel) {
            event.preventDefault();
            event.stopImmediatePropagation();
            scroller.scrollLeft += event.deltaY;
            return;
        }

        if (isVerticalWheel) {
            event.stopImmediatePropagation();
        }
    }, {
        capture: true,
        passive: false
    });
}

function convertBracketToBracketryData(bracket) {

    const contestants = {};
    const matches = [];

    bracket.rounds.forEach((round, roundIndex) => {

        round.matches.forEach((match, matchIndex) => {

            const isFinalMatch =
                roundIndex === bracket.rounds.length - 1
                && matchIndex === 0;
            const sides = [
                convertBracketrySide(match.player1, match, isFinalMatch),
                convertBracketrySide(match.player2, match, isFinalMatch)
            ];
            const bracketryMatch = {
                roundIndex,
                order: matchIndex,
                sides
            };

            matches.push(bracketryMatch);

            [match.player1, match.player2].forEach(player => {

                if (!player || contestants[player.id]) {
                    return;
                }

                contestants[player.id] = {
                    players: splitBracketryPlayers(player.label)
                };
            });
        });
    });

    return {
        rounds: bracket.rounds.map((round, roundIndex) => ({
            name: round.title || `Раунд ${roundIndex + 1}`
        })),
        matches,
        contestants
    };
}

function convertBracketrySide(player, match, isFinalMatch = false) {

    if (!player) {
        return {
            title: "Ожидает соперника"
        };
    }

    return {
        contestantId: player.id,
        isWinner: match.winnerId === player.id,
        isChampion: isFinalMatch && match.winnerId === player.id
    };
}

function splitBracketryPlayers(label) {

    return String(label || "Без имени")
        .split(" / ")
        .map(title => ({
            title
        }));
}

function createBracketryMatchLookup(bracketryData) {

    const lookup = {};

    bracketryData.matches.forEach(match => {
        lookup[`${match.roundIndex}:${match.order}`] = match;
    });

    return lookup;
}

function getBracketryPlayerTitleHTML(player, context, bracketryMatchLookup) {

    const title = escapeHtml(player.title);
    const paddedTitle = `&nbsp;${title}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`;
    const match = bracketryMatchLookup[
        `${context.roundIndex}:${context.matchOrder}`
    ];

    if (!match || !match.sides?.some(side => side.isWinner)) {
        return title;
    }

    const side = match.sides.find(item =>
        item.contestantId === context.contestantId
    );

    if (side?.isChampion) {
        return `<span class="bracketryPlayerChampion">${paddedTitle}</span>`;
    }

    if (side?.isWinner) {
        return `<span class="bracketryPlayerWinner">${paddedTitle}</span>`;
    }

    return `<span class="bracketryPlayerLoser">${paddedTitle}</span>`;
}

async function handleBracketrySideClick(tournament, bracketryMatch, sideIndex) {

    const side = bracketryMatch.sides?.[sideIndex];
    const winnerId = side?.contestantId;

    if (!winnerId) {
        return;
    }

    const bracket = normalizeBracket(brackets[tournament]);
    const match = bracket?.rounds?.[bracketryMatch.roundIndex]
        ?.matches?.[bracketryMatch.order];

    if (!match) {
        return;
    }

    await saveMatchWinner(
        tournament,
        bracketryMatch.roundIndex,
        match.number,
        winnerId
    );
}

function getMatchWinner(match) {

    if (!match.winnerId) {
        return null;
    }

    return [match.player1, match.player2].find(player =>
        player?.id === match.winnerId
    ) || null;
}

function getPreliminaryMatchWinner(match) {

    return getMatchWinner(match);
}

function syncPreliminaryWinners(bracket) {

    if (!bracket?.preliminaryRound?.matches?.length) {
        return bracket;
    }

    const updatedBracket = JSON.parse(JSON.stringify(bracket));

    updatedBracket.preliminaryRound.matches.forEach(match => {

        const winner = getPreliminaryMatchWinner(match);
        const targetMatch = updatedBracket.rounds?.[match.targetRoundIndex]
            ?.matches
            ?.find(item => item.number === match.targetMatchNumber);

        if (!targetMatch || !match.targetSlot) {
            return;
        }

        if ((targetMatch[match.targetSlot]?.id || "") !== (winner?.id || "")) {
            targetMatch.winnerId = null;
            targetMatch.winner = null;
        }

        targetMatch[match.targetSlot] = null;
    });

    updatedBracket.preliminaryRound.matches.forEach(match => {

        const winner = getPreliminaryMatchWinner(match);
        const targetMatch = updatedBracket.rounds?.[match.targetRoundIndex]
            ?.matches
            ?.find(item => item.number === match.targetMatchNumber);

        if (!targetMatch || !match.targetSlot || !winner) {
            return;
        }

        match.winner = winner;
        targetMatch[match.targetSlot] = winner;
    });

    return recalculateBracket(updatedBracket);
}

function getTournamentChampion(bracket) {

    const finalRound = bracket?.rounds?.[bracket.rounds.length - 1];
    const finalMatch = finalRound?.matches?.[0];

    if (!finalMatch?.winnerId) {
        return null;
    }

    return getMatchWinner(finalMatch);
}

const championPrizeImages = {
    beerpong: "assets/Gold.Beer.Pong.png",
    kicker: "assets/Gold.kicker.png",
    jenga: "assets/Gold.Jenga.png"
};

function renderChampionCard(tournament, bracket) {

    const champion = getTournamentChampion(bracket);

    if (!champion) {
        return "";
    }

    const prizeImage = championPrizeImages[tournament];

    return `
        <div class="tournamentChampion">
            <div class="championPrizeWrap">
                <img
                    class="championPrize"
                    src="${prizeImage}"
                    alt=""
                    aria-hidden="true"
                />
            </div>
            <div class="championText">
                <div class="championLabel">Победитель турнира</div>
                <div class="championName">${escapeHtml(champion.label)}</div>
            </div>
        </div>
    `;
}

function normalizeBracket(bracket) {

    if (!bracket) {
        return null;
    }

    if (bracket.rounds) {
        return bracket;
    }

    const firstRoundMatches = bracket.matches || [];
    const entrantCount =
        firstRoundMatches.length * 2 + (bracket.autoAdvance ? 1 : 0);
    const bracketSize = getBracketSize(entrantCount);
    const roundCount = Math.log2(bracketSize);
    const rounds = [];

    for (let roundIndex = 0; roundIndex < roundCount; roundIndex++) {

        const matchCount = bracketSize / Math.pow(2, roundIndex + 1);

        rounds.push({
            number: roundIndex + 1,
            title: getRoundTitle(roundIndex, roundCount),
            matches: Array.from({ length: matchCount }, (_, matchIndex) => ({
                number: matchIndex + 1,
                player1: null,
                player2: null,
                winnerId: null,
                winner: null,
                isEditing: false,
                isBye: false
            }))
        });
    }

    firstRoundMatches.forEach((match, index) => {
        rounds[0].matches[index] = {
            ...rounds[0].matches[index],
            ...match
        };
    });

    if (bracket.autoAdvance && rounds[0].matches[firstRoundMatches.length]) {

        rounds[0].matches[firstRoundMatches.length].player1 =
            bracket.autoAdvance;
    }

    return recalculateBracket({
        ...bracket,
        rounds
    });
}

function getBracketSize(count) {

    if (count <= 2) {
        return 2;
    }

    return Math.pow(2, Math.ceil(Math.log2(count)));
}

function getRoundTitle(roundIndex, roundCount) {

    const remaining = roundCount - roundIndex;

    if (remaining === 1) {
        return "Финал";
    }

    if (remaining === 2) {
        return "Полуфинал";
    }

    return `Раунд ${roundIndex + 1}`;
}

function recalculateBracket(bracket) {

    const updatedBracket = normalizeBracket(
        JSON.parse(JSON.stringify(bracket))
    );

    migrateLegacyByePlacements(updatedBracket);

    updatedBracket.rounds.forEach((round, roundIndex) => {

        round.matches.forEach(match => {

            if (roundIndex > 0 && !match.manualSlots?.player1) {
                match.player1 = null;
            }

            if (roundIndex > 0 && !match.manualSlots?.player2) {
                match.player2 = null;
            }

            match.isBye = false;
            match.bye = false;
            match.byePlayerId = null;
        });
    });

    updatedBracket.rounds.forEach((round, roundIndex) => {

        round.matches.forEach(match => {

            const players = [match.player1, match.player2].filter(Boolean);

            if (players.length === 0) {

                match.winnerId = null;
                match.winner = null;
                match.isBye = false;
            }

            if (players.length === 1) {

                const onlyPlayer = players[0];

                if (match.winnerId === onlyPlayer.id) {
                    match.winner = onlyPlayer;
                } else {
                    match.winnerId = null;
                    match.winner = null;
                }
            }

            if (players.length === 2) {

                const winnerIsValid = players.some(player =>
                    player.id === match.winnerId
                );

                if (!winnerIsValid) {
                    match.winnerId = null;
                    match.winner = null;
                }
            }

            const winner = getMatchWinner(match);

            if (!winner) {
                return;
            }

            const nextMatch = getNextMatch(updatedBracket, match, roundIndex);
            const nextSlot = match.nextSlot || (
                (match.number - 1) % 2 === 0
                    ? "player1"
                    : "player2"
            );

            if (!nextMatch) {
                return;
            }

            if (!nextMatch.manualSlots?.[nextSlot]) {
                nextMatch[nextSlot] = winner;
            }
        });
    });

    return updatedBracket;
}

function migrateLegacyByePlacements(bracket) {

    const legacyPlacements = bracket.byePlacements || [];

    legacyPlacements.forEach(placement => {

        if (!placement.player || placement.migratedToWaitingMatch) {
            return;
        }

        const targetMatch = bracket.rounds[placement.roundIndex]
            ?.matches
            ?.find(match => match.number === placement.matchNumber);

        if (!targetMatch || targetMatch.winnerId) {
            return;
        }

        const sourceRoundIndex = Math.max(0, placement.roundIndex - 1);
        const sourceRound = bracket.rounds[sourceRoundIndex];

        if (!sourceRound) {
            return;
        }

        const alreadyMigrated = sourceRound.matches.some(match =>
            match.nextRoundIndex === placement.roundIndex
            && match.nextMatchNumber === placement.matchNumber
            && match.nextSlot === placement.slot
        );

        if (alreadyMigrated) {
            return;
        }

        const waitingMatch = {
            number: sourceRound.matches.length + 1,
            player1: placement.player,
            player2: null,
            winnerId: null,
            winner: null,
            isEditing: false,
            isBye: false,
            nextRoundIndex: placement.roundIndex,
            nextMatchNumber: placement.matchNumber,
            nextSlot: placement.slot,
            manualSlots: {
                player1: true
            }
        };

        sourceRound.matches.push(waitingMatch);
        placement.migratedToWaitingMatch = true;
    });

    if (legacyPlacements.length > 0) {
        bracket.byePlacements = [];
    }
}

function getNextMatch(bracket, match, roundIndex) {

    const nextRoundIndex = Number.isInteger(match.nextRoundIndex)
        ? match.nextRoundIndex
        : roundIndex + 1;
    const nextRound = bracket.rounds[nextRoundIndex];

    if (!nextRound) {
        return null;
    }

    if (Number.isInteger(match.nextMatchNumber)) {
        return nextRound.matches.find(item =>
            item.number === match.nextMatchNumber
        ) || null;
    }

    return nextRound.matches[Math.floor((match.number - 1) / 2)] || null;
}

async function saveMatchWinner(
    tournament,
    roundIndex,
    matchNumber,
    winnerId
) {

    const bracket = brackets[tournament];

    if (!bracket) {
        return false;
    }

    const updatedBracket = normalizeBracket(
        JSON.parse(JSON.stringify(bracket))
    );

    updatedBracket.rounds[roundIndex].matches =
        updatedBracket.rounds[roundIndex].matches.map(match => {

            if (match.number !== matchNumber) {
                return match;
            }

            const winner = [match.player1, match.player2].find(player =>
                player?.id === winnerId
            );

            if (!winner) {
                return match;
            }

            return {
                ...match,
                winnerId,
                winner,
                isEditing: false
            };
        });

    const recalculatedBracket = recalculateBracket(updatedBracket);

    recalculatedBracket.updatedAt = Date.now();

    await setDoc(
        doc(db, "brackets", tournament),
        recalculatedBracket
    );

    brackets[tournament] = recalculatedBracket;

    return true;
}

async function updatePreliminaryWinner(tournament, matchNumber, winnerId) {

    const bracket = brackets[tournament];

    if (!bracket?.preliminaryRound?.matches?.length) {
        return;
    }

    const updatedBracket = normalizeBracket(
        JSON.parse(JSON.stringify(bracket))
    );

    updatedBracket.preliminaryRound.matches =
        updatedBracket.preliminaryRound.matches.map(match => {

            if (match.number !== matchNumber) {
                return match;
            }

            const winner = [match.player1, match.player2].find(player =>
                player?.id === winnerId
            );

            if (!winner) {
                return match;
            }

            return {
                ...match,
                winnerId,
                winner
            };
        });

    const recalculatedBracket = syncPreliminaryWinners(updatedBracket);

    recalculatedBracket.updatedAt = Date.now();

    await setDoc(
        doc(db, "brackets", tournament),
        recalculatedBracket
    );

    brackets[tournament] = recalculatedBracket;

    await renderBracketry(tournament, recalculatedBracket);
}

document.addEventListener("click", event => {

    const completedToggle = event.target.closest(
        "[data-action='toggle-completed-brackets']"
    );

    if (completedToggle) {
        const tournament = completedToggle.dataset.tournament;

        completedBracketExpanded[tournament] =
            completedBracketExpanded[tournament] !== true;

        renderBracketry(
            tournament,
            brackets[tournament]
        ).catch(error => {
            console.error(error);
        });
        return;
    }

    const preliminaryButton = event.target.closest(
        "[data-action='preliminary-winner']"
    );

    if (!preliminaryButton) {
        return;
    }

    updatePreliminaryWinner(
        preliminaryButton.dataset.tournament,
        Number(preliminaryButton.dataset.matchNumber),
        preliminaryButton.dataset.winnerId
    ).catch(error => {
        console.error(error);
        alert("Не удалось обновить предварительный матч");
    });
});

function subscribeToBrackets() {

    Object.keys(tournamentNames).forEach(tournament => {

        if (bracketSubscriptions[tournament]) {
            return;
        }

        bracketSubscriptions[tournament] = onSnapshot(
            doc(db, "brackets", tournament),
            snapshot => {

                if (snapshot.exists()) {
                    const bracket = snapshot.data();
                    brackets[tournament] = bracket.preliminaryRound
                        ? syncPreliminaryWinners(bracket)
                        : recalculateBracket(bracket);
                } else {
                    brackets[tournament] = null;
                }

                renderBracketry(
                    tournament,
                    brackets[tournament]
                ).catch(error => {
                    console.error(error);
                });
            },
            error => {
                console.error(error);
            }
        );
    });
}

teamType.addEventListener("change", () => {

    const isTeam = teamType.value === "team";

    document
        .getElementById("singleFields")
        .classList.toggle("hidden", isTeam);

    document
        .getElementById("teamFields")
        .classList.toggle("hidden", !isTeam);

});

function normalizeName(firstName, lastName) {

    return `${firstName} ${lastName}`
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function getParticipantNames(participant) {

    if (participant.type === "team") {

        return [
            {
                firstName: participant.player1?.firstName || "",
                lastName: participant.player1?.lastName || ""
            },
            {
                firstName: participant.player2?.firstName || "",
                lastName: participant.player2?.lastName || ""
            }
        ];

    }

    return [
        {
            firstName: participant.firstName || "",
            lastName: participant.lastName || ""
        }
    ];
}

function hasDuplicateParticipant(newParticipant) {

    const newNames =
        getParticipantNames(newParticipant).map(player =>
            normalizeName(player.firstName, player.lastName)
        );

    const hasDuplicateInsideForm =
        new Set(newNames).size !== newNames.length;

    if (hasDuplicateInsideForm) {
        return true;
    }

    return participants.some(participant => {

        if (participant.tournament !== newParticipant.tournament) {
            return false;
        }

        return getParticipantNames(participant).some(player =>
            newNames.includes(
                normalizeName(player.firstName, player.lastName)
            )
        );

    });
}

function hasEmptyFields(participant) {

    return getParticipantNames(participant).some(player =>
        !player.firstName.trim() || !player.lastName.trim()
    );
}

function escapeHtml(value) {

    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function countParticipants() {

    return 1;
}

function renderParticipantsList(tournament) {

    const list = document.getElementById(`list-${tournament}`);

    if (!list || list.classList.contains("hidden")) {
        return;
    }

    const tournamentParticipants = participants
        .filter(participant => participant.tournament === tournament)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

    if (tournamentParticipants.length === 0) {

        list.innerHTML = "<p>Пока никто не записался.</p>";
        return;

    }

    list.innerHTML = tournamentParticipants
        .map(participant => {

            const names = getParticipantNames(participant)
                .map(player =>
                    escapeHtml(`${player.firstName} ${player.lastName}`.trim())
                )
                .join(" и ");

            return `<p>${names}</p>`;

        })
        .join("");
}

function updateVisibleParticipantsLists() {

    Object.keys(tournamentNames).forEach(tournament => {
        renderParticipantsList(tournament);
    });
}

function clearRegistrationForm() {

    document.getElementById("firstName").value = "";
    document.getElementById("lastName").value = "";
    document.getElementById("firstName1").value = "";
    document.getElementById("lastName1").value = "";
    document.getElementById("firstName2").value = "";
    document.getElementById("lastName2").value = "";

    teamType.value = "single";
    document.getElementById("singleFields").classList.remove("hidden");
    document.getElementById("teamFields").classList.add("hidden");
}

function subscribeToParticipants() {

    if (participantsSubscription) {
        return;
    }

    participantsSubscription = onSnapshot(
        collection(db, "participants"),
        snapshot => {

            participants = snapshot.docs.map(item => ({
                id: item.id,
                ...item.data()
            }));

            updateCounters();
            updateVisibleParticipantsLists();
        },
        error => {
            console.error(error);
        }
    );
}

function updateCounters() {

    const counts = {
        kicker: 0,
        beerpong: 0,
        jenga: 0
    };

    participants.forEach(data => {

        if (counts[data.tournament] !== undefined) {
            counts[data.tournament] += countParticipants(data);
        }

    });

    document.getElementById("count-kicker").textContent =
        counts.kicker;

    document.getElementById("count-beerpong").textContent =
        counts.beerpong;

    document.getElementById("count-jenga").textContent =
        counts.jenga;
}

registerBtn
    .addEventListener("click", async () => {

        if (isRegistering) {
            return;
        }

        try {
            isRegistering = true;
            registerBtn.disabled = true;
            registerBtn.textContent = "Сохраняем...";

            let participantData;

            if (teamType.value === "single") {

                participantData = {
                    tournament: selectedTournament,
                    type: "single",
                    firstName:
                        document.getElementById("firstName").value.trim(),
                    lastName:
                        document.getElementById("lastName").value.trim(),
                    createdAt: Date.now()
                };

            } else {

                participantData = {
                    tournament: selectedTournament,
                    type: "team",
                    player1: {
                        firstName:
                            document.getElementById("firstName1").value.trim(),
                        lastName:
                            document.getElementById("lastName1").value.trim()
                    },
                    player2: {
                        firstName:
                            document.getElementById("firstName2").value.trim(),
                        lastName:
                            document.getElementById("lastName2").value.trim()
                    },
                    createdAt: Date.now()
                };

            }

            if (hasEmptyFields(participantData)) {

                alert(
                    "Заполни имя и фамилию всех участников"
                );

                return;
            }

            if (hasDuplicateParticipant(participantData)) {

                alert(
                    "Этот участник уже зарегистрирован."
                );

                return;
            }

            await addDoc(
                collection(db, "participants"),
                participantData
            );

            message.style.display = "block";

            message.innerHTML =
                `✅ Вы успешно зарегистрированы на турнир "${tournamentNames[selectedTournament]}"`;

            modal.classList.add("hidden");
            clearRegistrationForm();

            requestAnimationFrame(() => {
                setTimeout(() => {
                    window.scrollTo({
                        top: 0,
                        behavior: "smooth"
                    });
                }, 50);
            });

        } catch (error) {

            console.error(error);

            alert(
                "Ошибка при регистрации"
            );

        } finally {

            isRegistering = false;
            registerBtn.disabled = false;
            registerBtn.textContent = "Зарегистрироваться";

        }

    });

document.querySelectorAll(".participantsList").forEach(list => {
    list.innerHTML = "<p>Загрузка...</p>";
});

let tournamentParallaxFrame = null;

function updateTournamentParallax() {

    const images = document.querySelectorAll(".tournamentBg");

    if (images.length === 0) {
        return;
    }

    images.forEach(image => {

        const card = image.closest(".card");

        if (!card) {
            return;
        }

        const rect = card.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const progress =
            (viewportHeight - rect.top) / (viewportHeight + rect.height);

        const clamped = Math.max(0, Math.min(1, progress));
        const styles = getComputedStyle(image);
        const translateY =
            (parseFloat(styles.getPropertyValue("--tournament-bg-parallax-y")) || -50)
            * clamped;
        const translateX =
            (parseFloat(styles.getPropertyValue("--tournament-bg-parallax-x")) || 30)
            * clamped;
        const baseRotate =
            parseFloat(
                styles.getPropertyValue("--tournament-bg-rotate")
            ) || 0;
        const parallaxRotate =
            parseFloat(styles.getPropertyValue("--tournament-bg-parallax-rotate"))
            || 5;
        const rotate = baseRotate + (parallaxRotate * clamped);

        image.style.transform =
            `translate3d(${translateX}px, ${translateY}px, 0) rotate(${rotate}deg)`;

    });
}

window.addEventListener(
    "scroll",
    () => {
        if (tournamentParallaxFrame) {
            return;
        }

        tournamentParallaxFrame = requestAnimationFrame(() => {
            tournamentParallaxFrame = null;
            updateTournamentParallax();
        });
    },
    { passive: true }
);

window.addEventListener("resize", updateTournamentParallax);
updateTournamentParallax();

subscribeToParticipants();
subscribeToBrackets();
