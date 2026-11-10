// New-game form: only offer as many players as the chosen map has bases.
// The list is rebuilt rather than greyed out, so 4 never shows for a map
// with two bases.
const form = document.getElementById("new-game");
if (form) {
  const seats = form.querySelector("#seats");
  const sync = () => {
    const chosen = form.querySelector('input[name="map"]:checked');
    const max = Number(chosen?.dataset.seats ?? 2);
    const keep = Math.min(Number(seats.value) || 2, max);
    seats.replaceChildren(
      ...Array.from({ length: max - 1 }, (_, i) => {
        const n = i + 2;
        return new Option(`${n} players`, String(n), false, n === keep);
      }),
    );
  };
  form.addEventListener("change", (e) => {
    if (e.target.name === "map") sync();
  });
  sync();
}
