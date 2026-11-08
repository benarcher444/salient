// Bot against bot, many times, entirely in memory: a smoke test that whole
// games run to the end without the rules or the bots getting stuck, and a
// first look at balance (does one seat win too often, how long games last,
// what gets bought and how often shots land).
//   npx tsx scripts/simulate.ts [--games=50] [--map=crossroads] [--seats=2]
import { chooseAction } from "../src/game/bot.js";
import { MAPS } from "../src/game/maps.js";
import { streamFor } from "../src/game/rng.js";
import { applyAction, newGame } from "../src/game/rules.js";
import { viewFor } from "../src/game/view.js";
import { RuleError, type Action, type UnitKind } from "../src/game/types.js";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const games = Number(arg("games") ?? 50);
const maps = arg("map") ? MAPS.filter((m) => m.id === arg("map")) : MAPS;
const MAX_ACTIONS = 5000;

let problems = 0;
for (const map of maps) {
  const seats = Number(arg("seats") ?? Math.min(map.seats, 2));
  const wins = new Map<string, number>();
  const rounds: number[] = [];
  const bought = new Map<UnitKind, number>();
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
    let seq = 0;
    while (state.phase !== "over" && seq < MAX_ACTIONS) {
      let acted = false;
      for (let seat = 0; seat < seats && state.phase !== "over"; seat++) {
        const choice = chooseAction(viewFor(state, seat), botRandom);
        if (!choice) continue;
        try {
          const r = applyAction(state, { ...choice, seat } as Action, streamFor(seed, seq));
          for (const e of r.events) {
            if (e.type === "spawn") bought.set(e.unit.kind, (bought.get(e.unit.kind) ?? 0) + 1);
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
    if (state.phase !== "over") stuck++;
    const key = state.winner === null ? "draw" : `seat ${state.winner}`;
    wins.set(key, (wins.get(key) ?? 0) + 1);
    rounds.push(state.round);
  }

  const avg = rounds.reduce((a, b) => a + b, 0) / rounds.length;
  console.log(`\n${map.name}, ${seats} bots, ${games} games (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  console.log(`  results:   ${[...wins].sort().map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`  rounds:    avg ${avg.toFixed(1)}, min ${Math.min(...rounds)}, max ${Math.max(...rounds)}`);
  console.log(`  shots:     ${shots} (${shots ? Math.round((hits / shots) * 100) : 0}% hit)`);
  console.log(`  bought:    ${[...bought].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  if (stuck || refused) {
    problems++;
    console.log(`  PROBLEM:   ${stuck} game(s) stuck, ${refused} refused bot action(s)`);
  }
}
console.log(`\n${problems === 0 ? "Every game ran to a finish." : `${problems} map(s) with problems.`}\n`);
if (problems > 0) process.exit(1);
