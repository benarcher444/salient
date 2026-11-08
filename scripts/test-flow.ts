// A whole game between two real browsers, driven by clicking the canvas and
// the panel the way a player does: create, share, join, deploy, march, shoot.
// Proves the parts no unit test reaches: the WebSocket, the per-player views,
// the taps, the panel buttons and the server's validation of what they send.
//   npx tsx scripts/test-flow.ts   (server running, `npm run seed` done)
import { chromium, type Page } from "playwright";
import { DEMO_PASSWORD } from "./demo.js";

const BASE = process.env.TEST_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3100}`;
const browser = await chromium.launch({ channel: "chrome" });

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};

interface Hooks {
  screenOf(x: number, y: number): { x: number; y: number };
  myUnits(): { id: number; x: number; y: number; kind: string; hp: number }[];
  enemyUnits(): { id: number; x: number; y: number; kind: string; hp: number }[];
  spawnTiles(): { x: number; y: number }[];
  reach(id: number): { x: number; y: number }[];
  targets(id: number): number[];
  readyShooters(): number[];
  phase(): { phase: string; round: number; attackTurn: number | null; ready: boolean[] } | null;
  busy(): boolean;
  log(): string[];
}
// The hooks appear once the page's module has run, a moment after the HTML.
const hooks = <T>(page: Page, fn: (h: Hooks) => T) =>
  page.evaluate(`window.__salient ? (${fn.toString()})(window.__salient) : null`) as Promise<T>;

async function player(email: string) {
  const context = await browser.newContext({ viewport: { width: 1300, height: 860 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", DEMO_PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 10_000 }), page.click('button[type="submit"]')]);
  return { page, errors, context };
}

async function tapTile(page: Page, x: number, y: number) {
  const p = await page.evaluate(`window.__salient.screenOf(${x}, ${y})`) as { x: number; y: number };
  await page.mouse.click(p.x, p.y);
}

async function waitFor(page: Page, what: string, test: () => Promise<boolean>, timeout = 10_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await test().catch(() => false)) return true;
    await page.waitForTimeout(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const alex = await player("alex@demo.local");
const sam = await player("sam@demo.local");

console.log("\nCreating and joining a game\n");
await alex.page.goto(`${BASE}/`);
await alex.page.check('input[name="map"][value="crossroads"]');
await alex.page.check('input[name="opponents"][value="people"]', { force: true });
await Promise.all([alex.page.waitForURL(/\/g\//), alex.page.click('#new-game button[type="submit"]')]);
const gameUrl = alex.page.url();
const shareUrl = await alex.page.inputValue("#share-url");
check("the creator lands in the waiting room with a share link", shareUrl.endsWith(new URL(gameUrl).pathname), shareUrl);

await sam.page.goto(shareUrl);
await Promise.all([sam.page.waitForURL(/\/g\//), sam.page.click('form[action$="/join"] button')]);
await sam.page.waitForSelector("#board", { timeout: 10_000 });
check("the second player joining starts the game", (await sam.page.locator("#board").count()) === 1);
await alex.page.waitForSelector("#board", { timeout: 10_000 });
check("the waiting room moves on by itself", (await alex.page.locator("#board").count()) === 1);

for (const p of [alex, sam]) await waitFor(p.page, "first state", async () => (await hooks(p.page, (h) => h.phase())) !== null);

console.log("\nDeploying\n");
async function deploy(page: Page, kinds: string[]) {
  for (const kind of kinds) {
    // Tiles already holding a planned deployment select that instead of
    // opening the shop, so tap down the list until the shop appears.
    const tiles = await hooks(page, (h) => h.spawnTiles());
    for (const t of tiles) {
      await tapTile(page, t.x, t.y);
      if (await page.locator(`.shop-item[data-kind="${kind}"]`).count()) break;
    }
    await page.click(`.shop-item[data-kind="${kind}"]`);
  }
}
await deploy(alex.page, ["rifleman", "rifleman"]);
const gold = await alex.page.textContent("#gold");
check("the gold display counts planned deployments", gold?.includes("100") ?? false, gold ?? "");
await alex.page.click('[data-action="submit"]');
await alex.page.waitForSelector('[data-action="edit-orders"]', { timeout: 10_000 });
check("locking in shows the waiting state", true);
const samSees = await sam.page.textContent("#scoreboard");
check("the other player sees Alex is ready", samSees?.includes("Ready") ?? false, samSees ?? "");

await deploy(sam.page, ["rifleman", "scout"]);
await sam.page.click('[data-action="submit"]');
await waitFor(alex.page, "round 2", async () => (await hooks(alex.page, (h) => h.phase()))?.round === 2);
check("when both are in, the round resolves", true);
check("Alex has two units", (await hooks(alex.page, (h) => h.myUnits().length)) === 2);
check("Sam has two units", (await hooks(sam.page, (h) => h.myUnits().length)) === 2);
check("neither can see the other's base yet", (await hooks(alex.page, (h) => h.enemyUnits().length)) === 0);

console.log("\nMarching until someone has a shot\n");
let fired = false;
for (let round = 0; round < 8 && !fired; round++) {
  for (const p of [alex, sam]) {
    const state = await hooks(p.page, (h) => h.phase());
    if (state?.phase !== "planning") continue;
    const units = await hooks(p.page, (h) => h.myUnits());
    for (const u of units) {
      await tapTile(p.page, u.x, u.y);
      // Head for the centre of the map: the reachable tile nearest (12, 8).
      const best = await p.page.evaluate(`(() => {
        const r = window.__salient.reach(${u.id}).filter((t) => !(t.x === ${u.x} && t.y === ${u.y}));
        const taken = new Set(window.__salient.myUnits().map((m) => m.x + "," + m.y));
        r.sort((a, b) => Math.hypot(a.x - 12, a.y - 8) - Math.hypot(b.x - 12, b.y - 8));
        return r.find((t) => !taken.has(t.x + "," + t.y));
      })()`) as { x: number; y: number } | undefined;
      if (best) await tapTile(p.page, best.x, best.y);
      await tapTile(p.page, u.x, u.y); // deselect
    }
    const problem = await p.page.locator(".panel-action .alert").count();
    if (problem) {
      // Two units aimed at one tile: drop the second unit's order.
      await p.page.click('[data-action="clear-order"]').catch(() => {});
    }
    await p.page.click('[data-action="submit"]');
    await p.page.waitForTimeout(150);
  }
  await alex.page.waitForTimeout(400);
  // Attack phase: whoever's turn it is fires their first ready unit at its first target.
  for (let shots = 0; shots < 6; shots++) {
    let acted = false;
    for (const p of [alex, sam]) {
      const st = await hooks(p.page, (h) => h.phase());
      if (st?.phase !== "attack") continue;
      const ready = await hooks(p.page, (h) => h.readyShooters());
      if (!ready.length) continue;
      const shooter = (await hooks(p.page, (h) => h.myUnits())).find((u) => u.id === ready[0])!;
      const targetId = (await p.page.evaluate(`window.__salient.targets(${shooter.id})`) as number[])[0]!;
      const target = (await hooks(p.page, (h) => h.enemyUnits())).find((u) => u.id === targetId)!;
      await tapTile(p.page, shooter.x, shooter.y);
      await tapTile(p.page, target.x, target.y);
      const chance = await p.page.textContent('[data-action="fire"]');
      check("choosing a target shows the hit chance before firing", /\d+%/.test(chance ?? ""), chance ?? "");
      if (!fired) await p.page.screenshot({ path: "screenshots/flow-aim.png" });
      const before = (await hooks(p.page, (h) => h.log())).length;
      await p.page.click('[data-action="fire"]');
      await waitFor(p.page, "the shot to be logged", async () => (await hooks(p.page, (h) => h.log())).length > before);
      if (!fired) {
        await p.page.waitForTimeout(450);
        await p.page.screenshot({ path: "screenshots/flow-shot.png" });
      }
      const log = await hooks(p.page, (h) => h.log());
      const shot = log.slice(before).find((l) => / hit | missed |critical/.test(l));
      check("the shot is resolved and logged", !!shot, shot?.replace(/<[^>]+>/g, "") ?? log.slice(before).join(" | "));
      fired = true;
      acted = true;
      break;
    }
    if (!acted) break;
  }
  // Finish any remaining attack turns so the round can end.
  for (let i = 0; i < 10; i++) {
    let any = false;
    for (const p of [alex, sam]) {
      if ((await p.page.locator('[data-action="end-attacks"]').count()) && (await hooks(p.page, (h) => h.readyShooters().length)) > 0) {
        await p.page.click('[data-action="end-attacks"]');
        await p.page.waitForTimeout(250);
        any = true;
      }
    }
    if (!any) break;
  }
}
check("the armies met and a shot was fired within 8 rounds", fired);

console.log("\nGuarding the rules\n");
const forged = await alex.page.evaluate(async (url) => {
  const id = new URL(url).pathname.split("/").pop();
  return new Promise<string>((resolve) => {
    const ws = new WebSocket(`ws://${location.host}/ws/g/${id}`);
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "error") {
        resolve(m.code);
        ws.close();
      } else if (m.type === "state") {
        ws.send(JSON.stringify({ type: "action", action: { type: "orders", orders: { moves: [], spawns: [{ kind: "heavy", x: 24, y: 8, facing: 6 }] } } }));
      }
    };
    setTimeout(() => resolve("timeout"), 5000);
  });
}, gameUrl);
check("deploying on the enemy base is refused by the server", ["bad_spawn_tile", "wrong_phase"].includes(forged), forged);

const outsider = await player("empty@demo.local");
const res = await outsider.page.goto(gameUrl);
check("a non-player cannot open a game in progress", res?.status() === 403, String(res?.status()));

for (const [name, p] of [["Alex", alex], ["Sam", sam], ["Robin", outsider]] as const) {
  const errs = p.errors.filter((e) => !e.includes("403"));
  check(`${name}'s page had no console errors`, errs.length === 0, errs.slice(0, 2).join(" | "));
}

// Leave no test games behind: resign so the game is over, not abandoned mid-play.
await alex.page.goto(gameUrl);
await alex.page.waitForSelector('[data-action="resign-ask"]', { timeout: 10_000 });
await alex.page.click('[data-action="resign-ask"]');
await alex.page.click('[data-action="resign"]');
await waitFor(alex.page, "game over", async () => (await hooks(alex.page, (h) => h.phase()))?.phase === "over");
await waitFor(sam.page, "game over for Sam", async () => (await hooks(sam.page, (h) => h.phase()))?.phase === "over");
check("resigning ends the game for both players", true);

console.log("\nAgainst the computer\n");
await alex.page.goto(`${BASE}/`);
await alex.page.check('input[name="map"][value="crossroads"]');
await alex.page.check('input[name="opponents"][value="bots"]', { force: true });
await Promise.all([alex.page.waitForURL(/\/g\//), alex.page.click('#new-game button[type="submit"]')]);
await alex.page.waitForSelector("#board", { timeout: 10_000 });
check("a game against the computer starts straight away", true);
await waitFor(alex.page, "the bot's first orders", async () => (await hooks(alex.page, (h) => h.phase()))?.ready[1] === true);
check("the bot locks in its orders without being asked", true);
await deploy(alex.page, ["rifleman"]);
await alex.page.click('[data-action="submit"]');
await waitFor(alex.page, "round 2", async () => (await hooks(alex.page, (h) => h.phase()))?.round === 2);
check("the round resolves once the human is in", true);
const botName = await alex.page.textContent("#scoreboard");
check("the bot appears on the scoreboard by name", /Sgt\. Byte/.test(botName ?? ""), (botName ?? "").replace(/\s+/g, " ").trim());

// March at the bot until it shoots at us, buying a rifleman when we can.
let botFired = false;
for (let round = 0; round < 12 && !botFired; round++) {
  const st = await hooks(alex.page, (h) => h.phase());
  if (st?.phase === "over") break;
  if (st?.phase === "planning" && (await alex.page.locator('[data-action="submit"]').count())) {
    for (const u of await hooks(alex.page, (h) => h.myUnits())) {
      await tapTile(alex.page, u.x, u.y);
      const best = (await alex.page.evaluate(`(() => {
        const taken = new Set(window.__salient.myUnits().map((m) => m.x + "," + m.y));
        const r = window.__salient.reach(${u.id}).filter((t) => !taken.has(t.x + "," + t.y));
        r.sort((a, b) => Math.hypot(a.x - 14, a.y - 8) - Math.hypot(b.x - 14, b.y - 8));
        return r[0];
      })()`)) as { x: number; y: number } | undefined;
      if (best) await tapTile(alex.page, best.x, best.y);
      await tapTile(alex.page, u.x, u.y);
    }
    if (await alex.page.locator(".panel-action .alert").count()) await alex.page.click('[data-action="clear-order"]').catch(() => {});
    await alex.page.click('[data-action="submit"]');
  }
  // Play out the round: fire whenever it is our shot, until a new round starts.
  const startRound = (await hooks(alex.page, (h) => h.phase()))?.round ?? 0;
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    const now = await hooks(alex.page, (h) => h.phase());
    if (!now || now.phase === "over" || (now.phase === "planning" && now.round > startRound)) break;
    if ((await hooks(alex.page, (h) => h.readyShooters().length)) > 0 && (await alex.page.locator('[data-action="end-attacks"]').count())) {
      await alex.page.click('[data-action="end-attacks"]');
    }
    await alex.page.waitForTimeout(250);
  }
  const log = await hooks(alex.page, (h) => h.log());
  const line = log.find((l) => /Sgt\. Byte's .* (hit|missed|critical)/.test(l));
  if (line) {
    botFired = true;
    check("the bot fires at you when it has a shot", true, line.replace(/<[^>]+>/g, ""));
  }
}
if (!botFired) check("the bot fires at you when it has a shot", false, "no bot shot within 12 rounds");
await alex.page.screenshot({ path: "screenshots/flow-bot.png" });
const left = alex.errors.filter((e) => !e.includes("403"));
check("no console errors in the bot game", left.length === 0, left.slice(0, 2).join(" | "));
await alex.page.click('[data-action="resign-ask"]');
await alex.page.click('[data-action="resign"]');
await waitFor(alex.page, "game over", async () => (await hooks(alex.page, (h) => h.phase()))?.phase === "over");

await browser.close();
console.log(`\n${failures === 0 ? "It works." : `${failures} problem(s).`}\n`);
if (failures > 0) process.exit(1);
