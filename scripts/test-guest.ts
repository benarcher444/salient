// Guests: someone with a game's invite link and no account joins that one
// game, plays it, and can reach nothing else. Also: a full game's link turns
// guests away, and a new link kills the old one.
//   npx tsx scripts/test-guest.ts   (server running, `npm run seed` done)
import { chromium, type Page } from "playwright";
import { DEMO_PASSWORD } from "./demo.js";
import { guestMayRequest } from "../src/guest-paths.js";

const BASE = process.env.TEST_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3100}`;

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};

console.log("\nWhat a guest may reach (no server needed)\n");
check("their game's page", guestMayRequest("GET", "/g/abc123", "abc123"));
check("its live connection", guestMayRequest("GET", "/ws/g/abc123", "abc123"));
check("assets and the rules", guestMayRequest("GET", "/static/styles.css", "abc123") && guestMayRequest("GET", "/how-to-play", "abc123"));
check("signing out", guestMayRequest("POST", "/logout", "abc123"));
check("not the lobby", !guestMayRequest("GET", "/", "abc123"));
check("not another game, or its socket", !guestMayRequest("GET", "/g/zzz999", "abc123") && !guestMayRequest("GET", "/ws/g/zzz999", "abc123"));
check("not a game whose id starts the same", !guestMayRequest("GET", "/g/abc1234", "abc123"));
check("not maps, settings or a new game", !guestMayRequest("GET", "/maps", "abc123") && !guestMayRequest("GET", "/settings", "abc123") && !guestMayRequest("POST", "/games", "abc123"));
check("not joining, leaving or replacing links", ["/join", "/leave", "/invite"].every((s) => !guestMayRequest("POST", `/g/abc123${s}`, "abc123")));

const browser = await chromium.launch({ channel: "chrome" });

async function signedIn(email: string) {
  const context = await browser.newContext({ viewport: { width: 1300, height: 860 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", DEMO_PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.includes("/login")), page.click('button[type="submit"]')]);
  return page;
}

async function newGame(page: Page, seats = 2): Promise<{ url: string; invite: string }> {
  await page.goto(`${BASE}/`);
  await page.check('input[name="map"][value="crossroads"]');
  await page.check('input[name="opponents"][value="people"]', { force: true });
  if (seats !== 2) await page.check(`input[name="seats"][value="${seats}"]`, { force: true }).catch(() => {});
  await Promise.all([page.waitForURL(/\/g\//), page.click('#new-game button[type="submit"]')]);
  return { url: page.url(), invite: await page.inputValue("#share-url") };
}

const errors: string[] = [];
const alex = await signedIn("alex@demo.local");

console.log("\nThe invite link\n");
const game = await newGame(alex);
const gameId = new URL(game.url).pathname.split("/")[2]!;
check("the waiting room shows an invite link", /\/g\/[a-z0-9]+\/invite\/[A-Za-z0-9_-]{20,}$/.test(game.invite), game.invite);

console.log("\nJoining as a guest\n");
const guestContext = await browser.newContext({ viewport: { width: 1300, height: 860 } });
const guest = await guestContext.newPage();
guest.on("pageerror", (e) => errors.push(e.message));
await guest.goto(game.invite);
check("someone signed out sees the guest form", (await guest.locator("#guest-name").count()) === 1);
await guest.screenshot({ path: "screenshots/guest-invite.png" });
await guest.fill("#guest-name", "Visitor");
await Promise.all([guest.waitForURL(new RegExp(`/g/${gameId}$`)), guest.click('form button[type="submit"]')]);
await guest.waitForSelector("#board", { timeout: 10_000 });
check("joining as a guest takes the seat and starts the game", (await guest.locator("#board").count()) === 1);
await alex.waitForSelector("#board", { timeout: 10_000 });
const board = await alex.textContent("#scoreboard");
check("the other player sees the guest by name, marked", board?.includes("Visitor (guest)") ?? false, board ?? "");

console.log("\nPlaying\n");
await guest.waitForSelector('[data-action="submit"]', { timeout: 10_000 });
await guest.click('[data-action="submit"]');
await guest.waitForSelector('[data-action="edit-orders"]', { timeout: 10_000 });
check("the guest can lock in orders", true);

console.log("\nEverything else is closed\n");
for (const path of ["/", "/maps", "/settings", "/login"]) {
  await guest.goto(`${BASE}${path}`);
  check(`${path} sends the guest back to their game`, new URL(guest.url()).pathname === `/g/${gameId}`, guest.url());
}
const other = await newGame(alex);
await guest.goto(other.url);
check("another game's page sends them back to theirs", new URL(guest.url()).pathname === `/g/${gameId}`, guest.url());
const post = await guest.request.post(`${BASE}/games`, { form: { map: "crossroads", seats: "2", opponents: "bots" }, maxRedirects: 0 });
check("starting a game is refused", post.status() === 403, String(post.status()));
const join = await guest.request.post(`${BASE}${new URL(other.url).pathname}/join`, { maxRedirects: 0 });
check("joining another game is refused", join.status() === 403, String(join.status()));
await guest.goto(other.invite);
check("even through that game's invite link", new URL(guest.url()).pathname === `/g/${gameId}`, guest.url());
const rules = await guest.goto(`${BASE}/how-to-play`);
check("the rules page stays open", rules?.status() === 200 && new URL(guest.url()).pathname === "/how-to-play");
const wsOther = await guest.evaluate(
  (id) =>
    new Promise<string>((resolve) => {
      const ws = new WebSocket(`ws://${location.host}/ws/g/${id}`);
      ws.onopen = () => resolve("open");
      ws.onerror = () => resolve("refused");
    }),
  new URL(other.url).pathname.split("/")[2]!,
);
check("another game's live connection is refused", wsOther === "refused", wsOther);

console.log("\nFull games and new links\n");
const stranger = await (await browser.newContext()).newPage();
await stranger.goto(game.invite);
check("a full game's link offers no guest seat", (await stranger.locator("#guest-name").count()) === 0 && ((await stranger.textContent("main")) ?? "").includes("no free seat"));
const forced = await stranger.request.post(game.invite, { form: { name: "Gatecrasher" }, maxRedirects: 0 });
check("and posting to it anyway is turned away", forced.status() === 409, String(forced.status()));

await alex.goto(other.url);
const oldLink = other.invite;
await Promise.all([alex.waitForURL(other.url), alex.click("#new-link")]);
const newLink = await alex.inputValue("#share-url");
check("New link replaces the link", newLink !== oldLink && newLink.includes("/invite/"), newLink);
const dead = await stranger.goto(oldLink);
check("the old link stops working", dead?.status() === 404, String(dead?.status()));
const live = await stranger.goto(newLink);
check("the new one works", live?.status() === 200 && (await stranger.locator("#guest-name").count()) === 1);

check("no page errors for the guest", errors.length === 0, errors.join(" | "));
// Tidy: cancel the unstarted game Alex made.
await alex.goto(other.url);
await alex.click('form[action$="/leave"] button').catch(() => {});

await browser.close();
console.log(failures ? `\n${failures} problem(s).` : "\nIt works.");
process.exit(failures ? 1 : 0);
