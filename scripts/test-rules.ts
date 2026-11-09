// The rules engine, exhaustively: geometry, sight, movement, shooting, the
// round structure, captures, the economy and replay determinism. No server, no
// browser. Behaviour that looks odd but is deliberate is pinned here too, so a
// later change cannot quietly "fix" it.
//   npx tsx scripts/test-rules.ts
import { stepOpen } from "../src/game/grid.js";
import { traceLine } from "../src/game/los.js";
import { MAPS, MapBuilder, getMap, registerMap, symmetryTransforms } from "../src/game/maps.js";
import { checkMap } from "../src/game/mapcheck.js";
import { pathTo, reachable, validatePath } from "../src/game/movement.js";
import { previewShot, rollShot } from "../src/game/combat.js";
import { applyAction, newGame } from "../src/game/rules.js";
import { streamFor } from "../src/game/rng.js";
import { UNITS } from "../src/game/units.js";
import { viewFor } from "../src/game/view.js";
import { RuleError, type Action, type GameState, type MapDef, type Point, type Unit, type UnitKind } from "../src/game/types.js";
import { RULES } from "../src/game/constants.js";
import { baseTiles } from "../src/game/visibility.js";
import { FILE_TUNING, TuningError, checkTuning, withTuning, type Tuning } from "../src/game/tuning.js";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};
const section = (title: string) => console.log(`\n${title}\n`);

/** A small open test board. `draw` places what the case needs. */
function board(id: string, draw: (b: MapBuilder) => void = () => {}, w = 12, h = 12): MapDef {
  const b = new MapBuilder({ id, name: id, blurb: "", width: w, height: h, seats: 2 });
  b.pen().base(0, 0, 2, 2);
  // Seat 1's base, by hand, in the opposite corner.
  b.bases[1] = [{ x: w - 1, y: h - 1 }, { x: w - 2, y: h - 1 }];
  draw(b);
  const map = b.build();
  registerMap(map);
  return map;
}

function unit(id: number, seat: number, kind: UnitKind, x: number, y: number, extra: Partial<Unit> = {}): Unit {
  return { id, seat, kind, x, y, facing: 2, hp: UNITS[kind].hp, moved: false, damaged: false, ...extra };
}

function stateOn(mapId: string, units: Unit[]): GameState {
  const s = newGame(mapId, 2);
  s.units = units;
  s.nextUnitId = Math.max(0, ...units.map((u) => u.id)) + 1;
  return s;
}

const roll = (value: number) => () => value;
const at = (s: GameState, id: number) => s.units.find((u) => u.id === id);
const pos = (u: Unit | undefined) => (u ? `${u.x},${u.y}` : "gone");

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return "no error";
  } catch (e) {
    return e instanceof RuleError ? e.code : String(e);
  }
}

// ---------------------------------------------------------------------------
section("Built-in maps are symmetric, so no seat starts ahead");

for (const map of MAPS) {
  const n = map.width;
  const rot = (p: Point): Point =>
    map.seats === 2 ? { x: map.width - 1 - p.x, y: map.height - 1 - p.y } : { x: n - 1 - p.y, y: p.x };
  let mismatches = 0;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const r = rot({ x, y });
      if (map.terrain[y * map.width + x] !== map.terrain[r.y * map.width + r.x]) mismatches++;
    }
  }
  check(`${map.name}: terrain matches its rotation`, mismatches === 0, `${mismatches} tiles differ`);
  const sizes = map.bases.map((b) => b.length);
  check(`${map.name}: every seat has the same size base`, new Set(sizes).size === 1 && sizes[0]! > 0, sizes.join("/"));
  const passableBases = map.bases.flat().every((p) => map.terrain[p.y * map.width + p.x] !== "rock" && map.terrain[p.y * map.width + p.x] !== "water");
  check(`${map.name}: bases are on open ground`, passableBases);
  const sitesOpen = [...map.posts, ...map.income].every((p) => !["rock", "water", "crate"].includes(map.terrain[p.y * map.width + p.x]!));
  check(`${map.name}: posts and income sites can be stood on`, sitesOpen);
  // Every post must be reachable from every base, or the map is unwinnable.
  const start = map.bases[0]![0]!;
  const seen = new Set([`${start.x},${start.y}`]);
  const queue = [start];
  while (queue.length) {
    const p = queue.shift()!;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const q = { x: p.x + dx, y: p.y + dy };
        if (q.x < 0 || q.y < 0 || q.x >= map.width || q.y >= map.height) continue;
        if (seen.has(`${q.x},${q.y}`) || !stepOpen(map, p, q)) continue;
        seen.add(`${q.x},${q.y}`);
        queue.push(q);
      }
  }
  const unreachable = [...map.posts, ...map.income, ...map.bases.flat()].filter((p) => !seen.has(`${p.x},${p.y}`));
  check(`${map.name}: every site is reachable from seat 0's base`, unreachable.length === 0, unreachable.map((p) => `${p.x},${p.y}`).join(" "));
}

// ---------------------------------------------------------------------------
section("Map checking (what the editor shows and the server enforces)");

for (const map of MAPS) check(`${map.name} passes the map check`, checkMap(map).length === 0, checkMap(map).join(" | "));
{
  const ok = board("check-ok", (b) => b.pen().post(6, 6));
  check("a small open map with bases and a post is playable", checkMap(ok).length === 0, checkMap(ok).join(" | "));
  const noPost = board("check-nopost");
  check("a map with no command post is not", checkMap(noPost).some((p) => p.includes("command post")), checkMap(noPost).join(" | "));
  const walled = board("check-walled", (b) => {
    b.pen().post(6, 6);
    // A ring of rock round the post.
    for (let i = 4; i <= 8; i++) for (const [x, y] of [[i, 4], [i, 8], [4, i], [8, i]] as const) b.pen().tile(x, y, "rock");
  });
  check("a post nobody can reach is reported", checkMap(walled).some((p) => p.includes("can't reach the command post")), checkMap(walled).join(" | "));
  const rockBase = board("check-rockbase", (b) => {
    b.pen().post(6, 6);
    b.pen().tile(0, 0, "rock");
  });
  check("a base tile on rock is reported", checkMap(rockBase).some((p) => p.includes("on rock")), checkMap(rockBase).join(" | "));
  const shared = board("check-shared", (b) => b.pen().post(0, 0));
  check("a post on a base tile is reported", checkMap(shared).some((p) => p.includes("share the tile")), checkMap(shared).join(" | "));
}
{
  check("mirror symmetry repeats a stroke twice", symmetryTransforms("mirror", 20, 14).length === 2);
  check("four-way needs a square map", symmetryTransforms("fourway", 20, 14).length === 1 && symmetryTransforms("fourway", 20, 20).length === 4);
  const [, half] = symmetryTransforms("mirror", 20, 14);
  const q = half!.point({ x: 2, y: 3 });
  check("a half turn sends (2,3) to (17,10) and north to south", q.x === 17 && q.y === 10 && half!.side("n") === "s", JSON.stringify(q));
  const [, quarter] = symmetryTransforms("fourway", 20, 20);
  const r = quarter!.point({ x: 2, y: 3 });
  check("a quarter turn sends (2,3) to (16,2) and north to east", r.x === 16 && r.y === 2 && quarter!.side("n") === "e", JSON.stringify(r));
}

// ---------------------------------------------------------------------------
section("Line of sight");

{
  const m = board("los-wall", (b) => b.pen().edge(3, 2, "w", "wall"));
  check("a wall between two tiles blocks the line", !traceLine(m, { x: 2, y: 2 }, { x: 4, y: 2 }).clear);
  check("the line is the same both ways", !traceLine(m, { x: 4, y: 2 }, { x: 2, y: 2 }).clear);
  check("a line beside the wall is clear", traceLine(m, { x: 2, y: 3 }, { x: 4, y: 3 }).clear);
}
{
  const m = board("los-window", (b) => b.pen().edge(3, 2, "w", "window"));
  const line = traceLine(m, { x: 2, y: 2 }, { x: 5, y: 2 });
  check("a window does not block sight", line.clear);
  check("but it is recorded as an obstacle", line.obstacles.length === 1 && line.obstacles[0]!.kind === "window", JSON.stringify(line.obstacles));
}
{
  // Corner point (3,3). The edge along the top of tile (3,3) ends there.
  const m = board("los-graze", (b) => b.pen().edge(3, 3, "n", "wall"));
  check("a single wall ending at a corner only grazes a diagonal line", traceLine(m, { x: 2, y: 2 }, { x: 4, y: 4 }).clear);
}
{
  const m = board("los-corner", (b) => {
    b.pen().edge(3, 3, "n", "wall");
    b.pen().edge(3, 3, "w", "wall");
  });
  check("an L of walls (a room corner) blocks a diagonal through it", !traceLine(m, { x: 2, y: 2 }, { x: 4, y: 4 }).clear);
  check("... from the other diagonal direction too", !traceLine(m, { x: 4, y: 4 }, { x: 2, y: 2 }).clear);
}
{
  const m = board("los-straight", (b) => {
    b.pen().edge(3, 2, "w", "wall");
    b.pen().edge(3, 3, "w", "wall");
  });
  check("a straight wall through a corner blocks the diagonal", !traceLine(m, { x: 2, y: 2 }, { x: 3, y: 3 }).clear);
}
{
  const m = board("los-rock", (b) => b.pen().tile(3, 2, "rock"));
  check("rock blocks sight", !traceLine(m, { x: 2, y: 2 }, { x: 4, y: 2 }).clear);
  check("you can see the face of the rock itself", traceLine(m, { x: 2, y: 2 }, { x: 3, y: 2 }).clear);
}
{
  const m = board("los-boulders", (b) => {
    b.pen().tile(3, 2, "rock");
    b.pen().tile(2, 3, "rock");
  });
  check("two boulders touching diagonally block the gap between them", !traceLine(m, { x: 2, y: 2 }, { x: 3, y: 3 }).clear);
}
{
  const m = board("los-shallow", (b) => b.pen().edge(5, 3, "w", "wall"));
  // A shallow line from (1,2) to (8,4) crosses x=5 at y = 2.5 + 2*(4/7) = 3.64: tile row 3.
  check("a shallow line meets the wall it really crosses", !traceLine(m, { x: 1, y: 2 }, { x: 8, y: 4 }).clear);
  check("and misses one a row away", traceLine(board("los-shallow2", (b) => b.pen().edge(5, 1, "w", "wall")), { x: 1, y: 2 }, { x: 8, y: 4 }).clear);
}

// ---------------------------------------------------------------------------
section("Movement");

{
  const m = board("move-diag", (b) => b.pen().edge(3, 2, "w", "wall"));
  check("no diagonal step past the end of a wall", !stepOpen(m, { x: 2, y: 2 }, { x: 3, y: 3 }));
  check("the diagonal the other way is fine", stepOpen(m, { x: 2, y: 3 }, { x: 1, y: 4 }));
  check("windows stop feet", !stepOpen(board("move-window", (b) => b.pen().edge(3, 2, "w", "window")), { x: 2, y: 2 }, { x: 3, y: 2 }));
  check("doorways do not", stepOpen(board("move-door", (b) => b.pen().edge(3, 2, "w", "door")), { x: 2, y: 2 }, { x: 3, y: 2 }));
}
{
  const m = board("move-range");
  const r = unit(1, 0, "rifleman", 0, 5);
  const reach = reachable(m, r, new Set());
  check("a rifleman walks 5 tiles straight", reach.cost.has(5 * m.width + 5));
  check("but not 6", !reach.cost.has(5 * m.width + 6));
  check("3 diagonal steps cost 4.5 tiles: in range", validatePath(m, unit(2, 0, "rifleman", 0, 0), [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]) === "ok");
  check("4 diagonal steps cost 6: too far", validatePath(m, unit(2, 0, "rifleman", 0, 0), [1, 2, 3, 4].map((i) => ({ x: i, y: i }))) === "path_too_long");
  check("teleporting is not a path", validatePath(m, r, [{ x: 3, y: 5 }]) === "bad_path");
  const path = pathTo(m, reach, { x: 3, y: 5 });
  check("pathTo rebuilds the route without the start", path?.length === 3 && path[2]!.x === 3, JSON.stringify(path));
  const blocked = reachable(m, r, new Set([5 * m.width + 1]));
  check("a blocked tile (a seen enemy) is never entered", !blocked.cost.has(5 * m.width + 1));
}
{
  const m = board("move-forest", (b) => b.pen().rect(1, 0, 11, 12, "forest"));
  const reach = reachable(m, unit(1, 0, "rifleman", 0, 5), new Set());
  check("woods cost double: 2 steps in, not 3", reach.cost.has(5 * m.width + 2) && !reach.cost.has(5 * m.width + 3));
}

// ---------------------------------------------------------------------------
section("Shooting");

{
  const m = board("shoot-open");
  const s = unit(1, 0, "rifleman", 2, 5, { facing: 2 });
  const facingMe = previewShot(m, s, unit(2, 1, "rifleman", 6, 5, { facing: 6 }));
  check("open ground at optimal range: base accuracy", facingMe.possible && Math.round(facingMe.chance * 100) === 75, `${facingMe.chance}`);
  check("a hit from the front does base damage", facingMe.flank === "front" && facingMe.damage === 30, `${facingMe.flank} ${facingMe.damage}`);
  const back = previewShot(m, s, unit(2, 1, "rifleman", 6, 5, { facing: 2 }));
  check("from behind: 1.5x", back.flank === "rear" && back.damage === 45, `${back.flank} ${back.damage}`);
  const side = previewShot(m, s, unit(2, 1, "rifleman", 6, 5, { facing: 0 }));
  check("from the side: 1.25x", side.flank === "side" && side.damage === 38, `${side.flank} ${side.damage}`);
  const arc = previewShot(m, unit(1, 0, "rifleman", 2, 5, { facing: 0 }), unit(2, 1, "rifleman", 6, 5));
  check("a target 90 degrees off a 120 degree arc can't be shot", arc.block === "outside_arc", arc.block);
  const far = previewShot(m, s, unit(2, 1, "rifleman", 11, 5));
  check("beyond range can't be shot", far.block === "out_of_range", far.block);
  const longShot = previewShot(m, s, unit(2, 1, "rifleman", 10, 5));
  check("at max range accuracy is halved", Math.round(longShot.chance * 100) === 38, `${longShot.chance}`);
  const friend = previewShot(m, s, unit(2, 0, "rifleman", 4, 5));
  check("no friendly fire", friend.block === "same_side");
}
{
  const m = board("shoot-cover", (b) => {
    b.pen().tile(5, 5, "crate");
    b.pen().tile(3, 8, "crate");
    b.pen().tile(4, 2, "crate");
  });
  const near = previewShot(m, unit(1, 0, "rifleman", 2, 5), unit(2, 1, "rifleman", 6, 5, { facing: 6 }));
  check("a crate beside the target is cover: x0.6", near.inCover && Math.round(near.chance * 100) === 45, `${near.chance}`);
  const mine = previewShot(m, unit(1, 0, "rifleman", 2, 8), unit(2, 1, "rifleman", 6, 8, { facing: 6 }));
  check("a crate beside the shooter costs nothing", !mine.inCover && Math.round(mine.chance * 100) === 75, `${mine.chance}`);
  const between = previewShot(m, unit(1, 0, "rifleman", 1, 2), unit(2, 1, "rifleman", 7, 2, { facing: 6 }));
  // 75 x long range (6 tiles: 1 - 0.5 * 1/3) x 0.85 obstruction = 53.1
  check("a crate midway partly obstructs: x0.85", !between.inCover && Math.round(between.chance * 100) === 53, `${between.chance}`);
  const breach = previewShot(m, unit(1, 0, "breacher", 3, 5), unit(2, 1, "rifleman", 6, 5));
  check("a breacher further than 2.5 tiles still respects cover", breach.inCover);
  const breachClose = previewShot(m, unit(1, 0, "breacher", 4, 4), unit(2, 1, "rifleman", 6, 5));
  check("up close the breacher ignores it", breachClose.possible && !breachClose.inCover, JSON.stringify(breachClose.modifiers));
}
{
  const m = board("shoot-forest", (b) => b.pen().tile(6, 5, "forest"));
  const p = previewShot(m, unit(1, 0, "rifleman", 2, 5), unit(2, 1, "rifleman", 6, 5));
  check("a target standing in woods is in cover", p.inCover);
}
{
  const m = board("shoot-traits");
  const shooter = unit(1, 0, "rifleman", 2, 5);
  check("a riot shield takes 60% off frontal hits", previewShot(m, shooter, unit(2, 1, "riot", 4, 5, { facing: 6 })).damage === 12);
  check("but not from behind", previewShot(m, shooter, unit(2, 1, "riot", 4, 5, { facing: 2 })).damage === 45);
  check("heavy armour takes 20% off", previewShot(m, shooter, unit(2, 1, "heavy", 4, 5, { facing: 6 })).damage === 24);
  const knife = previewShot(m, unit(1, 0, "commando", 2, 5), unit(2, 1, "rifleman", 4, 5, { facing: 2 }));
  check("a commando's backstab is 2.5x", knife.damage === 88, `${knife.damage}`);
  const still = previewShot(m, unit(1, 0, "sniper", 0, 5), unit(2, 1, "rifleman", 8, 5));
  const moved = previewShot(m, unit(1, 0, "sniper", 0, 5, { moved: true }), unit(2, 1, "rifleman", 8, 5));
  check("a sniper that moved has half accuracy", Math.round(still.chance * 100) === 85 && Math.round(moved.chance * 100) === 43, `${still.chance} / ${moved.chance}`);
  const close = previewShot(m, unit(1, 0, "sniper", 0, 5), unit(2, 1, "rifleman", 2, 5));
  check("and half up close", Math.round(close.chance * 100) === 43, `${close.chance}`);
}
{
  const p = { possible: true, distance: 1, chance: 0.5, damage: 30, flank: "front" as const, inCover: false, modifiers: [] };
  check("a roll at or above the chance misses", !rollShot(p, 0.5).hit && !rollShot(p, 0.9).hit);
  check("below it hits", rollShot(p, 0.3).hit && !rollShot(p, 0.3).crit && rollShot(p, 0.3).damage === 30);
  check("the bottom tenth of the hit range crits for 1.5x", rollShot(p, 0.04).crit && rollShot(p, 0.04).damage === 45);
}

// ---------------------------------------------------------------------------
section("Simultaneous movement");

interface MoveSpec {
  unitId: number;
  path: Point[];
  facing?: number;
}

/** Both seats submit the given moves; returns what the resolution produced. */
function resolve(state: GameState, seat0: MoveSpec[], seat1: MoveSpec[] = []) {
  const orders = (moves: MoveSpec[]) => ({
    moves: moves.map((m) => ({ unitId: m.unitId, path: m.path, facing: (m.facing ?? 2) as Unit["facing"] })),
    spawns: [],
  });
  const s = applyAction(state, { type: "orders", seat: 0, orders: orders(seat0) }, roll(0.5)).state;
  return applyAction(s, { type: "orders", seat: 1, orders: orders(seat1) }, roll(0.5));
}
const row = (y: number, ...xs: number[]) => xs.map((x) => ({ x, y }));

{
  board("lockstep");
  const s = stateOn("lockstep", [unit(1, 0, "rifleman", 2, 6), unit(2, 1, "rifleman", 4, 6)]);
  const r = resolve(s, [{ unitId: 1, path: row(6, 3) }], [{ unitId: 2, path: row(6, 3) }]).state;
  check("two units aiming for one tile both stop", pos(at(r, 1)) === "2,6" && pos(at(r, 2)) === "4,6", `${pos(at(r, 1))} ${pos(at(r, 2))}`);
}
{
  const s = stateOn("lockstep", [unit(1, 0, "rifleman", 2, 6), unit(2, 1, "rifleman", 3, 6)]);
  const r = resolve(s, [{ unitId: 1, path: row(6, 3) }], [{ unitId: 2, path: row(6, 2) }]).state;
  check("two units can't swap places", pos(at(r, 1)) === "2,6" && pos(at(r, 2)) === "3,6");
}
{
  const s = stateOn("lockstep", [unit(1, 0, "rifleman", 2, 6), unit(2, 0, "rifleman", 3, 6)]);
  const r = resolve(s, [
    { unitId: 1, path: row(6, 3, 4) },
    { unitId: 2, path: row(6, 4, 5) },
  ]).state;
  check("a unit can follow one moving ahead of it", pos(at(r, 1)) === "4,6" && pos(at(r, 2)) === "5,6", `${pos(at(r, 1))} ${pos(at(r, 2))}`);
}
{
  const s = stateOn("lockstep", [unit(1, 0, "rifleman", 2, 6), unit(2, 1, "rifleman", 5, 6, { facing: 6 })]);
  const { state: r, events } = resolve(s, [{ unitId: 1, path: row(6, 3, 4, 5, 6), facing: 0 }]);
  const mover = at(r, 1)!;
  check("walking into an unseen enemy stops you in front of it", pos(mover) === "4,6", pos(mover));
  check("facing it, not the facing you ordered", mover.facing === 2, `${mover.facing}`);
  check("the move event says it bumped", events.some((e) => e.type === "move" && e.unitId === 1 && e.bumped));
  check("movement is followed by the attack phase", r.phase === "attack" && r.attackTurn === 0, `${r.phase} ${r.attackTurn}`);
}
{
  const s = stateOn("lockstep", [unit(1, 0, "rifleman", 2, 6), unit(2, 0, "rifleman", 4, 6)]);
  const code = codeOf(() =>
    applyAction(s, { type: "orders", seat: 0, orders: { moves: [{ unitId: 1, path: row(6, 3, 4), facing: 2 }], spawns: [] } }, roll(0.5)),
  );
  check("you can't plan to end on a teammate who is staying put", code === "duplicate_destination", code);
  const theirs = codeOf(() =>
    applyAction(s, { type: "orders", seat: 1, orders: { moves: [{ unitId: 1, path: [], facing: 2 }], spawns: [] } }, roll(0.5)),
  );
  check("or give orders to someone else's unit", theirs === "not_your_unit", theirs);
}

// ---------------------------------------------------------------------------
section("Deploying");

{
  const s = newGame("crossroads", 2);
  const spawn = (x: number, y: number, kind: UnitKind = "rifleman") =>
    codeOf(() => applyAction(s, { type: "orders", seat: 0, orders: { moves: [], spawns: [{ kind, x, y, facing: 2 }] } }, roll(0.5)));
  const base = getMap("crossroads").bases[0]![0]!;
  check("deploying on your base is allowed", spawn(base.x, base.y) === "no error", spawn(base.x, base.y));
  check("anywhere else is not", spawn(6, 6) === "bad_spawn_tile");
  check("the enemy base is not yours", spawn(24, 8) === "bad_spawn_tile");
  const tooMuch = codeOf(() =>
    applyAction(s, { type: "orders", seat: 0, orders: { moves: [], spawns: getMap("crossroads").bases[0]!.slice(0, 3).map((p) => ({ kind: "heavy" as const, ...p, facing: 2 as const })) } }, roll(0.5)),
  );
  check("you can't spend more than you have", tooMuch === "not_enough_gold", tooMuch);

  let g = applyAction(s, { type: "orders", seat: 0, orders: { moves: [], spawns: [{ kind: "rifleman", x: base.x, y: base.y, facing: 2 }] } }, roll(0.5)).state;
  check("orders wait until everyone is in", g.phase === "planning" && g.units.length === 0);
  g = applyAction(g, { type: "orders", seat: 1, orders: { moves: [], spawns: [] } }, roll(0.5)).state;
  check("then the unit appears", g.units.length === 1 && g.units[0]!.seat === 0);
  check("with nothing in range the attack phase is skipped", g.phase === "planning" && g.round === 2, `${g.phase} ${g.round}`);
  check("gold: 300 - 100 + 50 income", g.seats[0]!.gold === 250 && g.seats[1]!.gold === 350, `${g.seats[0]!.gold} ${g.seats[1]!.gold}`);
}

// ---------------------------------------------------------------------------
section("Attack turns");

{
  board("duel");
  // Two riflemen facing each other 4 tiles apart, each with a backup.
  const s = stateOn("duel", [
    unit(1, 0, "rifleman", 3, 5, { facing: 2 }),
    unit(2, 0, "rifleman", 3, 6, { facing: 2 }),
    unit(3, 1, "rifleman", 7, 5, { facing: 6 }),
    unit(4, 1, "scout", 7, 6, { facing: 6, hp: 10 }),
  ]);
  let r = resolve(s, [], []);
  check("round 1: seat 0 shoots first", r.state.phase === "attack" && r.state.attackTurn === 0);
  const wrong = codeOf(() => applyAction(r.state, { type: "attack", seat: 1, unitId: 3, targetId: 1 }, roll(0)));
  check("seat 1 has to wait its turn", wrong === "not_your_turn", wrong);
  r = applyAction(r.state, { type: "attack", seat: 0, unitId: 1, targetId: 4 }, roll(0.2));
  const shot = r.events.find((e) => e.type === "shot");
  check("a hit kills a wounded scout", shot?.type === "shot" && shot.hit && shot.killed && !at(r.state, 4));
  check("losing a unit with base tiles left keeps you in", !r.state.seats[1]!.eliminated);
  check("and the turn passes", r.state.attackTurn === 1);
  const twice = codeOf(() => applyAction(r.state, { type: "attack", seat: 0, unitId: 1, targetId: 3 }, roll(0)));
  check("you can't act out of turn", twice === "not_your_turn", twice);
  r = applyAction(r.state, { type: "attack", seat: 1, unitId: 3, targetId: 1 }, roll(0.99));
  check("a miss does nothing", at(r.state, 1)!.hp === 100);
  check("back to seat 0 for its second unit", r.state.attackTurn === 0);
  const again = codeOf(() => applyAction(r.state, { type: "attack", seat: 0, unitId: 1, targetId: 3 }, roll(0)));
  check("each unit acts once", again === "already_acted", again);
  r = applyAction(r.state, { type: "hold", seat: 0, unitId: 2 }, roll(0));
  check("when nobody has anything left, the round ends", r.state.phase === "planning" && r.state.round === 2, `${r.state.phase} ${r.state.round}`);
  check("the unit that was shot at but missed heals", at(r.state, 1)!.hp === 100);
}
{
  const s = stateOn("duel", [unit(1, 0, "rifleman", 3, 5, { facing: 2 }), unit(3, 1, "rifleman", 7, 5, { facing: 6 })]);
  s.round = 2;
  const r = resolve(s, [], []);
  check("round 2: the lead passes to seat 1", r.state.attackTurn === 1);
}
{
  const s = stateOn("duel", [unit(1, 0, "rifleman", 3, 5, { facing: 2 }), unit(3, 1, "rifleman", 7, 5, { facing: 6, hp: 5 })]);
  s.baseOwners = s.baseOwners.map((o) => (o === 1 ? 0 : o));
  let r = resolve(s, [], []);
  r = applyAction(r.state, { type: "attack", seat: 0, unitId: 1, targetId: 3 }, roll(0));
  check("losing your last unit with no base tiles left knocks you out at once", r.state.seats[1]!.eliminated);
  check("and the last seat standing wins", r.state.phase === "over" && r.state.winner === 0, `${r.state.phase} ${r.state.winner}`);
}
{
  const s = stateOn("duel", [unit(1, 0, "rifleman", 3, 5, { facing: 2 }), unit(3, 1, "rifleman", 7, 5, { facing: 6 })]);
  const r = applyAction(s, { type: "resign", seat: 1 }, roll(0));
  check("resigning ends a two-player game", r.state.phase === "over" && r.state.winner === 0);
}

// ---------------------------------------------------------------------------
section("Upkeep: captures, income, healing");

{
  board("sites", (b) => {
    b.pen().post(5, 5);
    b.pen().income(8, 8, 25);
  });
  let s = stateOn("sites", [unit(1, 0, "rifleman", 5, 5), unit(2, 0, "rifleman", 8, 8)]);
  s = resolve(s, [], []).state;
  check("standing on a neutral post takes it", s.postOwners[0] === 0);
  check("only engineers take income sites", s.incomeOwners[0] === null);
  check("holding more posts costs the other side nothing by itself (no tickets)", !s.seats[1]!.eliminated && !("tickets" in s.seats[1]!));

  s.units = [unit(5, 1, "engineer", 5, 5), unit(6, 1, "engineer", 8, 8)];
  s = resolve(s, [], []).state;
  check("an enemy on your post makes it neutral first", s.postOwners[0] === null);
  check("an engineer takes the income site", s.incomeOwners[0] === 1);
  check("which pays out the same round", s.seats[1]!.gold === RULES.startGold + 2 * RULES.baseIncome + 25, `${s.seats[1]!.gold}`);
  s = resolve(s, [], []).state;
  check("a second round flips the post to them", s.postOwners[0] === 1);

  s.units = [unit(7, 0, "rifleman", 2, 2, { hp: 50 }), unit(8, 0, "rifleman", 6, 2, { hp: 50 }), unit(9, 0, "engineer", 6, 3)];
  s = resolve(s, [], []).state;
  check("an unhurt unit heals 10 a round", at(s, 7)!.hp === 60, `${at(s, 7)!.hp}`);
  check("and 10 more beside an engineer", at(s, 8)!.hp === 70, `${at(s, 8)!.hp}`);
}
{
  board("timeout");
  const s = stateOn("timeout", [unit(1, 0, "rifleman", 0, 0)]);
  s.round = RULES.roundLimit;
  // Seat 0 is well ahead: it holds one of seat 1's base tiles too. Still a draw.
  s.baseOwners[s.baseOwners.indexOf(1)] = 0;
  const r = resolve(s, [], []).state;
  check("at the round limit it's a draw, however far ahead anyone is", r.phase === "over" && r.winner === null, `${r.phase} ${r.winner}`);
}

// ---------------------------------------------------------------------------
section("Bases: captured tile by tile, like command posts");

{
  // Seat 0's base: (0,0) (1,0) (0,1) (1,1). Seat 1's: (11,11) (10,11).
  const map = board("bases");
  const tiles = baseTiles(map, 2);
  const idx = (x: number, y: number) => tiles.findIndex((t) => t.x === x && t.y === y);
  const a = idx(11, 11);
  let s = stateOn("bases", [unit(1, 0, "rifleman", 11, 11), unit(2, 1, "rifleman", 5, 5)]);
  check("every base tile starts owned by its home seat", s.baseOwners.every((o, i) => o === tiles[i]!.home), s.baseOwners.join(","));
  let r = resolve(s, [], []);
  s = r.state;
  check("an enemy alone on a base tile turns it neutral", s.baseOwners[a] === null, String(s.baseOwners[a]));
  const ev = r.events.find((e) => e.type === "capture" && e.site === "base");
  check("with a capture event naming the base tile", ev?.type === "capture" && ev.index === a && ev.from === 1 && ev.to === null);
  r = resolve(s, [], []);
  s = r.state;
  check("the next round it becomes theirs", s.baseOwners[a] === 0);

  // Captured base tiles are spawn tiles for the captor, and lost ones are not for the loser.
  s.units = s.units.filter((u) => u.id !== 1);
  const spawnAt = (seat: number, x: number, y: number) =>
    codeOf(() => applyAction(s, { type: "orders", seat, orders: { moves: [], spawns: [{ kind: "scout", x, y, facing: 6 }] } }, roll(0.5)));
  check("the captor can deploy on a captured base tile", spawnAt(0, 11, 11) === "no error", spawnAt(0, 11, 11));
  check("the side that lost it can't", spawnAt(1, 11, 11) === "bad_spawn_tile", spawnAt(1, 11, 11));
  check("but can still deploy on the base tiles it kept", spawnAt(1, 10, 11) === "no error", spawnAt(1, 10, 11));

  // Taking it back works the same way.
  s.units = [unit(5, 1, "rifleman", 11, 11), unit(6, 0, "rifleman", 5, 5)];
  s = resolve(s, [], []).state;
  s = resolve(s, [], []).state;
  check("the owner can retake it: neutral, then theirs again", s.baseOwners[a] === 1, String(s.baseOwners[a]));
}
{
  board("bases-blocked");
  const tiles = baseTiles(getMap("bases-blocked"), 2);
  const a = tiles.findIndex((t) => t.x === 11 && t.y === 11);
  // A defender standing on its own base tile: nothing happens to it.
  let s = stateOn("bases-blocked", [unit(1, 1, "rifleman", 11, 11), unit(2, 0, "rifleman", 2, 6, { facing: 6 })]);
  s = resolve(s, [], []).state;
  check("a defender standing on its own base tile keeps it", s.baseOwners[a] === 1);
  // An enemy on a tile already neutral (or theirs) after the other seat's unit leaves...
  s.baseOwners[a] = null;
  s.units = [unit(1, 1, "rifleman", 11, 11)];
  s = resolve(s, [], []).state;
  check("a side standing on its own neutral base tile takes it back", s.baseOwners[a] === 1);
}
{
  // Out only when you own no base tiles AND have no units.
  board("knockout", (b) => b.pen().post(6, 6));
  const s = stateOn("knockout", []);
  let r = resolve(s, [], []).state;
  check("no units but base tiles left: still in", !r.seats[1]!.eliminated && r.phase === "planning");
  const t = stateOn("knockout", [unit(1, 1, "scout", 7, 7), unit(2, 0, "rifleman", 0, 0)]);
  t.baseOwners = t.baseOwners.map((o) => (o === 1 ? null : o));
  r = resolve(t, [], []).state;
  check("no base tiles but a unit left: still in", !r.seats[1]!.eliminated && r.phase === "planning");
  const u = stateOn("knockout", [unit(2, 0, "rifleman", 0, 0)]);
  u.baseOwners = u.baseOwners.map((o) => (o === 1 ? null : o));
  u.postOwners = u.postOwners.map(() => 1);
  r = resolve(u, [], []).state;
  check("no base tiles and no units: out, even holding command posts", r.seats[1]!.eliminated);
  check("and the last side standing wins", r.phase === "over" && r.winner === 0, `${r.phase} ${r.winner}`);
}
{
  // Four seats: one by one until one is left.
  const b = new MapBuilder({ id: "four-test", name: "four-test", blurb: "", width: 12, height: 12, seats: 4 });
  b.bases[0] = [{ x: 0, y: 0 }];
  b.bases[1] = [{ x: 11, y: 0 }];
  b.bases[2] = [{ x: 11, y: 11 }];
  b.bases[3] = [{ x: 0, y: 11 }];
  b.pen().post(6, 6);
  registerMap(b.build());
  const everyone = (g: GameState) => {
    for (const seat of g.seats) if (!seat.eliminated && g.phase === "planning") g = applyAction(g, { type: "orders", seat: seat.seat, orders: { moves: [], spawns: [] } }, roll(0.5)).state;
    return g;
  };
  let g = newGame("four-test", 4);
  g.units = [unit(1, 0, "rifleman", 0, 0), unit(2, 0, "rifleman", 11, 0)];
  g.baseOwners = [0, null, null, 3];
  g = everyone(g);
  check("4 seats: two sides with nothing left go out in the same round", g.seats[1]!.eliminated && g.seats[2]!.eliminated && !g.seats[3]!.eliminated);
  check("and the game goes on while two remain", g.phase === "planning");
  g.baseOwners = [0, 0, null, null];
  g = everyone(g);
  check("4 seats: the last one standing wins", g.phase === "over" && g.winner === 0, `${g.phase} ${g.winner}`);
}

// ---------------------------------------------------------------------------
section("Fog of war");

{
  board("fog", (b) => {
    b.pen().vwall(6, 0, 12);
  });
  const s = stateOn("fog", [
    unit(1, 0, "rifleman", 3, 5),
    unit(2, 1, "rifleman", 8, 5),
    unit(3, 1, "commando", 3, 1),
    unit(4, 1, "commando", 5, 5),
  ]);
  const v = viewFor(s, 0);
  const ids = v.units.map((u) => u.id).sort();
  check("an enemy behind a wall is not sent", !ids.includes(2), ids.join(","));
  check("a commando 4 tiles away in the open is not sent", !ids.includes(3));
  check("one 2 tiles away is", ids.includes(4));
  check("own units always are", ids.includes(1));
  check("enemy gold is not in the view", v.gold === RULES.startGold && !("orders" in v));
  const over = viewFor({ ...s, phase: "over" }, 0);
  check("when the game is over the fog lifts", over.units.length === 4);
}

// ---------------------------------------------------------------------------
section("Replay");

{
  const script = (): GameState => {
    let g = newGame("crossroads", 2);
    const map = getMap("crossroads");
    const actions: Action[] = [
      { type: "orders", seat: 0, orders: { moves: [], spawns: map.bases[0]!.slice(0, 2).map((p) => ({ kind: "rifleman" as const, ...p, facing: 2 as const })) } },
      { type: "orders", seat: 1, orders: { moves: [], spawns: map.bases[1]!.slice(0, 2).map((p) => ({ kind: "scout" as const, ...p, facing: 6 as const })) } },
    ];
    actions.forEach((a, i) => (g = applyAction(g, a, streamFor("seed-1", i)).state));
    return g;
  };
  check("the same seed and actions rebuild the same state", JSON.stringify(script()) === JSON.stringify(script()));
  const a = streamFor("s", 1)();
  const b = streamFor("s", 2)();
  check("each action gets its own stream", a !== b && a >= 0 && a < 1);
}

// ---------------------------------------------------------------------------
section("Tuning files: checked, and snapshotted per game");

{
  check("the files in tuning/ pass the check", FILE_TUNING.units.rifleman.cost > 0 && RULES.startGold === FILE_TUNING.rules.startGold);
  const errorOf = (mutate: (t: { rules: Record<string, unknown>; units: Record<string, Record<string, unknown>> }) => void) => {
    const raw = structuredClone(FILE_TUNING) as unknown as { rules: Record<string, unknown>; units: Record<string, Record<string, unknown>> };
    mutate(raw);
    try {
      checkTuning(raw);
      return "no error";
    } catch (e) {
      return e instanceof TuningError ? e.message : `unexpected: ${String(e)}`;
    }
  };
  const missing = errorOf((t) => delete t.units.scout!.cost);
  check("a missing field names the file and field", missing.includes("tuning/units/scout.json") && missing.includes('"cost"'), missing);
  const typed = errorOf((t) => (t.units.heavy!.hp = "lots"));
  check("a wrong type is refused", typed.includes("heavy.json") && typed.includes("must be a number"), typed);
  const negative = errorOf((t) => (t.units.sniper!.cost = -5));
  check("a negative cost is refused", negative.includes("sniper.json") && negative.includes('"cost"'), negative);
  const trait = errorOf((t) => (t.units.riot!.traits = ["sheild"]));
  check("an unknown trait is refused, listing the real ones", trait.includes("riot.json") && trait.includes('"sheild"') && trait.includes("shield"), trait);
  const typo = errorOf((t) => (t.rules.statGold = 5));
  check("a misspelt field is caught", typo.includes("rules.json") && typo.includes('"statGold"'), typo);
  const flank = errorOf((t) => ((t.rules.flank as Record<string, unknown>).rear = null));
  check("nested rule numbers are checked too", flank.includes('"flank.rear"'), flank);
}
{
  // A game played under one tuning replays identically under its snapshot,
  // even after the files change; replaying it under the new numbers would not.
  board("snapshot");
  const original: Tuning = structuredClone(FILE_TUNING);
  const changed: Tuning = structuredClone(FILE_TUNING);
  changed.units.rifleman.damage = 99;
  const play = () => {
    let g = stateOn("snapshot", [unit(1, 0, "rifleman", 3, 5, { facing: 2 }), unit(2, 1, "heavy", 7, 5, { facing: 6 })]);
    const log: Action[] = [
      { type: "orders", seat: 0, orders: { moves: [], spawns: [] } },
      { type: "orders", seat: 1, orders: { moves: [], spawns: [] } },
      { type: "attack", seat: 0, unitId: 1, targetId: 2 },
    ];
    // A fixed roll that hits without a crit, so the damage number shows.
    log.forEach((a) => (g = applyAction(g, a, roll(0.2)).state));
    return JSON.stringify(g);
  };
  // As games.ts does: the snapshot is stored as JSON when the game is made...
  const stored = JSON.stringify(original);
  const before = withTuning(original, play);
  // ...and the files change afterwards (`changed` active); the replay uses the snapshot.
  const replayed = withTuning(changed, () => withTuning(checkTuning(JSON.parse(stored)), play));
  check("a game replays identically under its own snapshot after the files change", before === replayed);
  check("under the changed numbers the same log would not", withTuning(changed, play) !== before);
  check("withTuning puts the previous tuning back", UNITS.rifleman.damage === FILE_TUNING.units.rifleman.damage);
}

console.log(`\n${failures === 0 ? "All rules hold." : `${failures} problem(s).`}\n`);
if (failures > 0) process.exit(1);
