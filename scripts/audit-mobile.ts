// Phone-width audit: what screenshots don't show. Fails on text fields under
// 16px (iOS zooms on focus), tap targets under 44px, horizontal page scroll,
// and content trapped behind the fixed bottom nav.
//   npx tsx scripts/audit-mobile.ts   (server running, `npm run seed` done)
import { chromium } from "playwright";
import { DEMO_PASSWORD } from "./demo.js";

const BASE = process.env.TEST_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3100}`;
const PAGES = ["/", "/maps", "/how-to-play", "/settings"];
const MIN_TARGET = 43.5;

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await context.newPage();
await page.goto(`${BASE}/login`);
await page.fill("#email", "alex@demo.local");
await page.fill("#password", DEMO_PASSWORD);
await Promise.all([page.waitForURL((u) => !u.pathname.includes("/login")), page.click('button[type="submit"]')]);

// The battle page too: found from the lobby, as the seeded game in progress.
const battle = await page.locator('.game-card a.btn:has-text("Open")').first().getAttribute("href");
await page.goto(`${BASE}/maps`);
const editor = await page.locator('.map-card a.btn:has-text("Edit")').first().getAttribute("href");
const paths = [...PAGES, ...(battle ? [battle] : []), ...(editor ? [editor] : [])];

let problems = 0;
for (const path of paths) {
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState("networkidle");
  if (path.startsWith("/g/")) await page.waitForSelector(".score", { timeout: 10_000 });
  // Plain statements and inline arrows only: tsx's keepNames would inject a
  // __name helper into a named function, which the page does not have.
  const findings = await page.evaluate((min) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll("input, select, textarea")) {
      const type = (el as HTMLInputElement).type;
      if (["checkbox", "radio", "hidden", "submit", "button", "range"].includes(type)) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 16) out.push(`text field at ${size}px: ${(el as HTMLElement).id || el.tagName}`);
    }
    const small: string[] = [];
    for (const el of document.querySelectorAll("a, button, [role=button], input[type=checkbox], input[type=radio]")) {
      if (el.closest(".mobile-bar")) continue;
      const target = (el.closest("label") ?? el) as HTMLElement;
      const r = target.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Links inside a sentence are read, not aimed at, so they are exempt.
      // Only inside text blocks: the header is not prose, though its text is long.
      const block = el.closest("p, li, dd, .prose");
      if (el.tagName === "A" && block && (block.textContent ?? "").length > (el.textContent ?? "").length + 20) continue;
      if (getComputedStyle(target).visibility === "hidden") continue;
      if (r.height < min || r.width < min) small.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    out.push(...small.slice(0, 6).map((s) => `small target: ${s}`));
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`horizontal scroll: ${document.documentElement.scrollWidth}px`);
    const bar = document.querySelector(".mobile-bar");
    const main = document.querySelector("main.page");
    if (bar && main) {
      const pad = parseFloat(getComputedStyle(main).paddingBottom);
      const h = bar.getBoundingClientRect().height;
      if (pad < h) out.push(`content under the nav: padding ${pad}px < bar ${Math.round(h)}px`);
    }
    return out;
  }, MIN_TARGET);
  if (findings.length) problems += findings.length;
  console.log(`  ${findings.length ? "FAIL" : "ok  "} ${path}`);
  for (const f of findings) console.log(`         ${f}`);
}
await browser.close();
console.log(`\n${problems === 0 ? "Fit for a phone." : `${problems} problem(s).`}\n`);
if (problems > 0) process.exit(1);
