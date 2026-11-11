// Class balance at equal gold: skirmishes between armies set up on the board
// (no buying, no income), played by bots, until one side has no units left.
//   npx tsx scripts/balance.ts [--mode=mixed|pure|squad|both] [--games=20] [--maps=crossroads,facility]
//     [--level=regular] [--only=shotgun,heavy] [--tuning=file.json]
// --only runs just those classes (run several at once to use more cores);
// --tuning plays under {rules, units} from a file instead of tuning/, to
// compare numbers without editing them. The veteran bot is about twenty
// times slower than the regular one here.
// mixed: 4 riflemen + about 600 gold of class X, against 4 riflemen + the
//   same gold in riflemen. Tells you what X adds to an ordinary army, which is
//   how classes are really bought (support classes included).
// pure: about 1200 gold of class X against the same gold of riflemen.
// squad: 8 riflemen + 2 of class X, against 8 riflemen + the same gold in
//   riflemen. The fair test for support classes (healer, officer, riot): a
//   couple in an ordinary army, not an army of them.
// Each pairing is played from both sides of the map. A game that reaches the
// round cap is scored by the share of each army's starting value that
// survives (health-weighted), so a few gold of rounding never decides it;
// how many games got that far is reported too.
import { chooseAction, type BotLevel } from "../src/game/bot.js";
import { getMap, registerMap } from "../src/game/maps.js";
import { streamFor } from "../src/game/rng.js";
import { applyAction, newGame } from "../src/game/rules.js";
import { isPassable, facingToward } from "../src/game/grid.js";
import { readFileSync } from "node:fs";
import { FILE_TUNING, UNIT_KINDS, checkTuning, withTuning, type Tuning } from "../src/game/tuning.js";
import { UNITS } from "../src/game/units.js";
import { viewFor } from "../src/game/view.js";
import type { Action, GameState, MapDef, Point, Seat, Unit, UnitKind } from "../src/game/types.js";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const mode = arg("mode") ?? "both";
const games = Number(arg("games") ?? 20);
const mapIds = (arg("maps") ?? "crossroads,facility").split(",");
const level = (arg("level") ?? "regular") as BotLevel;
const only = arg("only")?.split(",");
const wanted = (k: UnitKind) => !only || only.includes(k);
const ROUND_CAP = 60;

// No buying in a skirmish: the armies are what they are.
const tuning: Tuning = arg("tuning") ? checkTuning(JSON.parse(readFileSync(arg("tuning")!, "utf8"))) : structuredClone(FILE_TUNING);
tuning.rules.startGold = 0;
tuning.rules.baseIncome = 0;

/** Passable tiles nearest the seat's base, nearest first. */
function deployTiles(map: MapDef, seat: Seat, n: number): Point[] {
  const base = map.bases[seat]!;
  const seen = new Set(base.map((p) => p.y * map.width + p.x));
  const queue = [...base];
  const out: Point[] = [];
  while (queue.length && out.length < n) {
    const p = queue.shift()!;
    if (isPassable(map, p.x, p.y)) out.push(p);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const q = { x: p.x + dx, y: p.y + dy };
      const i = q.y * map.width + q.x;
      if (q.x < 0 || q.y < 0 || q.x >= map.width || q.y >= map.height || seen.has(i)) continue;
      seen.add(i);
      queue.push(q);
    }
  }
  return out;
}

const value = (units: Unit[], seat: Seat) => units.filter((u) => u.seat === seat).reduce((t, u) => t + UNITS[u.kind].cost * Math.max(0, u.hp / UNITS[u.kind].hp), 0);

/** Play one skirmish: the winning seat (null for an exact tie), and whether it hit the cap. */
function skirmish(map: MapDef, armies: [UnitKind[], UnitKind[]], seed: string): { winner: Seat | null; capped: boolean } {
  let state: GameState = newGame(map.id, 2);
  let id = 1;
  const centre = { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };
  armies.forEach((kinds, seat) => {
    const tiles = deployTiles(map, seat, kinds.length);
    kinds.forEach((kind, i) => {
      const p = tiles[i]!;
      state.units.push({ id: id++, seat, kind, x: p.x, y: p.y, facing: facingToward(p, centre), hp: UNITS[kind].hp, moved: false, damaged: false, fired: false });
    });
  });
  state.nextUnitId = id;
  const random = streamFor(`${seed}-bots`, 0);
  let seq = 0;
  while (state.round <= ROUND_CAP && seq < 20_000) {
    const alive = [0, 1].map((s) => state.units.some((u) => u.seat === s));
    if (!alive[0] || !alive[1] || state.phase === "over") break;
    let acted = false;
    for (const seat of [0, 1] as Seat[]) {
      const choice = chooseAction(viewFor(state, seat), random, level);
      if (!choice) continue;
      try {
        state = applyAction(state, { ...choice, seat } as Action, streamFor(seed, seq++)).state;
      } catch {
        const fallback: Action = state.phase === "planning" ? { type: "orders", seat, orders: { moves: [], spawns: [] } } : { type: "endAttacks", seat };
        state = applyAction(state, fallback, streamFor(seed, seq++)).state;
      }
      acted = true;
    }
    if (!acted) break;
  }
  const start = armies.map((k) => k.reduce((t, u) => t + UNITS[u].cost, 0));
  const v0 = value(state.units, 0) / start[0]!;
  const v1 = value(state.units, 1) / start[1]!;
  const capped = state.units.some((u) => u.seat === 0) && state.units.some((u) => u.seat === 1);
  if (process.env.BAL_DEBUG) console.log(`    ${seed}: round ${state.round}, left ${state.units.filter((u) => u.seat === 0).length} v ${state.units.filter((u) => u.seat === 1).length}, value ${v0.toFixed(2)} v ${v1.toFixed(2)}`);
  return { winner: v0 === v1 ? null : v0 > v1 ? 0 : 1, capped };
}

/** The map without income sites: nothing in a skirmish may earn gold and buy reinforcements. */
function arena(id: string): MapDef {
  const map = { ...getMap(id), id: `bal-${id}`, income: [] };
  registerMap(map);
  return map;
}

function trial(label: string, x: UnitKind[], y: UnitKind[]) {
  const gold = (k: UnitKind[]) => k.reduce((t, u) => t + UNITS[u].cost, 0);
  const parts: string[] = [];
  let wins = 0;
  let played = 0;
  let capped = 0;
  for (const mapId of mapIds) {
    const map = arena(mapId);
    let w = 0;
    for (let g = 0; g < games; g++) {
      // Alternate sides, so neither army always has the better half of the map.
      const xSeat = (g % 2) as Seat;
      const armies: [UnitKind[], UnitKind[]] = xSeat === 0 ? [x, y] : [y, x];
      const r = skirmish(map, armies, `bal-${label}-${mapId}-${g}`);
      const winner = r.winner;
      if (r.capped) capped++;
      if (winner === xSeat) w++;
      else if (winner === null) w += 0.5;
    }
    wins += w;
    played += games;
    parts.push(`${mapId} ${Math.round((100 * w) / games)}%`);
  }
  console.log(`  ${only ? `${mode.padEnd(5)} ` : ""}${label.padEnd(10)} ${String(gold(x)).padStart(5)}g vs ${String(gold(y)).padStart(5)}g   wins ${String(Math.round((100 * wins) / played)).padStart(3)}%   (${parts.join(", ")})${capped ? `  ${capped} reached round ${ROUND_CAP}` : ""}`);
}

const armed = UNIT_KINDS.filter((k) => !FILE_TUNING.units[k].traits.includes("unarmed"));
withTuning(tuning, () => {
  if (mode === "mixed" || mode === "both") {
    if (!only) console.log(`\nMixed: 4 riflemen + ~600g of the class, against 4 riflemen + the same gold in riflemen (${level} bots, ${games} a map)`);
    // Not the engineer: its job is income sites, which a skirmish doesn't have.
    for (const kind of UNIT_KINDS.filter((k) => k !== "engineer" && wanted(k))) {
      const n = Math.max(1, Math.round(600 / UNITS[kind].cost));
      const x: UnitKind[] = [...Array(4).fill("rifleman"), ...Array(n).fill(kind)];
      const gold = 400 + n * UNITS[kind].cost;
      const y: UnitKind[] = Array(Math.round(gold / 100)).fill("rifleman");
      trial(kind, x, y);
    }
  }
  if (mode === "squad") {
    if (!only) console.log(`\nSquad: 8 riflemen + 2 of the class, against 8 riflemen + the same gold in riflemen (${level} bots, ${games} a map)`);
    for (const kind of UNIT_KINDS.filter((k) => k !== "engineer" && wanted(k))) {
      const x: UnitKind[] = [...Array(8).fill("rifleman"), kind, kind];
      const y: UnitKind[] = Array(8 + Math.round((2 * UNITS[kind].cost) / 100)).fill("rifleman");
      trial(kind, x, y);
    }
  }
  if (mode === "pure" || mode === "both") {
    if (!only) console.log(`\nPure: ~1200g of the class against the same gold in riflemen (${level} bots, ${games} a map)`);
    for (const kind of armed) {
      if (kind === "rifleman" || !wanted(kind)) continue;
      const n = Math.max(1, Math.round(1200 / UNITS[kind].cost));
      const x: UnitKind[] = Array(n).fill(kind);
      const y: UnitKind[] = Array(Math.round((n * UNITS[kind].cost) / 100)).fill("rifleman");
      trial(kind, x, y);
    }
  }
});
