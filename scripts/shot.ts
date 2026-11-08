// Screenshot every page at desktop and phone width in light and dark, and
// fail on any console error or horizontal overflow. The UI's test suite: a
// run that exits 0 proves nothing was thrown; looking at the images proves the
// pages are right.
//   npx tsx scripts/shot.ts [--only=key] [--light] [--desktop] [--viewport]
// Needs the server running (restart it after server-side edits) and `npm run seed`.
import fs from "node:fs";
import { chromium, type Page } from "playwright";
import { DEMO_PASSWORD } from "./demo.js";

const BASE = process.env.TEST_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3100}`;
const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.split("=")[1];
const viewportOnly = args.includes("--viewport");
const themes = args.includes("--light") ? (["light"] as const) : (["light", "dark"] as const);
const widths = args.includes("--desktop") ? [1440] : [1440, 390];

interface SalientHooks {
  screenOf(x: number, y: number): { x: number; y: number };
  myUnits(): { x: number; y: number; kind: string }[];
  spawnTiles(): { x: number; y: number }[];
}

interface Shot {
  key: string;
  path: string | ((page: Page) => Promise<string>);
  account: string | null;
  prepare?: (page: Page) => Promise<void>;
}

/**
 * The seeded battle, found from the lobby rather than hard-coding an id: the
 * first game in progress where this player has units on the field. (A browser
 * suite that stopped half-way can leave an empty game in progress too.)
 */
async function battleUrl(page: Page): Promise<string> {
  await page.goto(`${BASE}/`);
  const hrefs = await page.locator('.game-card a.btn:has-text("Open")').evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
  for (const href of hrefs) {
    await page.goto(`${BASE}${href}`);
    await page.waitForSelector(".score", { timeout: 10_000 });
    const units = await page.evaluate(() => (window as unknown as { __salient: SalientHooks }).__salient.myUnits().length);
    if (units > 0) return href;
  }
  throw new Error("no seeded battle with units: run npm run seed");
}

async function openWaiting(page: Page): Promise<string> {
  await page.goto(`${BASE}/`);
  const href = await page.locator(".game-card a.btn").first().getAttribute("href");
  return href ?? "/";
}

const waitForBoard = async (page: Page) => {
  await page.waitForSelector(".score", { timeout: 10_000 });
  await page.waitForTimeout(700);
};

const SHOTS: Shot[] = [
  { key: "login", path: "/login", account: null },
  { key: "signup", path: "/signup", account: null },
  { key: "lobby", path: "/", account: "alex@demo.local" },
  { key: "lobby-open", path: "/", account: "empty@demo.local" },
  { key: "rules", path: "/how-to-play", account: "alex@demo.local" },
  { key: "settings", path: "/settings", account: "alex@demo.local" },
  { key: "waiting", path: openWaiting, account: "empty@demo.local" },
  { key: "battle", path: battleUrl, account: "alex@demo.local", prepare: waitForBoard },
  {
    key: "battle-select",
    path: battleUrl,
    account: "alex@demo.local",
    prepare: async (page) => {
      await waitForBoard(page);
      // Tap the scout, then hover a tile two steps ahead of it to preview a route.
      const target = await page.evaluate(() => {
        const h = (window as unknown as { __salient: SalientHooks }).__salient;
        const u = h.myUnits().find((x) => x.kind === "scout") ?? h.myUnits()[0]!;
        return { unit: h.screenOf(u.x, u.y), ahead: h.screenOf(u.x + 2, u.y + 1) };
      });
      await page.mouse.click(target.unit.x, target.unit.y);
      // In steps: a single jump delivers no move events over the board in between.
      await page.mouse.move(target.ahead.x, target.ahead.y, { steps: 4 });
      await page.waitForTimeout(300);
    },
  },
  {
    key: "battle-shop",
    path: battleUrl,
    account: "alex@demo.local",
    prepare: async (page) => {
      await waitForBoard(page);
      const tile = await page.evaluate(() => {
        const h = (window as unknown as { __salient: SalientHooks }).__salient;
        const taken = new Set(h.myUnits().map((u) => `${u.x},${u.y}`));
        const t = h.spawnTiles().find((p) => !taken.has(`${p.x},${p.y}`))!;
        return h.screenOf(t.x, t.y);
      });
      await page.mouse.click(tile.x, tile.y);
      await page.waitForTimeout(300);
    },
  },
  { key: "battle-sam", path: battleUrl, account: "sam@demo.local", prepare: waitForBoard },
];

fs.mkdirSync("screenshots", { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
let problems = 0;

for (const theme of themes) {
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: width < 600 ? 844 : 900 },
      colorScheme: theme,
      deviceScaleFactor: width < 600 ? 2 : 1,
      isMobile: width < 600,
      hasTouch: width < 600,
    });
    let signedInAs: string | null = null;
    for (const shot of SHOTS) {
      if (only && shot.key !== only) continue;
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      const name = `screenshots/${shot.key}-${width}-${theme}.png`;
      try {
        if (shot.account !== signedInAs) {
          await context.clearCookies();
          if (shot.account) {
            await page.goto(`${BASE}/login`);
            await page.fill("#email", shot.account);
            await page.fill("#password", DEMO_PASSWORD);
            await Promise.all([page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 10_000 }), page.click('button[type="submit"]')]);
          }
          signedInAs = shot.account;
        }
        const path = typeof shot.path === "string" ? shot.path : await shot.path(page);
        await page.goto(`${BASE}${path}`);
        if (shot.prepare) await shot.prepare(page);
        else await page.waitForLoadState("networkidle");
        const overflow = await page.evaluate(() => {
          const over = document.documentElement.scrollWidth - window.innerWidth;
          if (over <= 1) return null;
          let worst: { tag: string; right: number } | null = null;
          for (const el of document.querySelectorAll("body *")) {
            const r = el.getBoundingClientRect();
            if (r.right > window.innerWidth + 1 && (!worst || r.right > worst.right)) {
              worst = { tag: `${el.tagName.toLowerCase()}.${(el as HTMLElement).className}`.slice(0, 80), right: Math.round(r.right) };
            }
          }
          return { over, worst };
        });
        await page.screenshot({ path: name, fullPage: !viewportOnly && !shot.key.startsWith("battle") });
        const notes: string[] = [];
        if (overflow) notes.push(`OVERFLOW ${overflow.over}px by ${overflow.worst?.tag}`);
        if (errors.length) notes.push(`${errors.length} console error(s): ${errors.slice(0, 2).join(" | ")}`);
        if (notes.length) problems++;
        console.log(`  ${notes.length ? "WARN" : "ok  "} ${name}${notes.length ? `  ${notes.join("; ")}` : ""}`);
      } catch (e) {
        problems++;
        console.log(`  FAIL ${name}  ${(e as Error).message.split("\n")[0]}${errors.length ? `  [${errors.join(" | ")}]` : ""}`);
      }
      await page.close();
    }
    await context.close();
  }
}
await browser.close();
console.log(`\n${problems === 0 ? "All clean." : `${problems} problem(s).`}\n`);
if (problems > 0) process.exit(1);
