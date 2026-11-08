// The map editor in a real browser: paint through symmetry, structures, sites,
// undo and redo, autosave surviving a reload, the problem list gating "Play
// it", playing the map, and a game outliving the map it was made from.
// Also a touch tap on a phone-sized screen.
//   npx tsx scripts/test-editor.ts   (server running, `npm run seed` done)
import { chromium, type Page } from "playwright";
import { DEMO_PASSWORD } from "./demo.js";

const BASE = process.env.TEST_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3100}`;
const browser = await chromium.launch({ channel: "chrome" });

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};

interface MapLike {
  name: string;
  width: number;
  height: number;
  terrain: string[];
  hEdges: (string | null)[];
  vEdges: (string | null)[];
  bases: { x: number; y: number }[][];
  posts: { x: number; y: number }[];
}
const mapNow = (page: Page) => page.evaluate("window.__editor.map()") as Promise<MapLike>;
const problems = (page: Page) => page.evaluate("window.__editor.problems()") as Promise<string[]>;
const terrainAt = (m: MapLike, x: number, y: number) => m.terrain[y * m.width + x];
const screenOf = (page: Page, x: number, y: number, fx = 0.5, fy = 0.5) =>
  page.evaluate(`window.__editor.screenOf(${x}, ${y}, ${fx}, ${fy})`) as Promise<{ x: number; y: number }>;

async function tap(page: Page, x: number, y: number, fx = 0.5, fy = 0.5) {
  const p = await screenOf(page, x, y, fx, fy);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
}

async function drag(page: Page, from: [number, number, number?, number?], to: [number, number, number?, number?]) {
  const a = await screenOf(page, from[0], from[1], from[2] ?? 0.5, from[3] ?? 0.5);
  const b = await screenOf(page, to[0], to[1], to[2] ?? 0.5, to[3] ?? 0.5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}

async function waitSaved(page: Page) {
  await page.waitForFunction("window.__editor.saved()", null, { timeout: 10_000 });
  await page.waitForFunction(() => document.getElementById("save-status")?.textContent === "All changes saved", null, { timeout: 10_000 });
}

const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.goto(`${BASE}/login`);
await page.fill("#email", "alex@demo.local");
await page.fill("#password", DEMO_PASSWORD);
await Promise.all([page.waitForURL((u) => !u.pathname.includes("/login")), page.click('button[type="submit"]')]);

console.log("\nMaking a map\n");
await page.goto(`${BASE}/maps`);
await page.selectOption('select[name="from"]', "blank");
await Promise.all([page.waitForURL(/\/maps\/m-/), page.click('#new-map button[type="submit"]')]);
const editorUrl = page.url();
await page.waitForFunction(() => "__editor" in window);
let m = await mapNow(page);
check("a blank map opens in the editor", m.width === 24 && m.height === 16 && m.terrain.every((t) => t === "grass"), `${m.width}x${m.height}`);
check("and it is playable from the start", (await problems(page)).length === 0, (await problems(page)).join(" | "));

console.log("\nPainting through mirror symmetry\n");
await page.click('[data-tool="rock"]');
await tap(page, 5, 3);
m = await mapNow(page);
check("a rock is painted where you click", terrainAt(m, 5, 3) === "rock");
check("and on the mirrored tile", terrainAt(m, 18, 12) === "rock", String(terrainAt(m, 18, 12)));

await page.click('[data-tool="water"]');
await page.check('input[name="brush"][value="rect"]', { force: true });
await drag(page, [8, 2], [9, 4]);
m = await mapNow(page);
const water = m.terrain.filter((t) => t === "water").length;
check("a rectangle fills a 2x3 block, twice with the mirror", water === 12, `${water} water tiles`);
await page.check('input[name="brush"][value="paint"]', { force: true });

await page.click('[data-tool="wall"]');
// Along the top edges of tiles (3..6, 9): stay near the top of each tile.
await drag(page, [3, 9, 0.2, 0.08], [6, 9, 0.8, 0.08]);
m = await mapNow(page);
const walls = m.hEdges.filter((e) => e === "wall").length;
check("dragging along an edge draws a wall, mirrored", walls === 8, `${walls} wall edges`);

await page.click('[data-tool="building"]');
await drag(page, [3, 11], [6, 13]);
m = await mapNow(page);
const floors = m.terrain.filter((t) => t === "floor").length;
check("a building is a floor with walls round it, mirrored", floors === 24 && m.hEdges.filter((e) => e === "wall").length > walls, `${floors} floor tiles`);

console.log("\nUndo and redo\n");
await page.keyboard.press("Control+z");
m = await mapNow(page);
check("Ctrl+Z takes the building back off", m.terrain.filter((t) => t === "floor").length === 0);
await page.keyboard.press("Control+Shift+z");
m = await mapNow(page);
check("Ctrl+Shift+Z puts it back", m.terrain.filter((t) => t === "floor").length === 24);
await page.click("#undo");
await page.click("#redo");
m = await mapNow(page);
check("so do the buttons", m.terrain.filter((t) => t === "floor").length === 24);

console.log("\nSites and the problem list\n");
await page.click('[data-tool="clear-site"]');
await tap(page, 11, 7);
const missing = await problems(page);
check("removing the only command post is a problem", missing.some((p) => p.includes("command post")), missing.join(" | "));
check("and Play it is disabled", await page.isDisabled("#play"));
const panel = await page.textContent("#problems");
check("the panel says what to fix", panel?.includes("command post") ?? false);
await page.click('[data-tool="post"]');
await tap(page, 11, 4);
m = await mapNow(page);
check("placing a post mirrors it too", m.posts.length === 2, JSON.stringify(m.posts));
check("and the map is playable again", (await problems(page)).length === 0 && !(await page.isDisabled("#play")), (await problems(page)).join(" | "));

await page.click('[data-seat="0"]');
await tap(page, 2, 2);
m = await mapNow(page);
check("a base tile for seat 1 gives seat 2 the mirrored tile", m.bases[0]!.some((p) => p.x === 2 && p.y === 2) && m.bases[1]!.some((p) => p.x === 21 && p.y === 13));

console.log("\nAutosave\n");
await page.fill("#map-name", "Test ridge");
await waitSaved(page);
await page.reload();
await page.waitForFunction(() => "__editor" in window);
m = await mapNow(page);
check("after a reload the name is kept", m.name === "Test ridge", m.name);
check("and so is the painting", terrainAt(m, 5, 3) === "rock" && m.terrain.filter((t) => t === "floor").length === 24);

console.log("\nPlaying it\n");
await page.goto(`${BASE}/`);
const offered = await page.locator('input[name="map"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
check("the new-game form offers the map", offered.some((v) => editorUrl.endsWith(v)), offered.join(", "));
await page.goto(editorUrl);
await page.waitForFunction(() => "__editor" in window);
await Promise.all([page.waitForURL(/\/g\//), page.click("#play")]);
await page.waitForSelector(".score", { timeout: 10_000 });
const gameUrl = page.url();
check("Play it starts a game against the computer on it", (await page.textContent(".battle-title strong")) === "Test ridge");

await page.goto(editorUrl);
await page.waitForFunction(() => "__editor" in window);
await page.click(".danger-zone summary");
await Promise.all([page.waitForURL(/\/maps$/), page.click('.danger-zone button[type="submit"]')]);
const left = await page.locator(".map-card h3").allTextContents();
check("deleting removes it from your maps", !left.includes("Test ridge"), left.join(", "));
await page.goto(gameUrl);
await page.waitForSelector(".score", { timeout: 10_000 });
check("the game played on it still opens: it kept its own copy", (await page.textContent(".battle-title strong")) === "Test ridge");
await page.click('[data-action="resign-ask"]');
await page.click('[data-action="resign"]');

console.log("\nOn a phone\n");
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await phone.addCookies(await context.cookies());
const pp = await phone.newPage();
pp.on("pageerror", (e) => errors.push(e.message));
await pp.goto(`${BASE}/maps`);
await Promise.all([pp.waitForURL(/\/maps\/m-/), pp.click('#new-map button[type="submit"]')]);
await pp.waitForFunction(() => "__editor" in window);
await pp.click('[data-tool="forest"]');
const t = await screenOf(pp, 4, 4);
await pp.touchscreen.tap(t.x, t.y);
await pp.waitForTimeout(150);
const pm = await mapNow(pp);
check("a tap paints on a touch screen", terrainAt(pm, 4, 4) === "forest", String(terrainAt(pm, 4, 4)));
await pp.screenshot({ path: "screenshots/editor-touch.png" });
// Leave nothing behind.
await pp.click(".danger-zone summary");
await Promise.all([pp.waitForURL(/\/maps$/), pp.click('.danger-zone button[type="submit"]')]);

check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(`\n${failures === 0 ? "It works." : `${failures} problem(s).`}\n`);
if (failures > 0) process.exit(1);
