// A game against the computer played with the keyboard alone: the cursor,
// deploying by number, turning, Tab between units, Enter to give a route,
// Delete to clear it, Shift+Enter to lock in, and the key help.
//   npx tsx scripts/test-keys.ts   (server running, `npm run seed` done)
import { chromium, type Page } from "playwright";
import { DEMO_PASSWORD } from "./demo.js";

const BASE = process.env.TEST_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3100}`;
const browser = await chromium.launch({ channel: "chrome" });

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};

interface P {
  x: number;
  y: number;
}
interface Hooks {
  myUnits(): (P & { id: number; facing: number })[];
  spawnTiles(): P[];
  reach(id: number): P[];
  phase(): { phase: string; round: number } | null;
  hover(): P | null;
  busy(): boolean;
}
const hooks = <T>(page: Page, fn: (h: Hooks) => T) =>
  page.evaluate(`window.__salient ? (${fn.toString()})(window.__salient) : null`) as Promise<T>;

async function waitFor(page: Page, what: string, test: () => Promise<boolean>, timeout = 15_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await test().catch(() => false)) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Walk the cursor to a tile with the arrow keys. */
async function cursorTo(page: Page, to: P) {
  const from = (await hooks(page, (h) => h.hover()))!;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  for (let i = 0; i < Math.abs(dx); i++) await page.keyboard.press(dx > 0 ? "ArrowRight" : "ArrowLeft");
  for (let i = 0; i < Math.abs(dy); i++) await page.keyboard.press(dy > 0 ? "ArrowDown" : "ArrowUp");
}

const gold = async (page: Page) => Number(((await page.textContent("#gold strong")) ?? "").replace(/\D/g, ""));

const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(`${BASE}/login`);
await page.fill("#email", "alex@demo.local");
await page.fill("#password", DEMO_PASSWORD);
await Promise.all([page.waitForURL((u) => !u.pathname.includes("/login")), page.click('button[type="submit"]')]);
await page.goto(`${BASE}/`);
await page.check('input[name="map"][value="crossroads"]');
await page.check('input[name="opponents"][value="bots"]', { force: true });
await Promise.all([page.waitForURL(/\/g\//), page.click('#new-game button[type="submit"]')]);
await waitFor(page, "the board", async () => !!(await hooks(page, (h) => h.phase())));
// Keys go to the page, not the form we came from.
await page.locator("body").focus();

console.log("\nThe cursor\n");
const spawns = (await hooks(page, (h) => h.spawnTiles()))!;
const start = await hooks(page, (h) => h.hover());
check("the cursor starts on your base when you have no units", !!start && spawns.some((t) => t.x === start.x && t.y === start.y), JSON.stringify(start));
await page.keyboard.press("ArrowRight");
const moved = await hooks(page, (h) => h.hover());
check("an arrow key moves it one tile", moved?.x === start!.x + 1 && moved?.y === start!.y, JSON.stringify(moved));
await page.keyboard.press("Shift+ArrowLeft");
const back = await hooks(page, (h) => h.hover());
check("Shift moves it three", back?.x === Math.max(0, start!.x - 2), JSON.stringify(back));

console.log("\nDeploying by number\n");
await cursorTo(page, spawns[0]!);
const before = await gold(page);
await page.keyboard.press("1");
check("1 deploys a rifleman on the cursor's tile", before - (await gold(page)) === 100, `${before} -> ${await gold(page)}`);
const sheet = await page.textContent("#panel");
check("and selects it", sheet?.includes("Deploying") ?? false);
const degrees = async () => Number(/\((\d+)°\)/.exec((await page.textContent("#panel")) ?? "")?.[1]);
const facing0 = await degrees();
await page.keyboard.press("e");
check("E turns it 15°", (await degrees()) === (facing0 + 15) % 360, `${facing0} -> ${await degrees()}`);
await page.keyboard.press("Shift+Q");
check("Shift+Q turns it back 45°", (await degrees()) === (facing0 + 15 - 45 + 360) % 360, `${await degrees()}`);
await cursorTo(page, spawns[1]!);
await page.keyboard.press("2");
check("2 deploys an engineer on another tile", before - (await gold(page)) === 180, String(await gold(page)));
await cursorTo(page, spawns[0]!);
await page.keyboard.press("2");
check("a taken tile is refused, with a reason", (await page.textContent("#banner"))?.includes("free tile") ?? false);
await cursorTo(page, spawns[2]!);
await page.keyboard.press("Enter");
check("Enter on a free base tile opens the shop, numbered 1-9 and 0", (await page.locator(".shop-item .key-hint:visible").count()) === 10, String(await page.locator(".shop-item .key-hint:visible").count()));
await page.screenshot({ path: "screenshots/keys-shop.png" });
await page.keyboard.press("Escape");

console.log("\nLocking in\n");
await page.keyboard.press("Shift+Enter");
await waitFor(page, "round 2", async () => (await hooks(page, (h) => h.phase()))?.round === 2);
await waitFor(page, "the animation", async () => !(await hooks(page, (h) => h.busy())));
const units = (await hooks(page, (h) => h.myUnits()))!;
check("Shift+Enter locks in, and both units deploy", units.length === 2, `${units.length} units`);

console.log("\nMoving with the keyboard\n");
await page.keyboard.press("Tab");
const first = (await hooks(page, (h) => h.hover()))!;
check("Tab puts the cursor on one of your units", units.some((u) => u.x === first.x && u.y === first.y));
const unit = units.find((u) => u.x === first.x && u.y === first.y)!;
const reach = (await page.evaluate(`window.__salient.reach(${unit.id})`)) as P[];
const taken = new Set(units.map((u) => `${u.x},${u.y}`));
const dest = reach.filter((t) => !taken.has(`${t.x},${t.y}`)).sort((a, b) => Math.abs(b.x - unit.x) + Math.abs(b.y - unit.y) - (Math.abs(a.x - unit.x) + Math.abs(a.y - unit.y)))[0]!;
await cursorTo(page, dest);
await page.keyboard.press("Enter");
check("Enter on a reachable tile gives the unit a route", (await page.textContent("#panel"))?.includes("Moving") ?? false);
await page.keyboard.press("Delete");
check("Delete clears it", (await page.textContent("#panel"))?.includes("Holding position") ?? false);
await page.keyboard.press("Enter");
check("Enter again puts it back", (await page.textContent("#panel"))?.includes("Moving") ?? false);
await page.keyboard.press("Escape");
check("Esc deselects", !((await page.textContent("#panel"))?.includes("Moving") ?? true));

console.log("\nKey help\n");
await page.keyboard.press("?");
check("? opens the key list", await page.isVisible("#key-help"));
await page.screenshot({ path: "screenshots/keys-help.png" });
await page.keyboard.press("Escape");
check("Esc closes it", !(await page.isVisible("#key-help")));

await page.keyboard.press("Shift+Enter");
await waitFor(page, "round 3", async () => (await hooks(page, (h) => h.phase()))?.round === 3, 30_000);
await waitFor(page, "the animation", async () => !(await hooks(page, (h) => h.busy())));
const after = (await hooks(page, (h) => h.myUnits()))!.find((u) => u.id === unit.id);
check("the unit walked its route", !!after && (after.x !== unit.x || after.y !== unit.y), `${unit.x},${unit.y} -> ${after?.x},${after?.y} (asked ${dest.x},${dest.y})`);
await page.screenshot({ path: "screenshots/keys-board.png" });

check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await page.locator('[data-action="resign-ask"]').click();
await page.locator('[data-action="resign"]').click();
await browser.close();
console.log(`\n${failures === 0 ? "It works." : `${failures} problem(s).`}\n`);
if (failures > 0) process.exit(1);
