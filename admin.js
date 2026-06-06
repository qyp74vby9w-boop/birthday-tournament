import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
    getFirestore,
    collection,
    getDoc,
    addDoc,
    deleteDoc,
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

let participants = [];
let isAddingParticipant = false;
const brackets = {};
const bracketSubscriptions = {};
let participantsSubscription = null;

let selectedTournament = null;

const tournamentNames = {
    beerpong: "Бир-понг",
    kicker: "Кикер",
    jenga: "Большая дженга"
};

function initAdmin() {

    const adminPanel = document.getElementById("adminPanel");

    if (adminPanel) {
        adminPanel.classList.remove("hidden");
    }

    renderLoadingState();

    subscribeToParticipants();
    subscribeToBrackets();
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

            renderAll();
        },
        error => {
            console.error(error);
        }
    );
}

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

                renderTournament(tournament);
            },
            error => {
                console.error(error);
            }
        );
    });
}

function getParticipantLabel(participant) {

    if (participant.type === "team") {
        return `${participant.player1.firstName} ${participant.player1.lastName} / ${participant.player2.firstName} ${participant.player2.lastName}`;
    }

    return `${participant.firstName} ${participant.lastName}`;
}

function createBracketEntry(participant) {

    return {
        id: participant.id,
        label: getParticipantLabel(participant)
    };
}

function shuffleParticipants(items) {

    const shuffled = [...items];

    for (let index = shuffled.length - 1; index > 0; index--) {

        const randomIndex = Math.floor(Math.random() * (index + 1));
        const current = shuffled[index];

        shuffled[index] = shuffled[randomIndex];
        shuffled[randomIndex] = current;
    }

    return shuffled;
}

function createTournamentBracket(tournament, tournamentParticipants) {

    const entries = shuffleParticipants(
        tournamentParticipants.map(createBracketEntry)
    );

    return createBracketFromEntries(tournament, entries);
}

function createBracketFromEntries(tournament, entries) {

    const firstRoundMatchCount = Math.ceil(entries.length / 2);
    const rounds = [];

    rounds.push({
        number: 1,
        title: "",
        matches: Array.from(
            { length: firstRoundMatchCount },
            (_, matchIndex) => createEmptyMatch(matchIndex + 1)
        )
    });

    rounds[0].matches.forEach((match, matchIndex) => {
        match.player1 = entries[matchIndex * 2] || null;
        match.player2 = entries[matchIndex * 2 + 1] || null;
    });

    let sources = rounds[0].matches.map(match => ({
        type: "match",
        roundIndex: 0,
        matchNumber: match.number
    }));

    while (sources.length > 1) {

        const roundIndex = rounds.length;
        const matchCount = Math.ceil(sources.length / 2);
        const round = {
            number: roundIndex + 1,
            title: "",
            matches: Array.from(
                { length: matchCount },
                (_, matchIndex) => createEmptyMatch(matchIndex + 1)
            )
        };

        rounds.push(round);

        const nextSources = [];

        round.matches.forEach((match, matchIndex) => {

            placeSource(
                sources[matchIndex * 2],
                rounds,
                roundIndex,
                match.number,
                "player1"
            );

            const secondSource = sources[matchIndex * 2 + 1];

            if (secondSource) {
                placeSource(
                    secondSource,
                    rounds,
                    roundIndex,
                    match.number,
                    "player2"
                );
            }

            nextSources.push({
                type: "match",
                roundIndex,
                matchNumber: match.number
            });
        });

        sources = nextSources;
    }

    rounds.forEach((round, roundIndex) => {
        round.title = getRoundTitle(roundIndex, rounds.length);
    });

    const bracket = recalculateBracket({
        tournament,
        rounds,
        createdAt: Date.now()
    });

    bracket.updatedAt = Date.now();

    return bracket;
}

function createPreliminaryTournamentBracket(tournament, tournamentParticipants) {

    const entries = shuffleParticipants(
        tournamentParticipants.map(createBracketEntry)
    );
    const preliminaryPlayerCount = (entries.length - 8) * 2;
    const directMainPlayersCount = entries.length - preliminaryPlayerCount;
    const mainEntries = entries.slice(0, directMainPlayersCount);
    const preliminaryEntries = entries.slice(directMainPlayersCount);
    const mainBracketEntries = [
        ...mainEntries,
        ...Array(preliminaryPlayerCount / 2).fill(null)
    ];
    const bracket = createBracketFromEntries(tournament, mainBracketEntries);

    bracket.hasPreliminary = true;
    bracket.mainSeedPlayers = mainEntries;
    bracket.directMainPlayers = mainEntries;
    bracket.mainBracketLocked = false;
    bracket.preliminaryRound = {
        title: "Предварительный раунд",
        matches: []
    };

    for (let index = 0; index < preliminaryEntries.length; index += 2) {

        const targetSlotIndex = directMainPlayersCount + index / 2;
        const targetMatch = bracket.rounds[0].matches[Math.floor(targetSlotIndex / 2)];
        const targetSlot = targetSlotIndex % 2 === 0 ? "player1" : "player2";

        bracket.preliminaryRound.matches.push({
            number: index / 2 + 1,
            player1: preliminaryEntries[index] || null,
            player2: preliminaryEntries[index + 1] || null,
            winnerId: null,
            winner: null,
            targetRoundIndex: 0,
            targetMatchNumber: targetMatch.number,
            targetSlot
        });
    }

    return syncPreliminaryWinners(bracket);
}

function createMainBracketFromPreliminary(tournament, bracket) {

    const directMainPlayers = bracket.directMainPlayers
        || bracket.mainSeedPlayers
        || [];
    const preliminaryMatches = bracket.preliminaryRound?.matches || [];
    const incompleteMatch = preliminaryMatches.some(match =>
        !getPreliminaryMatchWinner(match)
    );

    if (incompleteMatch) {
        return {
            error: "Сначала завершите все матчи предварительной сетки"
        };
    }

    const preliminaryWinners = preliminaryMatches
        .map(getPreliminaryMatchWinner)
        .filter(Boolean);
    const mainPlayers = [
        ...directMainPlayers,
        ...preliminaryWinners
    ];

    if (mainPlayers.length < 8) {
        return {
            error: "Недостаточно участников для основной сетки"
        };
    }

    if (mainPlayers.length > 8) {
        return {
            error: "Ошибка формирования основной сетки: участников больше 8"
        };
    }

    const mainBracket = createBracketFromEntries(tournament, mainPlayers);

    return {
        bracket: {
            ...mainBracket,
            hasPreliminary: true,
            preliminaryRound: {
                ...bracket.preliminaryRound,
                matches: preliminaryMatches.map(match => {
                    const winner = getPreliminaryMatchWinner(match);

                    return {
                        ...match,
                        winnerId: winner?.id || match.winnerId || null,
                        winner: winner || match.winner || null
                    };
                })
            },
            directMainPlayers,
            mainSeedPlayers: directMainPlayers,
            mainBracketLocked: false,
            preliminaryCompletedAt: Date.now()
        }
    };
}

function createEmptyMatch(number) {

    return {
        number,
        player1: null,
        player2: null,
        winnerId: null,
        winner: null,
        isEditing: false,
        isBye: false
    };
}

function placeSource(
    source,
    rounds,
    targetRoundIndex,
    targetMatchNumber,
    targetSlot
) {

    const sourceMatch = rounds[source.roundIndex].matches.find(match =>
        match.number === source.matchNumber
    );

    sourceMatch.nextRoundIndex = targetRoundIndex;
    sourceMatch.nextMatchNumber = targetMatchNumber;
    sourceMatch.nextSlot = targetSlot;
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

function renderChampionCard(bracket) {

    const champion = getTournamentChampion(bracket);

    if (!champion) {
        return "";
    }

    return `
        <div class="tournamentChampion">
            <div class="championIcon">🏆</div>
            <div class="championLabel">Победитель турнира</div>
            <div class="championName">${escapeHtml(champion.label)}</div>
        </div>
    `;
}

function recalculateBracket(bracket) {

    const updatedBracket = JSON.parse(JSON.stringify(bracket));

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

        const waitingMatch = createEmptyMatch(sourceRound.matches.length + 1);

        waitingMatch.player1 = placement.player;
        waitingMatch.player2 = null;
        waitingMatch.nextRoundIndex = placement.roundIndex;
        waitingMatch.nextMatchNumber = placement.matchNumber;
        waitingMatch.nextSlot = placement.slot;
        waitingMatch.manualSlots = {
            player1: true
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

function hasEmptyFields(participant) {

    return getParticipantNames(participant).some(player =>
        !player.firstName.trim() || !player.lastName.trim()
    );
}

function hasDuplicateParticipant(newParticipant) {

    const newNames = getParticipantNames(newParticipant).map(player =>
        normalizeName(player.firstName, player.lastName)
    );

    if (new Set(newNames).size !== newNames.length) {
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

function clearAddForm() {

    document.getElementById("adminFirstName").value = "";
    document.getElementById("adminLastName").value = "";
    document.getElementById("adminFirstName1").value = "";
    document.getElementById("adminLastName1").value = "";
    document.getElementById("adminFirstName2").value = "";
    document.getElementById("adminLastName2").value = "";

    document.getElementById("adminTeamType").value = "single";
    document.getElementById("adminSingleFields").classList.remove("hidden");
    document.getElementById("adminTeamFields").classList.add("hidden");
}

function renderTournament(tournament) {

    const participantsContainer = document.getElementById(
        `admin-${tournament}`
    );
    const bracketContainer = document.getElementById(
        `admin-bracket-${tournament}`
    );
    const participantsList = document.getElementById(
        `admin-list-${tournament}`
    );
    const shouldRenderParticipants =
        !participantsList || !participantsList.classList.contains("hidden");

    const filtered = participants.filter(
        p => p.tournament === tournament
    );

    updateAdminCounter(tournament, filtered.length);
    updatePreliminaryButtonState(tournament, filtered.length);

    if (participantsContainer && shouldRenderParticipants) {
        const participantsHtml = filtered.length === 0
            ? "<p>Список пуст</p>"
            : filtered.map(item => `
                <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:8px;">
                    <span>${escapeHtml(getParticipantLabel(item))}</span>
                    <button onclick="deleteParticipant('${item.id}')">Удалить</button>
                </div>
            `).join("");

        participantsContainer.innerHTML = participantsHtml;
    }

    if (bracketContainer) {
        bracketContainer.innerHTML = renderAdminBracketEditor(tournament);
    }
}

function updatePreliminaryButtonState(tournament, count) {

    const button = document.querySelector(
        `.createPreliminaryBracketBtn[data-tournament="${tournament}"]`
    );

    if (!button) {
        return;
    }

    const needsPreliminary = count > 8;

    button.disabled = !needsPreliminary;
    button.title = needsPreliminary
        ? ""
        : "Предварительная сетка нужна только если участников больше 8";
}

function updateAdminCounter(tournament, count) {

    const counter = document.getElementById(
        `admin-count-${tournament}`
    );

    if (counter) {
        counter.textContent = count;
    }
}

function renderAll() {

    renderTournament("beerpong");
    renderTournament("kicker");
    renderTournament("jenga");
}

function renderLoadingState() {

    Object.keys(tournamentNames).forEach(tournament => {

        const participantsContainer = document.getElementById(
            `admin-${tournament}`
        );
        const bracketContainer = document.getElementById(
            `admin-bracket-${tournament}`
        );

        if (participantsContainer) {
            participantsContainer.innerHTML = "<p>Загрузка...</p>";
        }

        if (bracketContainer) {
            bracketContainer.innerHTML = "<p>Загрузка...</p>";
        }
    });
}

function renderAdminBracketEditor(tournament) {

    const bracket = brackets[tournament];

    if (!bracket?.rounds?.length) {
        return "<div class=\"adminBracketEditor\"><p>Сетка пока не создана.</p></div>";
    }

    return `
        <div class="adminBracketEditor">
            ${renderChampionCard(bracket)}
            ${renderAdminPreliminaryRound(tournament, bracket)}
            <h3>Редактирование сетки</h3>
            <div class="adminBracketBoard">
                ${bracket.rounds.map((round, roundIndex) => `
                    <div class="adminBracketRound">
                        <h4>${escapeHtml(round.title || `Раунд ${roundIndex + 1}`)}</h4>
                        ${round.matches.map(match =>
                            renderAdminMatch(tournament, roundIndex, match)
                        ).join("")}
                    </div>
                `).join("")}
            </div>
        </div>
    `;
}

function renderAdminPreliminaryRound(tournament, bracket) {

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

function renderAdminMatch(tournament, roundIndex, match) {

    return `
        <div class="adminMatchCard">
            <div class="matchMeta">Матч ${match.number}</div>
            ${renderAdminSlot(tournament, roundIndex, match, "player1")}
            <div class="versus">VS</div>
            ${renderAdminSlot(tournament, roundIndex, match, "player2")}
        </div>
    `;
}

function renderAdminSlot(tournament, roundIndex, match, slot) {

    const player = match[slot];
    const isWinner = Boolean(player && match.winnerId === player.id);
    const isLoser = Boolean(player && match.winnerId && match.winnerId !== player.id);
    const isChampion = Boolean(
        isWinner
        && brackets[tournament]?.rounds?.length - 1 === roundIndex
    );
    const slotClasses = [
        "bracket-slot",
        isWinner ? "winner" : "",
        isLoser ? "loser" : "",
        isChampion ? "champion" : ""
    ].filter(Boolean).join(" ");

    if (!player) {
        return `
            <div class="bracket-slot empty">
                <span class="slot-name">Ожидает соперника</span>
                <button class="slot-menu-btn bracketSlotButton" type="button" data-action="add" data-tournament="${tournament}" data-round-index="${roundIndex}" data-match-number="${match.number}" data-slot="${slot}" title="Добавить участника">
                    +
                </button>
            </div>
        `;
    }

    return `
        <div class="${slotClasses}">
            <span class="slot-name">${escapeHtml(player.label)}</span>
            <button class="slot-menu-btn bracketSlotButton" type="button" data-action="menu" data-tournament="${tournament}" data-round-index="${roundIndex}" data-match-number="${match.number}" data-slot="${slot}" title="Действия со слотом">
                ⋮
            </button>
            <div class="slot-menu">
                <button class="bracketSlotButton" type="button" data-action="replace" data-tournament="${tournament}" data-round-index="${roundIndex}" data-match-number="${match.number}" data-slot="${slot}">
                    Заменить
                </button>
                <button class="bracketSlotButton danger" type="button" data-action="remove" data-tournament="${tournament}" data-round-index="${roundIndex}" data-match-number="${match.number}" data-slot="${slot}">
                    Убрать
                </button>
            </div>
        </div>
    `;
}

function escapeHtml(value) {

    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

window.deleteParticipant = async function(participantId) {

    const participant = participants.find(
        p => p.id === participantId
    );

    const participantName = participant
        ? getParticipantLabel(participant)
        : "этого участника";

    const confirmed = confirm(
        `Удалить участника: ${participantName}?`
    );

    if (!confirmed) {
        return;
    }

    try {

        await deleteDoc(
            doc(db, "participants", participantId)
        );

        participants = participants.filter(item =>
            item.id !== participantId
        );

        if (participant?.tournament) {
            renderTournament(participant.tournament);
        } else {
            renderAll();
        }

    } catch (error) {
        console.error(error);
        alert("Не удалось удалить участника");
    }
};

document.getElementById("adminPanel").addEventListener("click", event => {

    const preliminaryButton = event.target.closest(
        "[data-action='preliminary-winner']"
    );

    if (preliminaryButton) {
        event.stopPropagation();
        updatePreliminaryWinner(
            preliminaryButton.dataset.tournament,
            Number(preliminaryButton.dataset.matchNumber),
            preliminaryButton.dataset.winnerId
        ).catch(error => {
            console.error(error);
            alert("Не удалось обновить предварительный матч");
        });
        return;
    }

    const button = event.target.closest(".bracketSlotButton");

    if (!button) {
        return;
    }

    event.stopPropagation();

    const slotData = {
        tournament: button.dataset.tournament,
        roundIndex: Number(button.dataset.roundIndex),
        matchNumber: Number(button.dataset.matchNumber),
        slot: button.dataset.slot
    };

    if (button.dataset.action === "menu") {
        toggleSlotMenu(button);
        return;
    }

    if (button.dataset.action === "remove") {
        closeSlotMenus();
        removeBracketSlot(slotData).catch(error => {
            console.error(error);
            alert("Не удалось обновить сетку");
        });
        return;
    }

    closeSlotMenus();
    openBracketParticipantPicker(slotData);
});

async function updatePreliminaryWinner(tournament, matchNumber, winnerId) {

    const bracket = brackets[tournament];

    if (!bracket?.preliminaryRound?.matches?.length) {
        return;
    }

    const updatedBracket = JSON.parse(JSON.stringify(bracket));

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
    renderTournament(tournament);
}

document.addEventListener("click", event => {

    if (
        event.target.closest(".slot-menu")
        || event.target.closest(".slot-menu-btn")
    ) {
        return;
    }

    closeSlotMenus();
});

function toggleSlotMenu(button) {

    const menu = button.parentElement.querySelector(".slot-menu");

    if (!menu) {
        return;
    }

    const shouldOpen = !menu.classList.contains("open");

    closeSlotMenus();
    menu.classList.toggle("open", shouldOpen);
}

function closeSlotMenus() {

    document.querySelectorAll(".slot-menu").forEach(menu => {
        menu.classList.remove("open");
    });
}

function openBracketParticipantPicker(slotData) {

    const availableParticipants = getAvailableBracketParticipants(
        slotData.tournament
    );
    let modal = document.getElementById("bracketParticipantPicker");

    if (!modal) {
        modal = document.createElement("div");
        modal.id = "bracketParticipantPicker";
        modal.className = "bracketParticipantPicker";
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="bracketParticipantPickerInner">
            <div class="modalHeader">
                <h2>Выбрать участника</h2>
                <button id="closeBracketParticipantPicker" type="button">Закрыть</button>
            </div>
            <div class="bracketParticipantPickerList">
                ${
                    availableParticipants.length === 0
                        ? "<p>Нет свободных участников.</p>"
                        : availableParticipants.map(participant => `
                            <button class="bracketParticipantOption" data-participant-id="${participant.id}">
                                ${escapeHtml(getParticipantLabel(participant))}
                            </button>
                        `).join("")
                }
            </div>
        </div>
    `;

    modal.classList.remove("hidden");

    modal.querySelector("#closeBracketParticipantPicker")
        .addEventListener("click", () => {
            modal.classList.add("hidden");
        });

    modal.querySelectorAll(".bracketParticipantOption").forEach(option => {
        option.addEventListener("click", () => {
            const participant = participants.find(item =>
                item.id === option.dataset.participantId
            );

            if (!participant) {
                return;
            }

            option.disabled = true;
            option.textContent = "Сохраняем...";

            updateBracketSlot(
                slotData,
                createBracketEntry(participant)
            ).then(() => {
                modal.classList.add("hidden");
            }).catch(error => {
                console.error(error);
                alert("Не удалось обновить сетку");
            });
        });
    });
}

function getAvailableBracketParticipants(tournament) {

    const usedParticipantIds = getBracketParticipantIds(brackets[tournament]);

    return participants.filter(participant =>
        participant.tournament === tournament
        && !usedParticipantIds.has(participant.id)
    );
}

function getBracketParticipantIds(bracket) {

    const ids = new Set();

    (bracket?.rounds || []).forEach(round => {
        round.matches.forEach(match => {
            [match.player1, match.player2].forEach(player => {
                if (player?.id) {
                    ids.add(player.id);
                }
            });
        });
    });

    (bracket?.preliminaryRound?.matches || []).forEach(match => {
        [match.player1, match.player2].forEach(player => {
            if (player?.id) {
                ids.add(player.id);
            }
        });
    });

    return ids;
}

async function removeBracketSlot(slotData) {

    const confirmed = confirm("Убрать участника из этого слота?");

    if (!confirmed) {
        return;
    }

    await updateBracketSlot(slotData, null);
}

async function updateBracketSlot(slotData, player) {

    const bracket = brackets[slotData.tournament];

    if (!bracket) {
        return;
    }

    const updatedBracket = JSON.parse(JSON.stringify(bracket));
    const match = updatedBracket.rounds[slotData.roundIndex]
        ?.matches
        ?.find(item => item.number === slotData.matchNumber);

    if (!match) {
        return;
    }

    match[slotData.slot] = player;
    match.manualSlots = {
        ...(match.manualSlots || {}),
        [slotData.slot]: true
    };
    match.winnerId = null;
    match.winner = null;
    match.isEditing = false;

    const recalculatedBracket = recalculateBracket(updatedBracket);

    recalculatedBracket.updatedAt = Date.now();

    await setDoc(
        doc(db, "brackets", slotData.tournament),
        recalculatedBracket
    );

    brackets[slotData.tournament] = recalculatedBracket;
}

document
.querySelectorAll(".adminParticipantsToggle")
.forEach(button => {

    button.addEventListener("click", () => {

        const tournament = button.dataset.tournament;
        const list = document.getElementById(
            `admin-list-${tournament}`
        );

        if (!list) {
            return;
        }

        list.classList.toggle("hidden");
        const counter = document.getElementById(
            `admin-count-${tournament}`
        );
        const count = counter?.textContent || "0";

        button.innerHTML = list.classList.contains("hidden")
            ? `Список участников (<span id="admin-count-${tournament}">${count}</span>)`
            : `Скрыть список (<span id="admin-count-${tournament}">${count}</span>)`;

        if (!list.classList.contains("hidden")) {
            renderTournament(tournament);
        }
    });
});

document
.querySelectorAll(".clearTournamentBtn")
.forEach(button => {

    button.addEventListener("click", async () => {

        const tournament =
            button.dataset.tournament;

        const confirmed = confirm(
            `Очистить список турнира «${tournamentNames[tournament]}»?`
        );

        if (!confirmed) {
            return;
        }

        const originalButtonText = button.textContent;

        button.disabled = true;
        button.textContent = "Очищаем...";

        try {

            const toDelete = participants.filter(
                p => p.tournament === tournament
            );

            await Promise.all(
                toDelete.map(participant =>
                    deleteDoc(
                        doc(db, "participants", participant.id)
                    )
                )
            );

            participants = participants.filter(
                p => p.tournament !== tournament
            );

            renderTournament(tournament);

        } catch (error) {
            console.error(error);
            alert("Не удалось очистить список");
        } finally {
            button.disabled = false;
            button.textContent = originalButtonText;
        }
    });
});

document
.querySelectorAll(".createBracketBtn")
.forEach(button => {

    button.addEventListener("click", async () => {

        const tournament = button.dataset.tournament;
        const bracketRef = doc(db, "brackets", tournament);
        const originalButtonText = button.textContent;

        button.disabled = true;
        button.textContent = "Сохраняем...";

        try {

            const tournamentParticipants = participants.filter(
                participant => participant.tournament === tournament
            );

            if (tournamentParticipants.length < 2) {

                alert("Для создания сетки нужно минимум 2 участника");
                return;
            }

            const existingBracketSnapshot = await getDoc(bracketRef);
            const existingBracket = existingBracketSnapshot.exists()
                ? existingBracketSnapshot.data()
                : null;

            if (existingBracket?.preliminaryRound?.matches?.length) {

                const result = createMainBracketFromPreliminary(
                    tournament,
                    existingBracket
                );

                if (result.error) {
                    alert(result.error);
                    return;
                }

                await setDoc(
                    bracketRef,
                    result.bracket
                );

                brackets[tournament] = result.bracket;

                alert(`Сетка турнира «${tournamentNames[tournament]}» создана`);
                renderTournament(tournament);
                return;
            }

            if (tournamentParticipants.length > 8) {

                alert("Для турниров больше 8 участников используйте предварительную сетку");
                return;
            }

            if (existingBracketSnapshot.exists()) {

                const confirmed = confirm(
                    "Пересоздать сетку заново из всех текущих участников?"
                );

                if (!confirmed) {
                    return;
                }

                await deleteDoc(bracketRef);
            }

            const bracket = createTournamentBracket(
                tournament,
                tournamentParticipants
            );

            await setDoc(
                bracketRef,
                bracket
            );

            brackets[tournament] = bracket;

            alert(`Сетка турнира «${tournamentNames[tournament]}» создана`);

        } catch (error) {
            console.error(error);
            alert("Не удалось создать сетку");
        } finally {
            button.disabled = false;
            button.textContent = originalButtonText;
        }
    });
});

document
.querySelectorAll(".createPreliminaryBracketBtn")
.forEach(button => {

    button.addEventListener("click", async () => {

        const tournament = button.dataset.tournament;
        const bracketRef = doc(db, "brackets", tournament);
        const originalButtonText = button.textContent;

        button.disabled = true;
        button.textContent = "Сохраняем...";

        try {

            const tournamentParticipants = participants.filter(
                participant => participant.tournament === tournament
            );

            if (tournamentParticipants.length <= 8) {
                alert("Предварительная сетка нужна только если участников больше 8");
                return;
            }

            if (tournamentParticipants.length > 16) {
                alert("Один предварительный раунд поддерживает максимум 16 участников");
                return;
            }

            const existingBracket = await getDoc(bracketRef);

            if (existingBracket.exists()) {

                const confirmed = confirm(
                    "Пересоздать сетку заново из всех текущих участников?"
                );

                if (!confirmed) {
                    return;
                }

                await deleteDoc(bracketRef);
            }

            const bracket = createPreliminaryTournamentBracket(
                tournament,
                tournamentParticipants
            );

            await setDoc(
                bracketRef,
                bracket
            );

            brackets[tournament] = bracket;

            alert(
                `Предварительная сетка турнира «${tournamentNames[tournament]}» создана`
            );

        } catch (error) {
            console.error(error);
            alert("Не удалось создать предварительную сетку");
        } finally {

            button.disabled = false;
            button.textContent = originalButtonText;
        }
    });
});

document
.querySelectorAll(".resetBracketBtn")
.forEach(button => {

    button.addEventListener("click", async () => {

        const tournament = button.dataset.tournament;
        const confirmed = confirm(
            `Сбросить сетку турнира «${tournamentNames[tournament]}»? Участники останутся в списке.`
        );

        if (!confirmed) {
            return;
        }

        const originalButtonText = button.textContent;

        button.disabled = true;
        button.textContent = "Сохраняем...";

        try {
            await deleteDoc(
                doc(db, "brackets", tournament)
            );

            brackets[tournament] = null;
            renderTournament(tournament);
        } catch (error) {
            console.error(error);
            alert("Не удалось сбросить сетку");
        } finally {
            button.disabled = false;
            button.textContent = originalButtonText;
        }
    });
});

document
.querySelectorAll(".addParticipantBtn")
.forEach(button => {

    button.addEventListener("click", () => {

        const card = button.closest(".card");
        const adminAddModal = document.getElementById("adminAddModal");
        const isCurrentCard =
            adminAddModal.parentElement === card
            && !adminAddModal.classList.contains("hidden");

        if (isCurrentCard) {

            adminAddModal.classList.add("hidden");
            selectedTournament = null;
            clearAddForm();
            return;
        }

        selectedTournament = button.dataset.tournament;

        document.getElementById("adminAddTitle").textContent =
            `Добавить участника: ${tournamentNames[selectedTournament]}`;

        clearAddForm();
        card.appendChild(adminAddModal);
        adminAddModal.classList.remove("hidden");
    });
});

document
.getElementById("adminTeamType")
.addEventListener("change", () => {

    const isTeam = document.getElementById("adminTeamType").value === "team";

    document.getElementById("adminSingleFields").classList.toggle("hidden", isTeam);
    document.getElementById("adminTeamFields").classList.toggle("hidden", !isTeam);
});

document
.getElementById("adminCancelAddBtn")
.addEventListener("click", () => {

    document.getElementById("adminAddModal").classList.add("hidden");
    clearAddForm();
    selectedTournament = null;
});

document
.getElementById("adminSaveParticipantBtn")
.addEventListener("click", async () => {

    if (isAddingParticipant) {
        return;
    }

    const adminSaveParticipantBtn =
        document.getElementById("adminSaveParticipantBtn");

    try {

        isAddingParticipant = true;
        adminSaveParticipantBtn.disabled = true;
        adminSaveParticipantBtn.textContent = "Добавление...";

        let participantData;
        const adminTeamType = document.getElementById("adminTeamType").value;

        if (adminTeamType === "single") {

            participantData = {
                tournament: selectedTournament,
                type: "single",
                firstName: document.getElementById("adminFirstName").value.trim(),
                lastName: document.getElementById("adminLastName").value.trim(),
                createdAt: Date.now()
            };

        } else {

            participantData = {
                tournament: selectedTournament,
                type: "team",
                player1: {
                    firstName: document.getElementById("adminFirstName1").value.trim(),
                    lastName: document.getElementById("adminLastName1").value.trim()
                },
                player2: {
                    firstName: document.getElementById("adminFirstName2").value.trim(),
                    lastName: document.getElementById("adminLastName2").value.trim()
                },
                createdAt: Date.now()
            };
        }

        if (hasEmptyFields(participantData)) {
            alert("Заполни имя и фамилию всех участников");
            return;
        }

        if (hasDuplicateParticipant(participantData)) {
            alert("Этот участник уже записан на выбранный турнир");
            return;
        }

        const participantRef = await addDoc(
            collection(db, "participants"),
            participantData
        );

        const savedParticipant = {
            id: participantRef.id,
            ...participantData
        };

        participants.push(savedParticipant);
        renderTournament(savedParticipant.tournament);

        document.getElementById("adminAddModal").classList.add("hidden");
        clearAddForm();

        document.getElementById("adminMessage").style.display = "block";
        document.getElementById("adminMessage").innerHTML =
            `✅ Участник добавлен в турнир «${tournamentNames[selectedTournament]}»`;

    } catch (error) {

        console.error(error);

        alert("Ошибка при добавлении участника");

    } finally {

        isAddingParticipant = false;
        adminSaveParticipantBtn.disabled = false;
        adminSaveParticipantBtn.textContent = "Добавить";
    }
});

initAdmin();
