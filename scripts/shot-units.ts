// Every unit class on the real battle board, for both sides, at several
// facings and a close zoom: the check that classes are told apart and facing
// reads at a glance. No server needed: it bundles the board with a made-up
// view and renders it in a browser.
//   npx tsx scripts/shot-units.ts   -> screenshots/units-{light,dark}.png
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const entry = `
import { Board } from "./board.js";
import { getMap } from "../game/maps.js";
import { UNIT_KINDS, UNITS } from "../game/units.js";
const map = getMap("crossroads");
const units = [];
let id = 1;
UNIT_KINDS.forEach((kind, i) => {
  // Seat 0 on one row, seat 1 below it, each class turned a different way.
  units.push({ id: id++, seat: 0, kind, x: 3 + i * 2, y: 4, facing: (i * 40) % 360, hp: UNITS[kind].hp, moved: false, damaged: false, fired: false });
  units.push({ id: id++, seat: 1, kind, x: 3 + i * 2, y: 6, facing: (i * 40 + 180) % 360, hp: Math.round(UNITS[kind].hp * 0.45), moved: false, damaged: false, fired: false });
});
const view = {
  mapId: map.id, seat: 0, round: 3, phase: "attack", seats: [], gold: 0, units,
  visible: map.terrain.map((_, i) => i), postOwners: map.posts.map(() => null), incomeOwners: map.income.map(() => null),
  myOrders: null, myRoutes: [], attackTurn: 1, acted: [], readyShooters: [], burst: null, baseOwners: [], winner: null,
};
const s = { boot: {}, map, view, players: [], connected: true, draft: { moves: [], spawns: [] }, editing: false, selected: { type: "unit", id: 5 }, hover: { x: 7, y: 6 }, log: [], pending: false, aiming: null, replay: null };
const canvas = document.getElementById("board");
const board = new Board(canvas, s);
board.resize();
board.userMoved = true;
board.camera.scale = 50;
board.camera.x = 2;
board.camera.y = 3;
const frame = (t) => { board.draw(t); requestAnimationFrame(frame); };
requestAnimationFrame(frame);
window.__ready = true;
`;
const out = await build({
  stdin: { contents: entry, resolveDir: path.join(root, "src/client"), loader: "ts" },
  bundle: true,
  format: "esm",
  write: false,
});
const js = out.outputFiles[0]!.text;
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

fs.mkdirSync("screenshots", { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
for (const theme of ["light", "dark"] as const) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 330 }, colorScheme: theme });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setContent(
    `<!doctype html><html data-theme="${theme}"><head><style>${css}</style></head><body style="margin:0"><div class="board-wrap" style="width:1100px;height:330px"><canvas id="board"></canvas></div><script type="module">${js}</script></body></html>`,
  );
  await page.waitForFunction("window.__ready");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `screenshots/units-${theme}.png` });
  console.log(`  ${errors.length ? "FAIL" : "ok  "} screenshots/units-${theme}.png${errors.length ? `  ${errors.join(" | ")}` : ""}`);
  await page.close();
}
await browser.close();
