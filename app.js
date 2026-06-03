let selectedTournament = null;

const modal = document.getElementById("registrationModal");

document.querySelectorAll(".card button").forEach(btn => {

    btn.addEventListener("click", e => {

        selectedTournament =
            e.target.parentElement.dataset.tournament;

        modal.classList.remove("hidden");
    });

});

const teamType =
    document.getElementById("teamType");

teamType.addEventListener("change", () => {

    const isTeam =
        teamType.value === "team";

    document
        .getElementById("singleFields")
        .classList.toggle("hidden", isTeam);

    document
        .getElementById("teamFields")
        .classList.toggle("hidden", !isTeam);

});

document
    .getElementById("registerBtn")
    .addEventListener("click", () => {

        alert(
            `Регистрация в ${selectedTournament}`
        );

});
