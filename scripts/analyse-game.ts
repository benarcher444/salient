// Replay a downloaded game and report on it: what was bought, every
// matchup's hit rate and damage, deaths and lifetimes by class, shots that
// struck an unseen unit, and each side's gold, units and base by round.
//   npm run analyse-game -- <id | file.json> [--step=N]
// An id reads data/reviews/<id>.json (npm run fetch-game -- <id>). --step
// prints that replay step (the replay's numbering) and its neighbours in
// detail: every event, and for a shot its line, cover and preview.
// It runs under today's rules code with the game's own numbers, so a game
// played before a rules change can stop early: it says where.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { previewShot } from "../src/game/combat.js";
import { registerMap } from "../src/game/maps.js";
import { streamFor } from "../src/game/rng.js";
import { applyAction, knownTo, newGame } from "../src/game/rules.js";
import { TUNING_VERSION, upgradeSnapshot, withTuning, type Tuning } from "../src/game/tuning.js";
import { traceLine } from "../src/game/los.js";
import { RuleError, type Action, type GameState, type MapDef, type Unit } from "../src/game/types.js";

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: npm run analyse-game -- <id | file.json> [--step=N]");
  process.exit(1);
}
const file = existsSync(arg) ? arg : path.resolve("data", "reviews", `${arg}.json`);
const stepArg = process.argv.find((a) => a.startsWith("--step="));
const want = stepArg ? Number(stepArg.split("=")[1]) : -1;
const { log, game } = JSON.parse(readFileSync(file, "utf8")) as {
  log: { seed: string; seatCount: number; actions: { seq: number; action: Action }[] };
  game: { map: MapDef; tuning: Tuning; players: { seat: number; name: string }[] };
};
registerMap(game.map);
const map = game.map;
const name = (s: number) => `${["Crimson", "Azure", "Jade", "Amber"][s]}(${game.players.find((p) => p.seat === s)?.name})`;
const tag = (u: Pick<Unit, "id" | "kind" | "seat" | "x" | "y">) => `#${u.id} ${u.kind}[${u.seat}] @${u.x},${u.y}`;

// The tuning as the server sent it, already upgraded; normalised again so a
// field it lacks (rulesRevision, from before it existed) reads as old rules.
withTuning(upgradeSnapshot({ version: TUNING_VERSION, ...game.tuning } as Tuning & { version: number }), () => {
  let state: GameState = newGame(map.id, log.seatCount);
  let step = 0;
  const kinds = new Map<number, Unit>();
  type K = string;
  const shots = new Map<K, { n: number; hit: number; dmg: number; kills: number; chance: number }>();
  const recv = new Map<string, { n: number; hit: number; dmg: number; chanceSum: number }>();
  const bought: Record<number, Record<string, number>> = {};
  const deaths: Record<string, number> = {};
  const lifetimes: Record<string, number[]> = {};
  const born = new Map<number, number>();
  const goldByRound: string[] = [];
  const redirected: string[] = [];
  const riotShots: number[] = [];
  let lastRound = 0;
  for (const { seq, action } of log.actions) {
    if (state.phase === "over") break;
    const before = structuredClone(state);
    let r: ReturnType<typeof applyAction>;
    try {
      r = applyAction(state, action, streamFor(log.seed, seq));
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      console.log(`
Today's rules refuse action ${seq} (${e.code}) after step ${step}: the game was played under older rules code. Report covers up to there.`);
      break;
    }
    state = r.state;
    if (!r.events.length) continue;
    step++;
    for (const u of state.units) kinds.set(u.id, u);
    if (state.round !== lastRound) {
      lastRound = state.round;
      goldByRound.push(`r${state.round}: ` + state.seats.map(({ seat: s, gold }) => `${gold}g ${state.units.filter((u) => u.seat === s).length}u ${state.baseOwners.filter((o) => o === s).length}b`).join(" | "));
    }
    for (const e of r.events) {
      if (e.type === "spawn") {
        const b = (bought[e.unit.seat] ??= {});
        b[e.unit.kind] = (b[e.unit.kind] ?? 0) + 1;
        born.set(e.unit.id, state.round);
        kinds.set(e.unit.id, e.unit);
      }
      if (e.type === "shot") {
        const sh = before.units.find((u) => u.id === e.shooterId)!;
        const tg = before.units.find((u) => u.id === e.targetId)!;
        const k = `${sh.kind} -> ${tg.kind}`;
        const s = shots.get(k) ?? { n: 0, hit: 0, dmg: 0, kills: 0, chance: 0 };
        s.n++; s.hit += +e.hit; s.dmg += e.hit ? e.damage : 0; s.kills += +e.killed; s.chance += e.chance;
        shots.set(k, s);
        const rv = recv.get(tg.kind) ?? { n: 0, hit: 0, dmg: 0, chanceSum: 0 };
        rv.n++; rv.hit += +e.hit; rv.dmg += e.hit ? e.damage : 0; rv.chanceSum += e.chance;
        recv.set(tg.kind, rv);
        for (const sp of e.splash) {
          const v = before.units.find((u) => u.id === sp.unitId)!;
          const rr = recv.get(v.kind + " (splash)") ?? { n: 0, hit: 0, dmg: 0, chanceSum: 0 };
          rr.n++; rr.hit++; rr.dmg += sp.damage; recv.set(v.kind + " (splash)", rr);
        }
        if (tg.kind === "riot") riotShots.push(e.chance);
        if (e.intendedId !== undefined) redirected.push(`step ${step} r${before.round}: ${tag(sh)} aimed at #${e.intendedId}, struck hidden ${tag(tg)} hit=${e.hit}`);
      }
      if ((e.type === "shot" && e.killed) || (e.type === "shot" && e.splash.some((x) => x.killed))) {
        const dead = [e.killed ? e.targetId : -1, ...e.splash.filter((x) => x.killed).map((x) => x.unitId)].filter((x) => x >= 0);
        for (const id of dead) {
          const u = before.units.find((x) => x.id === id)!;
          deaths[u.kind] = (deaths[u.kind] ?? 0) + 1;
          (lifetimes[u.kind] ??= []).push(before.round - (born.get(id) ?? 1));
        }
      }
    }
    if (step === want || step === want - 1 || step === want + 1) {
      console.log(`\n=== step ${step} (seq ${seq}, round ${before.round}, ${before.phase}) action ${JSON.stringify(action)}`);
      for (const e of r.events) console.log("  ", JSON.stringify(e));
      if (action.type === "attack") {
        const sh = before.units.find((u) => u.id === action.unitId)!;
        const tg = before.units.find((u) => u.id === action.targetId)!;
        console.log("  shooter", tag(sh), "facing", sh.facing, "moved", sh.moved, "| target", tag(tg), "facing", tg.facing);
        const line = traceLine(map, sh, tg);
        console.log("  line clear", line.clear, "tiles", JSON.stringify(line.tiles), "obstacles", JSON.stringify(line.obstacles));
        const known = knownTo(map, before, sh.seat);
        console.log("  known to shooter's side:", known.filter((u) => u.seat !== sh.seat).map(tag).join(", "));
        const p = previewShot(map, sh, tg, known);
        console.log("  preview", JSON.stringify(p));
        console.log("  all units:", before.units.map(tag).join(", "));
      }
    }
  }
  console.log(`\nSteps: ${step}. Final round ${state.round}, phase ${state.phase}, winner ${state.winner === null ? "none" : name(state.winner)}`);
  console.log("\nBought per seat:");
  for (const s of Object.keys(bought)) console.log(" ", name(+s), JSON.stringify(bought[+s]));
  console.log("\nShots by matchup (n, hit%, avg chance, dmg dealt, kills):");
  for (const [k, v] of [...shots].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${k.padEnd(22)} ${String(v.n).padStart(4)}  ${Math.round((100 * v.hit) / v.n)}%  avg ${Math.round((100 * v.chance) / v.n)}%  ${v.dmg}  ${v.kills}`);
  console.log("\nShots received by target class (n, hit%, avg chance, dmg taken):");
  for (const [k, v] of [...recv].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${k.padEnd(18)} ${String(v.n).padStart(4)}  ${Math.round((100 * v.hit) / v.n)}%  avg ${Math.round((100 * v.chanceSum) / v.n)}%  ${v.dmg}`);
  console.log("\nDeaths by class:", JSON.stringify(deaths));
  console.log("Lifetimes (rounds) by class:", JSON.stringify(Object.fromEntries(Object.entries(lifetimes).map(([k, v]) => [k, (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)]))));
  const rc: Record<number, number> = {};
  for (const c of riotShots) rc[Math.round(c * 100)] = (rc[Math.round(c * 100)] ?? 0) + 1;
  console.log("Chances of shots at riots:", JSON.stringify(rc));
  console.log("\nShots that struck a hidden unit:", redirected.length);
  for (const l of redirected.slice(0, 15)) console.log(" ", l);
  console.log("\nBy round (gold, units, base tiles):");
  for (const l of goldByRound) console.log(" ", l);
});
