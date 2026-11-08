// New-game form: only offer as many players as the chosen map seats.
const form = document.getElementById("new-game");
if (form) {
  const seats = form.querySelector("#seats");
  const sync = () => {
    const chosen = form.querySelector('input[name="map"]:checked');
    const max = Number(chosen?.dataset.seats ?? 2);
    for (const option of seats.options) option.disabled = Number(option.value) > max;
    if (Number(seats.value) > max) seats.value = String(max);
  };
  form.addEventListener("change", sync);
  sync();
}
