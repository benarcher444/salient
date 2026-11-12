// What each class actually does in whole bot games: gold spent on it, damage
// dealt to enemies (direct and blast) per 100 gold, kills, damage to its own
// side, damage soaked, and how many rounds it lives.
//   npx tsx scripts/class-stats.ts [--games=20] [--level=veteran] [--maps=all] [--plain]
// --plain: bots without their class roles (bot-roles.ts), to compare.
import { chooseAction, type BotLevel } from "../src/game/bot.js";
import { flankOf } from "../src/game/combat.js";
import { MAPS } from "../src/game/maps.js";
import { streamFor } from "../src/game/rng.js";
import { applyAction, newGame } from "../src/game/rules.js";
import { UNIT_KINDS } from "../src/game/tuning.js";
import { UNITS } from "../src/game/units.js";
import { viewFor } from "../src/game/view.js";
import type { Action, GameState, Unit, UnitKind } from "../src/game/types.js";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const games = Number(arg("games") ?? 20);
const level = (arg("level") ?? "veteran") as BotLevel;
const roles = !process.argv.includes("--plain");
const maps = arg("maps") && arg("maps") !== "all" ? MAPS.filter((m) => arg("maps")!.split(",").includes(m.id)) : MAPS;
const ROUND_CAP = 60;

interface Row { bought: number; gold: number; dealt: number; friendly: number; kills: number; taken: number; deaths: number; lived: number; shots: number; hits: number; healed: number; captures: number; rear: number }
const rows = new Map<UnitKind, Row>(UNIT_KINDS.map((k) => [k, { bought: 0, gold: 0, dealt: 0, friendly: 0, kills: 0, taken: 0, deaths: 0, lived: 0, shots: 0, hits: 0, healed: 0, captures: 0, rear: 0 }]));

for (const map of maps) {
  const seats = Math.min(map.seats, 2);
  for (let g = 0; g < games; g++) {
    const seed = `cls-${map.id}-${g}`;
    const random = streamFor(`${seed}-bots`, 0);
    let state: GameState = newGame(map.id, seats);
    const born = new Map<number, number>();
    const kindOf = new Map<number, Unit>();
    let seq = 0;
    while (state.phase !== "over" && state.round <= ROUND_CAP && seq < 20_000) {
      let acted = false;
      for (let seat = 0; seat < seats && state.phase !== "over"; seat++) {
        const choice = chooseAction(viewFor(state, seat), random, level, { roles });
        if (!choice) continue;
        const before = state;
        let r;
        try {
          r = applyAction(state, { ...choice, seat } as Action, streamFor(seed, seq++));
        } catch {
          const fallback: Action = state.phase === "planning" ? { type: "orders", seat, orders: { moves: [], spawns: [] } } : { type: "endAttacks", seat };
          r = applyAction(state, fallback, streamFor(seed, seq++));
        }
        state = r.state;
        acted = true;
        // Healing at round end: hp gained by units that weren't hit, beyond
        // the ordinary regeneration, credited to the healers' class.
        const roundEnded = r.events.some((e) => e.type === "round");
        if (roundEnded) {
          for (const u of state.units) {
            const was = before.units.find((o) => o.id === u.id);
            if (!was) continue;
            const gain = u.hp - was.hp;
            if (gain > 0) {
              const natural = Math.min(gain, was.damaged ? 0 : before.round > 0 ? 10 : 0);
              const extra = gain - natural;
              if (extra > 0) rows.get("healer")!.healed += extra;
            }
          }
        }
        for (const e of r.events) {
          if (e.type === "spawn") {
            const row = rows.get(e.unit.kind)!;
            row.bought++;
            row.gold += UNITS[e.unit.kind].cost;
            born.set(e.unit.id, before.round);
            kindOf.set(e.unit.id, e.unit);
          }
          if (e.type === "capture" && e.site === "income" && e.to !== null) rows.get("engineer")!.captures++;
          if (e.type !== "shot") continue;
          const shooter = before.units.find((u) => u.id === e.shooterId)!;
          const sr = rows.get(shooter.kind)!;
          sr.shots++;
          if (e.hit) sr.hits++;
          const tgt = before.units.find((u) => u.id === e.targetId);
          if (tgt && flankOf(e.from, tgt) === "rear") sr.rear++;
          const hurt = (victimId: number, seat: number, dmg: number, killed: boolean) => {
            const v = before.units.find((u) => u.id === victimId)!;
            const real = Math.min(dmg, Math.max(0, v.hp));
            if (seat === shooter.seat) sr.friendly += real;
            else {
              sr.dealt += real;
              if (killed) sr.kills++;
            }
            const vr = rows.get(v.kind)!;
            vr.taken += real;
            if (killed) {
              vr.deaths++;
              vr.lived += before.round - (born.get(victimId) ?? 1);
            }
          };
          if (e.hit) hurt(e.targetId, e.targetSeat, e.damage, e.killed);
          for (const s of e.splash) hurt(s.unitId, s.seat, s.damage, s.killed);
        }
      }
      if (!acted) break;
    }
    for (const u of state.units) {
      const row = rows.get(u.kind)!;
      row.lived += state.round - (born.get(u.id) ?? 1);
    }
  }
}

console.log(`\n${games} games a map on ${maps.map((m) => m.id).join(", ")}, ${level} bots${roles ? "" : " without roles"}. Per 100 gold spent on the class:`);
console.log("class      bought  gold   dmg/100g  kills/100g  friendly  hit%   taken/unit  rounds alive/unit  K:D   rear%");
for (const [k, r] of rows) {
  if (!r.bought) continue;
  const per = (n: number) => ((100 * n) / r.gold).toFixed(1);
  console.log(
    `${k.padEnd(10)} ${String(r.bought).padStart(6)} ${String(r.gold).padStart(6)}  ${per(r.dealt).padStart(8)}  ${per(r.kills).padStart(10)}  ${String(r.friendly).padStart(8)}  ${r.shots ? String(Math.round((100 * r.hits) / r.shots)).padStart(3) : "  -"}%  ${(r.taken / r.bought).toFixed(0).padStart(10)}  ${(r.lived / r.bought).toFixed(1).padStart(17)}  ${(r.kills / Math.max(1, r.deaths)).toFixed(2).padStart(4)}  ${r.shots ? String(Math.round((100 * r.rear) / r.shots)).padStart(4) : "   -"}%`,
  );
}
const h = rows.get("healer")!;
const e = rows.get("engineer")!;
console.log(`\nHealers: about ${h.healed} extra health restored in all (${h.bought ? (h.healed / h.bought).toFixed(0) : 0} per healer bought).`);
console.log(`Engineers: ${e.captures} income-site captures (${e.bought ? (e.captures / e.bought).toFixed(2) : 0} per engineer bought).`);
