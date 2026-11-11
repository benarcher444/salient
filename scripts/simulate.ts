// Bot against bot, many times, entirely in memory: a smoke test that whole
// games run to the end without the rules or the bots getting stuck, and a
// first look at balance (does one seat win too often, how long games last,
// what gets bought and how often shots land).
//   npx tsx scripts/simulate.ts [--games=50] [--map=crossroads] [--seats=2] [--rounds=60]
//                               [--level=veteran | --levels=veteran,regular]
// --level sets every bot's level (default regular); --levels gives one per
// seat, and the levels then rotate round the seats from game to game, so
// seat advantage cancels out and the report counts wins by level.
// Real games may have no round limit; a simulated one stops at --rounds and
// is reported as unfinished (not a problem: bots can stalemate).
import { BOT_LEVELS, chooseAction, isBotLevel, type BotLevel } from "../src/game/bot.js";
import { MAPS } from "../src/game/maps.js";
import { streamFor } from "../src/game/rng.js";
import { applyAction, newGame } from "../src/game/rules.js";
import { viewFor } from "../src/game/view.js";
import { FILE_TUNING, useTuning } from "../src/game/tuning.js";
import { RuleError, type Action, type UnitKind } from "../src/game/types.js";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const games = Number(arg("games") ?? 50);
const maps = arg("map") ? MAPS.filter((m) => m.id === arg("map")) : MAPS;
const MAX_ACTIONS = 20_000;
const ROUND_CAP = Number(arg("rounds") ?? 60);
const levelList = (arg("levels") ?? arg("level") ?? "regular").split(",");
if (!levelList.every(isBotLevel)) {
  console.error(`levels must be ${BOT_LEVELS.join(", ")}`);
  process.exit(2);
}
const levels = levelList as BotLevel[];
const mixed = new Set(levels).size > 1;
// --house=upkeep,heal: play under the house rules a game can be created with.
const houseArg = (arg("house") ?? "").split(",").filter(Boolean);
if (houseArg.length) {
  useTuning({ ...FILE_TUNING, rules: { ...FILE_TUNING.rules, upkeep: houseArg.includes("upkeep") ? 1 : 0, healOnlyNearBase: houseArg.includes("heal") ? 1 : 0 } });
  console.log(`House rules: ${houseArg.join(", ")}`);
}

let problems = 0;
for (const map of maps) {
  const seats = Number(arg("seats") ?? Math.min(map.seats, 2));
  const wins = new Map<string, number>();
  const levelWins = new Map<string, number>();
  const rounds: number[] = [];
  const bought = new Map<UnitKind, number>();
  const boughtBy = new Map<BotLevel, Map<UnitKind, number>>();
  let shots = 0;
  let hits = 0;
  let stuck = 0;
  let refused = 0;
  const started = Date.now();

  for (let g = 0; g < games; g++) {
    const seed = `sim-${map.id}-${g}`;
    // Bot randomness from its own stream, so a run is repeatable.
    const botRandom = streamFor(`${seed}-bots`, 0);
    let state = newGame(map.id, seats);
    // Seat s plays levels[(s + g) % n]: with mixed levels, every level gets every seat in turn.
    const levelOf = (seat: number) => levels[(seat + (mixed ? g : 0)) % levels.length]!;
    let seq = 0;
    while (state.phase !== "over" && state.round <= ROUND_CAP && seq < MAX_ACTIONS) {
      let acted = false;
      for (let seat = 0; seat < seats && state.phase !== "over"; seat++) {
        const choice = chooseAction(viewFor(state, seat), botRandom, levelOf(seat));
        if (!choice) continue;
        try {
          const r = applyAction(state, { ...choice, seat } as Action, streamFor(seed, seq));
          for (const e of r.events) {
            if (e.type === "spawn") {
              bought.set(e.unit.kind, (bought.get(e.unit.kind) ?? 0) + 1);
              const by = boughtBy.get(levelOf(e.unit.seat)) ?? new Map<UnitKind, number>();
              by.set(e.unit.kind, (by.get(e.unit.kind) ?? 0) + 1);
              boughtBy.set(levelOf(e.unit.seat), by);
            }
            if (e.type === "shot") {
              shots++;
              if (e.hit) hits++;
            }
          }
          state = r.state;
          seq++;
          acted = true;
        } catch (e) {
          // A bot sending something the rules refuse is a bot bug: report it.
          refused++;
          if (refused <= 3) console.log(`  refused: ${e instanceof RuleError ? e.code : e} (${map.id} game ${g}, seat ${seat}, ${choice.type})`);
          // Fall back to the always-legal move so the game can go on.
          const fallback: Action = state.phase === "planning" ? { type: "orders", seat, orders: { moves: [], spawns: [] } } : { type: "endAttacks", seat };
          state = applyAction(state, fallback, streamFor(seed, seq++)).state;
          acted = true;
        }
      }
      if (!acted) {
        stuck++;
        break;
      }
    }
    if (state.phase !== "over" && state.round <= ROUND_CAP) stuck++;
    const key = state.phase !== "over" ? `unfinished at ${ROUND_CAP}` : state.winner === null ? "draw" : `seat ${state.winner}`;
    wins.set(key, (wins.get(key) ?? 0) + 1);
    const byLevel = state.phase !== "over" ? "unfinished" : state.winner === null ? "draw" : levelOf(state.winner);
    levelWins.set(byLevel, (levelWins.get(byLevel) ?? 0) + 1);
    rounds.push(state.round);
  }

  const avg = rounds.reduce((a, b) => a + b, 0) / rounds.length;
  console.log(`\n${map.name}, ${seats} bots (${Array.from({ length: seats }, (_, s) => levels[s % levels.length]).join(" v ")}), ${games} games (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  console.log(`  results:   ${[...wins].sort().map(([k, v]) => `${k} ${v}`).join(", ")}`);
  if (mixed) console.log(`  by level:  ${[...levelWins].sort().map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`  rounds:    avg ${avg.toFixed(1)}, min ${Math.min(...rounds)}, max ${Math.max(...rounds)}`);
  console.log(`  shots:     ${shots} (${shots ? Math.round((hits / shots) * 100) : 0}% hit)`);
  const list = (m: Map<UnitKind, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
  if (!mixed) console.log(`  bought:    ${list(bought)}`);
  else for (const [level, m] of [...boughtBy].sort()) console.log(`  ${`${level}:`.padEnd(10)} ${list(m)}`);
  if (stuck || refused) {
    problems++;
    console.log(`  PROBLEM:   ${stuck} game(s) stuck, ${refused} refused bot action(s)`);
  }
}
console.log(`\n${problems === 0 ? "No game got stuck and the bots broke no rule." : `${problems} map(s) with problems.`}\n`);
if (problems > 0) process.exit(1);
