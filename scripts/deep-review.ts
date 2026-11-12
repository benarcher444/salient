// The second half of a game review (after analyse-game): each side's luck
// (hits against the chances it fired at), income and upkeep, who killed whom,
// healing split into a healer's and the ordinary kind, base captures, and
// every unit of seat 0's career.   npx tsx scripts/deep-review.ts <id>
import { readFileSync } from "node:fs";
import { registerMap } from "../src/game/maps.js";
import { streamFor } from "../src/game/rng.js";
import { applyAction, healerBeside, newGame } from "../src/game/rules.js";
import { RULES, TUNING_VERSION, UNITS, upgradeSnapshot, withTuning, type Tuning } from "../src/game/tuning.js";
import type { Action, GameState, MapDef, Unit } from "../src/game/types.js";

const { log, game } = JSON.parse(readFileSync(`data/reviews/${process.argv[2]}.json`, "utf8")) as {
  log: { seed: string; seatCount: number; actions: { seq: number; action: Action }[] };
  game: { map: MapDef; tuning: Tuning };
};
registerMap(game.map);
const N = ["Crimson", "Azure", "Jade", "Amber"];
withTuning(upgradeSnapshot({ version: TUNING_VERSION, ...game.tuning } as Tuning & { version: number }), () => {
  let state: GameState = newGame(game.map.id, log.seatCount);
  const luck = N.map(() => ({ n: 0, hits: 0, exp: 0 }));
  const income = N.map(() => ({ gross: 0, upkeep: 0 }));
  const kills = N.map(() => N.map(() => 0));
  const heal: Record<string, number> = {};
  const holds = N.map(() => 0);
  const ordersBySeat = N.map(() => ({ moves: 0, spawns: 0, routes: 0 }));
  const unitsOf = new Map<number, Unit>();
  const humanUnits = new Map<number, { kind: string; born: number; died?: number; shots: number; hits: number; dmg: number; kills: number; taken: number; healed: number }>();
  const spentBySeat = N.map(() => 0);
  const firstContact: number[] = [];
  const capRounds: string[] = [];
  for (const { seq, action } of log.actions) {
    if (state.phase === "over") break;
    if (action.type === "orders") {
      ordersBySeat[action.seat]!.moves += action.orders.moves.length;
      ordersBySeat[action.seat]!.spawns += action.orders.spawns.length;
      ordersBySeat[action.seat]!.routes += action.orders.routes?.length ?? 0;
    }
    if (action.type === "hold") holds[action.seat]!++;
    const before = new Map(state.units.map((u) => [u.id, u.hp]));
    const round = state.round;
    const r = applyAction(state, action, streamFor(log.seed, seq));
    state = r.state;
    for (const u of state.units) unitsOf.set(u.id, u);
    for (const e of r.events) {
      if (e.type === "spawn") {
        spentBySeat[e.unit.seat]! += UNITS[e.unit.kind].cost;
        if (e.unit.seat === 0) humanUnits.set(e.unit.id, { kind: e.unit.kind, born: round, shots: 0, hits: 0, dmg: 0, kills: 0, taken: 0, healed: 0 });
      }
      if (e.type === "income") {
        income[e.seat]!.gross += e.amount + (e.upkeep ?? 0);
        income[e.seat]!.upkeep += e.upkeep ?? 0;
      }
      if (e.type === "shot") {
        if (!firstContact.length) firstContact.push(round);
        const l = luck[e.shooterSeat]!;
        l.n++; l.hits += +e.hit; l.exp += e.chance;
        if (e.killed) kills[e.shooterSeat]![e.targetSeat]!++;
        for (const s of e.splash) if (s.killed && s.unitId !== e.targetId) kills[e.shooterSeat]![s.seat]!++;
        const h = humanUnits.get(e.shooterId);
        if (h) { h.shots++; h.hits += +e.hit; h.dmg += e.hit ? e.damage : 0; h.kills += +e.killed; }
        const t = humanUnits.get(e.targetId);
        if (t && e.hit) t.taken += e.damage;
        if (e.killed && t) t.died = round;
      }
      if (e.type === "capture" && e.site === "base") capRounds.push(`r${round} base#${e.index} ${e.from === null ? "-" : N[e.from]}->${e.to === null ? "-" : N[e.to]}`);
    }
    // Healing: hp rising across the round end.
    for (const u of state.units) {
      const b = before.get(u.id);
      if (b !== undefined && u.hp > b) {
        const fromHealer = healerBeside(state, u, game.map) ? Math.min(u.hp - b, RULES.medicHeal) : 0;
        heal[N[u.seat]! + " healer"] = (heal[N[u.seat]! + " healer"] ?? 0) + fromHealer;
        heal[N[u.seat]! + " base"] = (heal[N[u.seat]! + " base"] ?? 0) + (u.hp - b - fromHealer);
        const h = humanUnits.get(u.id);
        if (h) h.healed += u.hp - b;
      }
    }
  }
  console.log("Luck (shots, hits, expected hits, diff):");
  luck.forEach((l, i) => console.log(`  ${N[i]}: ${l.n} shots, ${l.hits} hits, expected ${l.exp.toFixed(1)}, ${(l.hits - l.exp).toFixed(1)} (${((100 * l.hits) / l.n).toFixed(0)}% vs ${((100 * l.exp) / l.n).toFixed(0)}%)`));
  console.log("Income gross / upkeep paid / spent on units:");
  income.forEach((x, i) => console.log(`  ${N[i]}: ${x.gross} / ${x.upkeep} / ${spentBySeat[i]}`));
  console.log("Kills (row killed column):");
  kills.forEach((row, i) => console.log(`  ${N[i]}: ${row.join(" ")}`));
  console.log("HP healed:", heal);
  console.log("Holds:", holds, "Orders:", JSON.stringify(ordersBySeat));
  console.log("First shot round:", firstContact[0]);
  console.log("Base captures:\n  " + capRounds.join("\n  "));
  console.log("Crimson units (id kind born-died shots hits dmg kills taken healed):");
  for (const [id, h] of humanUnits) console.log(`  #${id} ${h.kind} r${h.born}-${h.died ?? "end"} ${h.shots} ${h.hits} ${h.dmg} ${h.kills} ${h.taken} ${h.healed}`);
});
