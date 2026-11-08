// Waiting room: copy the invite link, and reload when the game starts or the
// player list changes, so nobody has to refresh by hand.
const { gameId } = window.SALIENT_WAIT;

const copy = document.getElementById("copy-link");
const input = document.getElementById("share-url");
if (copy && input) {
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(input.value);
      copy.querySelector("span").textContent = "Copied";
    } catch {
      // Clipboard refused (insecure context or permissions): select it for a manual copy.
      input.select();
    }
  });
}

const proto = location.protocol === "https:" ? "wss" : "ws";
let first = true;
function connect() {
  const socket = new WebSocket(`${proto}://${location.host}/ws/g/${encodeURIComponent(gameId)}`);
  socket.addEventListener("message", (e) => {
    const m = JSON.parse(String(e.data));
    // The first message is the current state; anything after it is a change.
    if (first) {
      first = false;
      if (m.type === "state") location.reload();
      return;
    }
    location.reload();
  });
  socket.addEventListener("close", (e) => {
    if (e.code !== 4404) setTimeout(connect, 3000);
  });
}
connect();
