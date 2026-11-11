// The rules engine, exhaustively: geometry, sight, movement, shooting, the
// round structure, captures, the economy and replay determinism. No server, no
// browser. Behaviour that looks odd but is deliberate is pinned here too, so a
// later change cannot quietly "fix" it.
//   npx tsx scripts/test-rules.ts
import { facingToward, stepOpen } from "../src/game/grid.js";
import { traceLine } from "../src/game/los.js";
import { MAPS, MapBuilder, getMap, registerMap, symmetryTransforms } from "../src/game/maps.js";
import { checkMap } from "../src/game/mapcheck.js";
import { pathTo, reachable, validatePath } from "../src/game/movement.js";
import { damageRange, previewShot, rollShot, type ShotPreview } from "../src/game/combat.js";
import { applyAction, isFacing, newGame, readyShooters, targetsFor, validateOrders } from "../src/game/rules.js";
import { streamFor } from "../src/game/rng.js";
import { UNITS, UNIT_KINDS } from "../src/game/units.js";
import { viewFor } from "../src/game/view.js";
import { replaySteps, type ReplayLog } from "../src/game/replay.js";
import { BOT_LEVELS, chooseAction, type BotLevel } from "../src/game/bot.js";
import { RuleError, type Action, type GameEvent, type GameState, type MapDef, type Point, type Unit, type UnitKind } from "../src/game/types.js";
import { RULES } from "../src/game/constants.js";
import { baseTiles, spawnTiles, visibleTiles } from "../src/game/visibility.js";
import { FILE_TUNING, TuningError, checkTuning, upgradeSnapshot, withTuning, type Tuning } from "../src/game/tuning.js";

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
  return { id, seat, kind, x, y, facing: 90, hp: UNITS[kind].hp, moved: false, damaged: false, fired: false, ...extra };
}

/** Facings in degrees: 0 north, clockwise. */
const N = 0;
const E = 90;
const S = 180;
const W = 270;

/** A chance as the rules compute it: the product of the factors, rounded and clamped, as a percentage. */
const pct = (...factors: number[]) =>
  Math.min(RULES.maxHitChance, Math.max(RULES.minHitChance, Math.round(factors.reduce((a, b) => a * b, 1))));
const chanceOf = (p: ShotPreview) => Math.round(p.chance * 100);

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
  // Game 3xaupj: a rifleman inside a house shot out through the corner where
  // its north wall met its west window.
  const m = board("los-wall-window", (b) => {
    b.pen().edge(3, 3, "n", "wall");
    b.pen().edge(3, 3, "w", "window");
  });
  check("a wall meeting a window at a corner blocks a diagonal through it", !traceLine(m, { x: 4, y: 4 }, { x: 2, y: 2 }).clear);
  const w = board("los-window-window", (b) => {
    b.pen().edge(3, 3, "n", "window");
    b.pen().edge(3, 3, "w", "window");
  });
  const line = traceLine(w, { x: 4, y: 4 }, { x: 2, y: 2 });
  check("two windows meeting at a corner are a window", line.clear && line.obstacles.some((o) => o.kind === "window"));
  // A game created before the fix replays as it was played.
  const { rulesRevision: _, ...oldRules } = FILE_TUNING.rules;
  const old = upgradeSnapshot({ version: 2, rules: oldRules, units: FILE_TUNING.units as unknown as Record<string, unknown> });
  check("a snapshot from before rules revision 1 reads as revision 0", old.rules.rulesRevision === 0 && FILE_TUNING.rules.rulesRevision >= 1);
  check("and under it the wall-and-window corner still lets the line through", withTuning(old, () => traceLine(m, { x: 4, y: 4 }, { x: 2, y: 2 }).clear));
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
  const M = UNITS.rifleman.move;
  const diag = Math.floor(M / 1.5);
  const diagonal = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i + 1, y: i + 1 }));
  check(`a rifleman walks its move (${M}) in a straight line`, reach.cost.has(5 * m.width + M));
  check("but not a tile further", !reach.cost.has(5 * m.width + M + 1));
  check(`${diag} diagonal steps cost ${diag * 1.5} tiles: in range`, validatePath(m, unit(2, 0, "rifleman", 0, 0), diagonal(diag)) === "ok");
  check(`${diag + 1} cost ${(diag + 1) * 1.5}: too far`, validatePath(m, unit(2, 0, "rifleman", 0, 0), diagonal(diag + 1)) === "path_too_long");
  check("teleporting is not a path", validatePath(m, r, [{ x: 3, y: 5 }]) === "bad_path");
  const path = pathTo(m, reach, { x: 3, y: 5 });
  check("pathTo rebuilds the route without the start", path?.length === 3 && path[2]!.x === 3, JSON.stringify(path));
  const blocked = reachable(m, r, new Set([5 * m.width + 1]));
  check("a blocked tile (a seen enemy) can end a route", blocked.cost.has(5 * m.width + 1));
  const past = pathTo(m, blocked, { x: 2, y: 5 });
  check("but a route never passes through it", !!past && !past.some((p) => p.x === 1 && p.y === 5), JSON.stringify(past));
}
{
  const m = board("move-forest", (b) => b.pen().rect(1, 0, 11, 12, "forest"));
  const reach = reachable(m, unit(1, 0, "rifleman", 0, 5), new Set());
  // Each step into woods costs two: a move of n gets floor(n / 2) steps in.
  const steps = Math.floor(UNITS.rifleman.move / 2);
  check(`woods cost double: ${steps} step(s) in, not ${steps + 1}`, reach.cost.has(5 * m.width + steps) && !reach.cost.has(5 * m.width + steps + 1));
}

// ---------------------------------------------------------------------------
section("Shooting");

{
  const m = board("shoot-open");
  const rifle = UNITS.rifleman;
  const s = unit(1, 0, "rifleman", 2, 5, { facing: E });
  const facingMe = previewShot(m, s, unit(2, 1, "rifleman", 6, 5, { facing: W }));
  check("open ground at optimal range: base accuracy", facingMe.possible && chanceOf(facingMe) === rifle.accuracy, `${facingMe.chance}`);
  check("a hit from the front does base damage", facingMe.flank === "front" && facingMe.damage === rifle.damage, `${facingMe.flank} ${facingMe.damage}`);
  const back = previewShot(m, s, unit(2, 1, "rifleman", 6, 5, { facing: E }));
  check("from behind: flank.rear", back.flank === "rear" && back.damage === Math.round(rifle.damage * RULES.flank.rear), `${back.flank} ${back.damage}`);
  const side = previewShot(m, s, unit(2, 1, "rifleman", 6, 5, { facing: N }));
  check("from the side: flank.side", side.flank === "side" && side.damage === Math.round(rifle.damage * RULES.flank.side), `${side.flank} ${side.damage}`);
  const oblique = previewShot(m, s, unit(2, 1, "rifleman", 6, 5, { facing: 300 }));
  check("any facing in degrees works: 300 is within 60 of facing the shooter", oblique.flank === "front", oblique.flank);
  const arc = previewShot(m, unit(1, 0, "rifleman", 2, 5, { facing: N }), unit(2, 1, "rifleman", 6, 5));
  check("a target 90 degrees off a 120 degree arc can't be shot", arc.block === "outside_arc", arc.block);
  const nudged = previewShot(m, unit(1, 0, "rifleman", 2, 5, { facing: 35 }), unit(2, 1, "rifleman", 6, 5));
  check("turned to 35 degrees, it is 55 off: inside the arc", nudged.possible, nudged.block);
  const far = previewShot(m, s, unit(2, 1, "rifleman", 11, 5));
  check("beyond range can't be shot", far.block === "out_of_range", far.block);
  const longShot = previewShot(m, s, unit(2, 1, "rifleman", 10, 5));
  check("at max range accuracy falls to longRangeAccuracy", chanceOf(longShot) === pct(rifle.accuracy, RULES.longRangeAccuracy), `${longShot.chance}`);
  const friend = previewShot(m, s, unit(2, 0, "rifleman", 4, 5));
  check("no friendly fire", friend.block === "same_side");
}
{
  const m = board("shoot-cover", (b) => {
    b.pen().tile(5, 5, "crate");
    b.pen().tile(3, 8, "crate");
    b.pen().tile(4, 2, "crate");
  });
  const acc = UNITS.rifleman.accuracy;
  const near = previewShot(m, unit(1, 0, "rifleman", 2, 5), unit(2, 1, "rifleman", 6, 5, { facing: W }));
  check("a crate beside the target is cover: x coverFactor", near.inCover && chanceOf(near) === pct(acc, RULES.coverFactor), `${near.chance}`);
  const mine = previewShot(m, unit(1, 0, "rifleman", 2, 8), unit(2, 1, "rifleman", 6, 8, { facing: W }));
  check("a crate beside the shooter costs nothing", !mine.inCover && chanceOf(mine) === acc, `${mine.chance}`);
  const between = previewShot(m, unit(1, 0, "rifleman", 1, 2), unit(2, 1, "rifleman", 7, 2, { facing: W }));
  // 6 tiles: one past optimal (5) of the three to max range (8).
  const longF = 1 - ((1 - RULES.longRangeAccuracy) * 1) / 3;
  check("a crate midway partly obstructs: x obstructionFactor", !between.inCover && chanceOf(between) === pct(acc, longF, RULES.obstructionFactor), `${between.chance}`);
  const gun = previewShot(m, unit(1, 0, "shotgun", 3, 5), unit(2, 1, "rifleman", 6, 5));
  check("a shotgun further than closeQuartersRange still respects cover", gun.inCover);
  const gunClose = previewShot(m, unit(1, 0, "shotgun", 4, 4), unit(2, 1, "rifleman", 6, 5));
  check("up close the shotgun ignores it", gunClose.possible && !gunClose.inCover, JSON.stringify(gunClose.modifiers));
}
{
  const m = board("shoot-forest", (b) => b.pen().tile(6, 5, "forest"));
  const p = previewShot(m, unit(1, 0, "rifleman", 2, 5), unit(2, 1, "rifleman", 6, 5));
  check("a target standing in woods is in cover", p.inCover);
}
{
  const m = board("shoot-traits", () => {}, 16, 12);
  const shooter = unit(1, 0, "rifleman", 2, 5);
  const acc = UNITS.rifleman.accuracy;
  const shieldFront = previewShot(m, shooter, unit(2, 1, "riot", 4, 5, { facing: W }));
  check("a riot shield makes frontal shots rarely hit: x shieldFrontHit", chanceOf(shieldFront) === pct(acc, RULES.traits.shieldFrontHit), `${shieldFront.chance}`);
  check("but never impossible", shieldFront.chance > 0 && shieldFront.possible);
  const gunShield = previewShot(m, unit(3, 0, "shotgun", 2, 5, { facing: E }), unit(2, 1, "riot", 4, 5, { facing: W }));
  check("a shotgun punches through the shield: x shieldBreakerHit instead", chanceOf(gunShield) === pct(UNITS.shotgun.accuracy, RULES.traits.shieldBreakerHit), `${gunShield.chance}`);
  check("so it is the better answer to a riot than a rifle", gunShield.chance > shieldFront.chance * 2);
  check("a shield changes the chance, not the damage", shieldFront.damage === UNITS.rifleman.damage, `${shieldFront.damage}`);
  const shieldBack = previewShot(m, shooter, unit(2, 1, "riot", 4, 5, { facing: E }));
  check("from behind the shield does nothing", chanceOf(shieldBack) === acc && shieldBack.damage === Math.round(UNITS.rifleman.damage * RULES.flank.rear));
  check("the heavy is not armoured", previewShot(m, shooter, unit(2, 1, "heavy", 4, 5, { facing: W })).damage === UNITS.rifleman.damage);
  const knife = previewShot(m, unit(1, 0, "commando", 2, 5), unit(2, 1, "rifleman", 4, 5, { facing: E }));
  check("a commando's backstab from 2 tiles: backstabMultiplier", !knife.fatal && knife.damage === Math.round(UNITS.commando.damage * RULES.traits.backstabMultiplier), `${knife.damage}`);
  const sn = UNITS.sniper;
  const still = previewShot(m, unit(1, 0, "sniper", 0, 5), unit(2, 1, "rifleman", sn.optimal, 5));
  const moved = previewShot(m, unit(1, 0, "sniper", 0, 5, { moved: true }), unit(2, 1, "rifleman", sn.optimal, 5));
  check("a braced sniper at its best range: full accuracy", chanceOf(still) === pct(sn.accuracy), `${still.chance}`);
  check("one that moved: x steadyPenalty", chanceOf(moved) === pct(sn.accuracy, RULES.traits.steadyPenalty), `${moved.chance}`);
  const at2 = previewShot(m, unit(1, 0, "sniper", 0, 5), unit(2, 1, "rifleman", 2, 5));
  const at6 = previewShot(m, unit(1, 0, "sniper", 0, 5), unit(2, 1, "rifleman", 6, 5));
  check("the scope: the closer the target, the worse the aim", at2.chance < at6.chance && at6.chance < still.chance, `${at2.chance} < ${at6.chance} < ${still.chance}`);
  const at1 = previewShot(m, unit(1, 0, "sniper", 0, 5), unit(2, 1, "rifleman", 1, 5));
  check("next to it: x scopedCloseAccuracy", chanceOf(at1) === pct(sn.accuracy, RULES.traits.scopedCloseAccuracy), `${at1.chance}`);
  check("snipers no longer have a cliff at 3 tiles", at2.modifiers.every((x) => !x.label.includes("Moved")), JSON.stringify(at2.modifiers));
}
{
  // The shotgun: wide arc, damage falling away with distance.
  const m = board("shoot-shotgun", () => {}, 16, 12);
  const sg = UNITS.shotgun;
  const gun = unit(1, 0, "shotgun", 5, 5, { facing: E });
  const dmg = (x: number) => previewShot(m, gun, unit(2, 1, "rifleman", x, 5, { facing: W })).damage;
  check("next to the target: full damage", dmg(6) === sg.damage, `${dmg(6)}`);
  check("damage falls with every tile", dmg(6) > dmg(7) && dmg(7) > dmg(8) && dmg(8) > dmg(9), `${dmg(6)} ${dmg(7)} ${dmg(8)} ${dmg(9)}`);
  check("to spreadFarDamage at max range", dmg(5 + sg.range) === Math.round(sg.damage * RULES.traits.spreadFarDamage), `${dmg(5 + sg.range)}`);
  const square = previewShot(m, gun, unit(2, 1, "rifleman", 5, 3));
  check("a 180 degree arc reaches a target square to its side", sg.arc === 180 && square.possible, square.block);
  check("which a rifleman's 120 can't", previewShot(m, unit(1, 0, "rifleman", 5, 5, { facing: E }), unit(2, 1, "rifleman", 5, 3)).block === "outside_arc");
  check("but nothing behind it", previewShot(m, gun, unit(2, 1, "rifleman", 4, 3)).block === "outside_arc");
}
{
  // The officer: allies within commandRange shoot better.
  const m = board("shoot-officer", () => {}, 16, 12);
  const s = unit(1, 0, "rifleman", 2, 5);
  const t = unit(2, 1, "rifleman", 6, 5, { facing: W });
  const near = unit(3, 0, "officer", 2, 5 + RULES.traits.commandRange);
  const far = unit(3, 0, "officer", 2, 6 + RULES.traits.commandRange);
  const led = previewShot(m, s, t, [s, t, near]);
  const plain = previewShot(m, s, t, [s, t]);
  check("an officer within commandRange: the accuracy modifier", led.modifiers.some((x) => x.label === "Officer nearby"), JSON.stringify(led.modifiers));
  check("x commandAccuracy (capped at maxHitChance)", chanceOf(led) === pct(UNITS.rifleman.accuracy, RULES.traits.commandAccuracy), `${led.chance}`);
  check("and x commandDamage", led.damage === Math.round(UNITS.rifleman.damage * RULES.traits.commandDamage), `${led.damage}`);
  check("without an officer: plain numbers", chanceOf(plain) === UNITS.rifleman.accuracy && plain.damage === UNITS.rifleman.damage);
  check("one tile too far: nothing", !previewShot(m, s, t, [s, t, far]).modifiers.some((x) => x.label === "Officer nearby"));
  check("an enemy officer helps nobody", !previewShot(m, s, t, [s, t, { ...near, seat: 1 }]).modifiers.some((x) => x.label === "Officer nearby"));
  const self = unit(4, 0, "officer", 2, 5);
  check("an officer doesn't boost himself", !previewShot(m, self, t, [self, t]).modifiers.some((x) => x.label === "Officer nearby"));
}
{
  const m = board("shoot-unarmed");
  for (const kind of ["engineer", "riot"] as const) {
    const u = unit(1, 0, kind, 2, 5);
    const t = unit(2, 1, "rifleman", 4, 5, { facing: W });
    check(`a ${kind} can't shoot: blocked as unarmed`, previewShot(m, u, t).block === "unarmed");
    const st = stateOn("shoot-unarmed", [u, t]);
    check(`a ${kind} has no targets`, targetsFor(m, st, u).length === 0);
  }
  // In a real attack phase the unarmed are never ready to fire.
  const st = stateOn("shoot-unarmed", [unit(1, 0, "engineer", 2, 5), unit(2, 0, "riot", 2, 6), unit(3, 1, "rifleman", 4, 5, { facing: W })]);
  const r = resolve(st, [], []).state;
  check("the unarmed are never ready shooters", readyShooters(m, r, 0).length === 0);
  check("so the armed side gets the first shot", r.phase === "attack" && r.attackTurn === 1, `${r.phase} ${r.attackTurn}`);
}
{
  const p: ShotPreview = { possible: true, distance: 1, chance: 0.5, damage: 30, fatal: false, splash: 0, flank: "front", inCover: false, modifiers: [] };
  const [lo, hi] = damageRange(p);
  check("damage varies by damageVariance either way", lo === Math.round(30 * (1 - RULES.damageVariance)) && hi === Math.round(30 * (1 + RULES.damageVariance)), `${lo}-${hi}`);
  check("a roll at or above the chance misses", !rollShot(p, 0.5).hit && !rollShot(p, 0.9).hit);
  check("below it hits; the middle of the spread is the listed damage", rollShot(p, 0.3).hit && !rollShot(p, 0.3).crit && rollShot(p, 0.3).damage === 30);
  check("the spread roll sets where in the range it falls", rollShot(p, 0.3, 0).damage === lo && rollShot(p, 0.3, 1).damage === hi);
  check("the bottom tenth of the hit range crits for critMultiplier", rollShot(p, 0.04).crit && rollShot(p, 0.04).damage === Math.round(30 * RULES.critMultiplier));
  const fatal: ShotPreview = { ...p, damage: 77, fatal: true };
  check("a fatal shot does exactly its damage: no spread, no crit", rollShot(fatal, 0.01, 0).damage === 77 && !rollShot(fatal, 0.01).crit);
}

// ---------------------------------------------------------------------------
section("Moves resolve before deployments");

{
  board("move-then-deploy");
  const tiles = baseTiles(getMap("move-then-deploy"), 2);
  const t = tiles.find((p) => p.home === 1)!;
  const s = stateOn("move-then-deploy", [unit(1, 0, "rifleman", t.x - 1, t.y), unit(2, 1, "rifleman", 2, 2)]);
  const o0 = { moves: [{ unitId: 1, path: [{ x: t.x, y: t.y }], facing: E }], spawns: [] };
  const o1 = { moves: [], spawns: [{ kind: "rifleman" as UnitKind, x: t.x, y: t.y, facing: W }] };
  let r = applyAction(s, { type: "orders", seat: 0, orders: o0 }, roll(0.5));
  r = applyAction(r.state, { type: "orders", seat: 1, orders: o1 }, roll(0.5));
  check("a unit stepping onto a base tile gets there before a deployment onto it", pos(at(r.state, 1)) === `${t.x},${t.y}`, pos(at(r.state, 1)));
  const failed = r.events.find((e) => e.type === "spawnFailed");
  check("so the deployment fails, refunded", failed?.type === "spawnFailed" && r.state.seats[1]!.gold === RULES.startGold + RULES.baseIncome, `${r.state.seats[1]!.gold}`);
}
{
  board("onto-teammate");
  const s = stateOn("onto-teammate", [unit(1, 0, "rifleman", 2, 6), unit(2, 0, "rifleman", 3, 6)]);
  const ok = codeOf(() =>
    validateOrders(getMap("onto-teammate"), s, 0, {
      moves: [
        { unitId: 1, path: [{ x: 3, y: 6 }], facing: E },
        { unitId: 2, path: [{ x: 3, y: 5 }], facing: E },
      ],
      spawns: [],
    }),
  );
  check("you can plan to end where a teammate stands if it is moving away", ok === "no error", ok);
}

section("Units on the line of fire");

{
  const m = board("shoot-open");
  const shooter = unit(1, 0, "rifleman", 2, 5, { facing: E });
  const target = unit(2, 1, "rifleman", 6, 5, { facing: W });
  const enemyBetween = unit(3, 1, "rifleman", 4, 5);
  const friendBetween = unit(4, 0, "rifleman", 4, 5);
  const blocked = previewShot(m, shooter, target, [shooter, target, enemyBetween]);
  check("an enemy standing on the line blocks the shot", !blocked.possible && blocked.block === "enemy_in_way", blocked.block ?? "possible");
  const past = previewShot(m, shooter, target, [shooter, target, friendBetween]);
  check("your own unit on the line doesn't: you shoot past it", past.possible, past.block ?? "");
  const aside = previewShot(m, shooter, target, [shooter, target, unit(3, 1, "rifleman", 4, 6)]);
  check("an enemy beside the line doesn't block it", aside.possible, aside.block ?? "");
  const st = stateOn("shoot-open", [shooter, target, enemyBetween]);
  check("so the target behind it isn't a target at all", !targetsFor(m, st, at(st, 1)!).some((t) => t.id === 2));
}
{
  // A stealthy commando 4 tiles off (unseen beyond stealthRange) on the line:
  // the target is offered, but the shot strikes the commando instead.
  const m = board("shoot-unseen", () => {}, 14, 12);
  const shooter = unit(1, 0, "rifleman", 1, 5, { facing: E });
  const target = unit(2, 1, "rifleman", 7, 5, { facing: W });
  const sneak = unit(3, 1, "commando", 5, 5, { facing: W });
  const st = stateOn("shoot-unseen", [shooter, target, sneak]);
  st.phase = "attack";
  st.attackTurn = 0;
  check("an unseen enemy on the line doesn't stop the target being offered", targetsFor(m, st, at(st, 1)!).some((t) => t.id === 2));
  const r = applyAction(st, { type: "attack", seat: 0, unitId: 1, targetId: 2 }, roll(0));
  const shot = r.events.find((e) => e.type === "shot");
  check("but the shot strikes the unseen enemy in the way", shot?.type === "shot" && shot.targetId === 3 && shot.intendedId === 2 && shot.hit, JSON.stringify(shot));
  check("which takes the damage, not the target", at(r.state, 3)!.hp < UNITS.commando.hp && at(r.state, 2)!.hp === UNITS.rifleman.hp);
}
{
  // Game 3xaupj: the line to the target clips a tile the shooter has no line
  // of its own to (the rock is in the way), so whoever stands there is unseen
  // and its own shot preview is impossible. The shot used to roll 0% and miss,
  // round after round; now it keeps the chance it was fired with.
  const m = board("shoot-unseen-clipped", (b) => b.pen().tile(2, 6, "rock"), 14, 12);
  const shooter = unit(1, 0, "rifleman", 1, 9);
  shooter.facing = facingToward(shooter, { x: 4, y: 4 });
  const target = unit(2, 1, "rifleman", 4, 4);
  const lurker = unit(3, 1, "rifleman", 3, 5);
  const st = stateOn("shoot-unseen-clipped", [shooter, target, lurker]);
  st.phase = "attack";
  st.attackTurn = 0;
  check("the lurker is on the line but can't be seen", traceLine(m, shooter, target).tiles.some((p) => p.x === 3 && p.y === 5) && !traceLine(m, shooter, lurker).clear);
  const offered = previewShot(m, shooter, target, [shooter, target]);
  const r = applyAction(st, { type: "attack", seat: 0, unitId: 1, targetId: 2 }, roll(0));
  const shot = r.events.find((e) => e.type === "shot");
  check("a shot clipping an unseen unit's tile strikes it at the chance it was fired with", shot?.type === "shot" && shot.targetId === 3 && shot.chance === offered.chance && shot.hit, JSON.stringify(shot));
}

section("Simultaneous movement");

interface MoveSpec {
  unitId: number;
  path: Point[];
  facing?: number;
}

/** Both seats submit the given moves; returns what the resolution produced. */
function resolve(state: GameState, seat0: MoveSpec[], seat1: MoveSpec[] = []) {
  const orders = (moves: MoveSpec[]) => ({
    moves: moves.map((m) => ({ unitId: m.unitId, path: m.path, facing: (m.facing ?? E) })),
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
  // A scout: a four-step route, more than a rifleman's move.
  const s = stateOn("lockstep", [unit(1, 0, "scout", 2, 6), unit(2, 1, "rifleman", 5, 6, { facing: W })]);
  const { state: r, events } = resolve(s, [{ unitId: 1, path: row(6, 3, 4, 5, 6), facing: N }]);
  const mover = at(r, 1)!;
  check("walking into an unseen enemy stops you in front of it", pos(mover) === "4,6", pos(mover));
  check("facing it, not the facing you ordered", mover.facing === E, `${mover.facing}`);
  check("the move event says it bumped", events.some((e) => e.type === "move" && e.unitId === 1 && e.bumped));
  check("movement is followed by the attack phase", r.phase === "attack" && r.attackTurn === 0, `${r.phase} ${r.attackTurn}`);
}
{
  const s = stateOn("lockstep", [unit(1, 0, "rifleman", 2, 6), unit(2, 0, "rifleman", 4, 6)]);
  const code = codeOf(() =>
    applyAction(s, { type: "orders", seat: 0, orders: { moves: [{ unitId: 1, path: row(6, 3, 4), facing: E }], spawns: [] } }, roll(0.5)),
  );
  check("you can't plan to end on a teammate who is staying put", code === "duplicate_destination", code);
  const theirs = codeOf(() =>
    applyAction(s, { type: "orders", seat: 1, orders: { moves: [{ unitId: 1, path: [], facing: E }], spawns: [] } }, roll(0.5)),
  );
  check("or give orders to someone else's unit", theirs === "not_your_unit", theirs);
}
{
  const s = stateOn("lockstep", [unit(1, 0, "rifleman", 2, 6, { fired: true }), unit(2, 1, "rifleman", 9, 6)]);
  const code = codeOf(() => applyAction(s, { type: "orders", seat: 0, orders: { moves: [{ unitId: 1, path: row(6, 3), facing: E }], spawns: [] } }, roll(0.5)));
  check("a unit that fired last round can't move", code === "fired_cannot_move", code);
  const r = resolve(s, [{ unitId: 1, path: [], facing: S }]).state;
  check("but it can turn on the spot", at(r, 1)!.facing === S && pos(at(r, 1)) === "2,6", `${at(r, 1)!.facing}`);
  check("and the next round it may move again", !at(r, 1)!.fired);
}
{
  const s = stateOn("lockstep", [unit(1, 0, "rifleman", 2, 6), unit(2, 0, "rifleman", 3, 6)]);
  const r = resolve(s, [{ unitId: 1, path: row(6, 3, 4, 5) }]).state;
  check("your units walk through a teammate standing still", pos(at(r, 1)) === "5,6" && pos(at(r, 2)) === "3,6", `${pos(at(r, 1))} ${pos(at(r, 2))}`);
}
{
  const s = stateOn("lockstep", [unit(1, 0, "rifleman", 2, 6), unit(2, 0, "rifleman", 3, 6)]);
  const r = resolve(s, [
    { unitId: 1, path: row(6, 3) },
    { unitId: 2, path: row(6, 2) },
  ]).state;
  check("teammates can swap places", pos(at(r, 1)) === "3,6" && pos(at(r, 2)) === "2,6", `${pos(at(r, 1))} ${pos(at(r, 2))}`);
}
{
  // Unit 1 walks through teammate 2 and is stopped by an enemy right there:
  // it may not finish on 2's tile, so it steps back to where it came from.
  const s = stateOn("lockstep", [unit(1, 0, "rifleman", 2, 6), unit(2, 0, "rifleman", 3, 6), unit(3, 1, "rifleman", 4, 6, { facing: W })]);
  const { state: r, events } = resolve(s, [{ unitId: 1, path: row(6, 3, 4, 5) }]);
  check("stopped on a teammate's tile, a unit steps back off it", pos(at(r, 1)) === "2,6" && pos(at(r, 2)) === "3,6", `${pos(at(r, 1))} ${pos(at(r, 2))}`);
  check("and counts as bumped, not moved", events.some((e) => e.type === "move" && e.unitId === 1 && e.bumped) && !at(r, 1)!.moved);
  const tiles = r.units.map(pos);
  check("no two units ever finish on one tile", new Set(tiles).size === tiles.length, tiles.join(" "));
}
{
  // Two teammates through each other's paths while an enemy blocks both: still one per tile.
  const s = stateOn("lockstep", [unit(1, 0, "rifleman", 2, 6), unit(2, 0, "rifleman", 3, 6), unit(3, 1, "rifleman", 5, 6)]);
  const r = resolve(s, [
    { unitId: 1, path: row(6, 3, 4) },
    { unitId: 2, path: row(6, 4, 5, 6) },
  ]).state;
  const tiles = r.units.map(pos);
  check("a queue stopped by an enemy untangles to one unit per tile", new Set(tiles).size === tiles.length, tiles.join(" "));
}
{
  const s = stateOn("lockstep", [unit(1, 0, "rifleman", 2, 6), unit(2, 1, "rifleman", 3, 6)]);
  const r = resolve(s, [{ unitId: 1, path: row(6, 3, 4) }]).state;
  check("but nobody walks through an enemy", pos(at(r, 1)) === "2,6", pos(at(r, 1)));
}
{
  // Aiming for an enemy's tile: you get it if they step off it this round.
  const s = stateOn("lockstep", [unit(1, 0, "rifleman", 2, 6), unit(2, 1, "rifleman", 3, 6)]);
  const r = resolve(s, [{ unitId: 1, path: row(6, 3) }], [{ unitId: 2, path: [{ x: 3, y: 5 }] }]).state;
  check("a move onto an enemy's tile succeeds if the enemy leaves it", pos(at(r, 1)) === "3,6" && pos(at(r, 2)) === "3,5", `${pos(at(r, 1))} ${pos(at(r, 2))}`);
  const stay = resolve(s, [{ unitId: 1, path: row(6, 3) }]).state;
  check("and stops in front of it, facing it, if it stays", pos(at(stay, 1)) === "2,6" && at(stay, 1)!.facing === E, `${pos(at(stay, 1))} ${at(stay, 1)!.facing}`);
}

// ---------------------------------------------------------------------------
section("Deploying");

{
  const s = newGame("crossroads", 2);
  const spawn = (x: number, y: number, kind: UnitKind = "rifleman") =>
    codeOf(() => applyAction(s, { type: "orders", seat: 0, orders: { moves: [], spawns: [{ kind, x, y, facing: E }] } }, roll(0.5)));
  const base = getMap("crossroads").bases[0]![0]!;
  check("deploying on your base is allowed", spawn(base.x, base.y) === "no error", spawn(base.x, base.y));
  check("anywhere else is not", spawn(6, 6) === "bad_spawn_tile");
  check("the enemy base is not yours", spawn(24, 8) === "bad_spawn_tile");
  const tooMuch = codeOf(() =>
    applyAction(s, { type: "orders", seat: 0, orders: { moves: [], spawns: getMap("crossroads").bases[0]!.slice(0, 3).map((p) => ({ kind: "heavy" as const, ...p, facing: E })) } }, roll(0.5)),
  );
  check("you can't spend more than you have", tooMuch === "not_enough_gold", tooMuch);

  let g = applyAction(s, { type: "orders", seat: 0, orders: { moves: [], spawns: [{ kind: "rifleman", x: base.x, y: base.y, facing: E }] } }, roll(0.5)).state;
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
    unit(1, 0, "rifleman", 3, 5, { facing: E }),
    unit(2, 0, "rifleman", 3, 6, { facing: E }),
    unit(3, 1, "rifleman", 7, 5, { facing: W }),
    unit(4, 1, "scout", 7, 6, { facing: W, hp: 10 }),
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
  check("the shooter is marked as having fired", at(r.state, 1)!.fired);
  const twice = codeOf(() => applyAction(r.state, { type: "attack", seat: 0, unitId: 1, targetId: 3 }, roll(0)));
  check("you can't act out of turn", twice === "not_your_turn", twice);
  r = applyAction(r.state, { type: "attack", seat: 1, unitId: 3, targetId: 1 }, roll(0.99));
  check("a miss does nothing", at(r.state, 1)!.hp === 100);
  check("back to seat 0 for its second unit", r.state.attackTurn === 0);
  const again = codeOf(() => applyAction(r.state, { type: "attack", seat: 0, unitId: 1, targetId: 3 }, roll(0)));
  check("each unit acts once", again === "already_acted", again);
  r = applyAction(r.state, { type: "hold", seat: 0, unitId: 2 }, roll(0));
  check("holding fire isn't firing", !at(r.state, 2)!.fired);
  check("when nobody has anything left, the round ends", r.state.phase === "planning" && r.state.round === 2, `${r.state.phase} ${r.state.round}`);
  check("the unit that was shot at but missed heals", at(r.state, 1)!.hp === 100);
}
{
  const s = stateOn("duel", [unit(1, 0, "rifleman", 3, 5, { facing: E }), unit(3, 1, "rifleman", 7, 5, { facing: W })]);
  s.round = 2;
  const r = resolve(s, [], []);
  check("round 2: the lead passes to seat 1", r.state.attackTurn === 1);
}
{
  const s = stateOn("duel", [unit(1, 0, "rifleman", 3, 5, { facing: E }), unit(3, 1, "rifleman", 7, 5, { facing: W, hp: 5 })]);
  s.baseOwners = s.baseOwners.map((o) => (o === 1 ? 0 : o));
  let r = resolve(s, [], []);
  r = applyAction(r.state, { type: "attack", seat: 0, unitId: 1, targetId: 3 }, roll(0));
  check("losing your last unit with no base tiles left knocks you out at once", r.state.seats[1]!.eliminated);
  check("and the last seat standing wins", r.state.phase === "over" && r.state.winner === 0, `${r.state.phase} ${r.state.winner}`);
}
{
  const s = stateOn("duel", [unit(1, 0, "rifleman", 3, 5, { facing: E }), unit(3, 1, "rifleman", 7, 5, { facing: W })]);
  const r = applyAction(s, { type: "resign", seat: 1 }, roll(0));
  check("resigning ends a two-player game", r.state.phase === "over" && r.state.winner === 0);
}

// ---------------------------------------------------------------------------
section("Two shots a turn (the commando)");

{
  board("burst");
  // A commando behind enemy A (2 tiles: a backstab, not fatal), with B beside it.
  const start = () =>
    resolve(
      stateOn("burst", [
        unit(1, 0, "commando", 3, 5, { facing: E }),
        unit(2, 0, "rifleman", 3, 7, { facing: E }),
        unit(3, 1, "rifleman", 5, 5, { facing: E }),
        unit(4, 1, "rifleman", 5, 6, { facing: W }),
      ]),
      [],
      [],
    ).state;
  const s0 = start();
  check("seat 0 leads", s0.phase === "attack" && s0.attackTurn === 0);
  const r1 = applyAction(s0, { type: "attack", seat: 0, unitId: 1, targetId: 3 }, roll(0.99)).state;
  check("after its first shot the commando's side keeps the turn", r1.attackTurn === 0, `${r1.attackTurn}`);
  check("with the burst recorded", r1.burst?.unitId === 1 && r1.burst.fired === 1, JSON.stringify(r1.burst));
  check("it hasn't finished acting", !r1.actedUnitIds.includes(1));
  check("it is the only ready shooter", readyShooters(getMap("burst"), r1, 0).map((u) => u.id).join() === "1");
  check("the view tells its own side", viewFor(r1, 0).burst?.unitId === 1 && viewFor(r1, 1).burst === null);
  const other = codeOf(() => applyAction(r1, { type: "attack", seat: 0, unitId: 2, targetId: 3 }, roll(0.5)));
  check("another unit can't fire in the middle of it", other === "finish_burst", other);
  const otherHold = codeOf(() => applyAction(r1, { type: "hold", seat: 0, unitId: 2 }, roll(0.5)));
  check("or hold", otherHold === "finish_burst", otherHold);
  const r2 = applyAction(r1, { type: "attack", seat: 0, unitId: 1, targetId: 4 }, roll(0.99));
  check("the second shot can switch targets", r2.events.some((e) => e.type === "shot" && e.targetId === 4));
  check("after it the commando has acted", r2.state.actedUnitIds.includes(1) && r2.state.burst === null);
  check("and the turn passes", r2.state.attackTurn === 1, `${r2.state.attackTurn}`);
  const third = codeOf(() => applyAction({ ...r2.state, attackTurn: 0 }, { type: "attack", seat: 0, unitId: 1, targetId: 3 }, roll(0.5)));
  check("no third shot", third === "already_acted", third);
  const held = applyAction(r1, { type: "hold", seat: 0, unitId: 1 }, roll(0.5)).state;
  check("holding ends the burst and passes the turn", held.burst === null && held.actedUnitIds.includes(1) && held.attackTurn === 1);
  const ended = applyAction(r1, { type: "endAttacks", seat: 0 }, roll(0.5)).state;
  check("so does ending attacks", ended.burst === null && ended.attackTurn === 1);
  check("a rifleman fires once", UNITS.rifleman.shots === 1 && UNITS.commando.shots === 2);

  // Killing the only target with the first shot ends the burst: nothing left to shoot.
  const lone = resolve(stateOn("burst", [unit(1, 0, "commando", 3, 5, { facing: E }), unit(3, 1, "rifleman", 5, 5, { facing: E, hp: 5 })]), [], []).state;
  const k = applyAction(lone, { type: "attack", seat: 0, unitId: 1, targetId: 3 }, roll(0.2)).state;
  check("a first shot that leaves no target ends the burst", k.burst === null && !at(k, 3), JSON.stringify(k.burst));
}
{
  // Fatal from behind, from the next tile.
  const m = board("backstab");
  const c = unit(1, 0, "commando", 4, 5, { facing: E });
  const t = unit(2, 1, "heavy", 5, 5, { facing: E });
  const p = previewShot(m, c, t);
  check("a commando right behind its target: fatal", p.fatal && p.damage === t.hp, `${p.fatal} ${p.damage}`);
  check("diagonally behind counts too", previewShot(m, unit(1, 0, "commando", 4, 4, { facing: 135 }), { ...t, facing: 120 }).fatal);
  check("from the side it isn't", !previewShot(m, c, { ...t, facing: N }).fatal);
  check("nor from two tiles", !previewShot(m, { ...c, x: 3 }, t).fatal);
  check("only the commando has it", !previewShot(m, unit(1, 0, "rifleman", 4, 5, { facing: E }), t).fatal);
  const s = resolve(stateOn("backstab", [c, t]), [], []).state;
  const r = applyAction(s, { type: "attack", seat: 0, unitId: 1, targetId: 2 }, roll(0.5));
  check("and a hit kills, whatever its health", !at(r.state, 2) && r.events.some((e) => e.type === "shot" && e.killed));
}

// ---------------------------------------------------------------------------
section("Explosives (the heavy)");

{
  // Heavy at (2,5) firing east at T (6,5). X is beside T, O is one of the
  // heavy's own beside T, W is beside T but behind a wall, Y two tiles off.
  const m = board("blast", (b) => b.pen().edge(6, 5, "n", "wall"), 16, 12);
  const setup = (hp: Partial<Record<number, number>> = {}) =>
    stateOn("blast", [
      unit(1, 0, "heavy", 2, 5, { facing: E }),
      unit(2, 1, "rifleman", 6, 5, { facing: W, hp: hp[2] ?? 100 }),
      unit(3, 1, "rifleman", 7, 5, { facing: W, hp: hp[3] ?? 100 }),
      unit(4, 0, "rifleman", 6, 6, { facing: N }),
      unit(5, 1, "rifleman", 6, 4, { facing: S }),
      unit(6, 1, "rifleman", 8, 5, { facing: W }),
    ]);
  const splash = Math.round(UNITS.heavy.damage * RULES.traits.splashDamage);
  const p = previewShot(m, unit(1, 0, "heavy", 2, 5, { facing: E }), unit(2, 1, "rifleman", 6, 5, { facing: W }));
  check("a heavy's shot carries a blast: damage x splashDamage", p.splash === splash, `${p.splash}`);
  check("other classes' don't", previewShot(m, unit(1, 0, "rifleman", 2, 5), unit(2, 1, "rifleman", 6, 5)).splash === 0);

  const fire = (s: GameState, r: number) => {
    const g = resolve(s, [], []).state;
    return applyAction(g, { type: "attack", seat: 0, unitId: 1, targetId: 2 }, roll(r));
  };
  const hit = fire(setup(), 0.2);
  const shot = hit.events.find((e): e is Extract<GameEvent, { type: "shot" }> => e.type === "shot")!;
  check("a direct hit does full damage to the target", shot.hit && at(hit.state, 2)!.hp === 100 - shot.damage, `${at(hit.state, 2)!.hp}`);
  check("and the blast to an enemy beside it", at(hit.state, 3)!.hp === 100 - splash, `${at(hit.state, 3)!.hp}`);
  check("and to the shooter's own side", at(hit.state, 4)!.hp === 100 - splash, `${at(hit.state, 4)!.hp}`);
  check("but not through a wall", at(hit.state, 5)!.hp === 100);
  check("nor two tiles away", at(hit.state, 6)!.hp === 100);
  check("the target isn't blasted on top of the hit", !shot.splash.some((x) => x.unitId === 2) && shot.splash.length === 2, JSON.stringify(shot.splash));

  const miss = fire(setup(), 0.9);
  const missShot = miss.events.find((e): e is Extract<GameEvent, { type: "shot" }> => e.type === "shot")!;
  check("a miss still lands: the target takes the blast", !missShot.hit && at(miss.state, 2)!.hp === 100 - splash, `${at(miss.state, 2)!.hp}`);
  check("and so does everyone beside it", at(miss.state, 3)!.hp === 100 - splash && at(miss.state, 4)!.hp === 100 - splash);
  check("the units caught are marked hit this round (no healing)", at(miss.state, 2)!.damaged && at(miss.state, 4)!.damaged);

  const missKill = fire(setup({ 2: 5 }), 0.9).state;
  check("a blast can kill the target on a miss", !at(missKill, 2));

  // Splash kills knock a side out like any other.
  const last = setup({ 2: 5, 3: 5 });
  last.units = last.units.filter((u) => u.id !== 5 && u.id !== 6);
  last.baseOwners = last.baseOwners.map((o) => (o === 1 ? 0 : o));
  const end = fire(last, 0.2);
  const endShot = end.events.find((e): e is Extract<GameEvent, { type: "shot" }> => e.type === "shot")!;
  check("a unit killed by the blast is removed", !at(end.state, 3) && endShot.splash.some((x) => x.unitId === 3 && x.killed));
  check("and losing the last units that way knocks the side out", end.state.seats[1]!.eliminated && end.state.phase === "over" && end.state.winner === 0, `${end.state.phase} ${end.state.winner}`);
}

// ---------------------------------------------------------------------------
section("Upkeep: captures, income, healing");

{
  board("sites", (b) => {
    b.pen().post(5, 5);
    b.pen().income(8, 8, 25);
  });
  let s = stateOn("sites", [unit(1, 0, "rifleman", 5, 5), unit(2, 0, "rifleman", 8, 8)]);
  const firstRound = resolve(s, [], []);
  s = firstRound.state;
  check("a post takes baseCaptureRounds a step, like a base tile", RULES.baseCaptureRounds === 2 && s.postOwners[0] === null && s.postCapture?.[0]?.rounds === 1);
  check("and the log hears of it", firstRound.events.some((e) => e.type === "captureProgress" && e.site === "post" && e.needed === RULES.baseCaptureRounds));
  const left = resolve({ ...s, units: s.units.filter((u) => u.id !== 1) }, [], []).state;
  check("leaving the post loses the progress", left.postCapture?.[0] === null && left.postOwners[0] === null);
  {
    // A game created before rules revision 2: one round a step, as it was played.
    const { rulesRevision: _, ...oldRules } = FILE_TUNING.rules;
    const old = upgradeSnapshot({ version: 2, rules: { ...oldRules, rulesRevision: 1 }, units: FILE_TUNING.units as unknown as Record<string, unknown> });
    const quick = withTuning(old, () => resolve(stateOn("sites", [unit(1, 0, "rifleman", 5, 5)]), [], []).state);
    check("games from before revision 2 still take a post in one round", quick.postOwners[0] === 0);
  }
  s = resolve(s, [], []).state;
  check("standing on a neutral post takes it after that", s.postOwners[0] === 0);
  check("only engineers take income sites", s.incomeOwners[0] === null);
  check("holding more posts costs the other side nothing by itself (no tickets)", !s.seats[1]!.eliminated && !("tickets" in s.seats[1]!));

  s.units = [unit(5, 1, "engineer", 5, 5), unit(6, 1, "engineer", 8, 8)];
  s = resolve(s, [], []).state;
  check("an enemy on your post makes it neutral first", s.postOwners[0] === null);
  check("an engineer takes the income site", s.incomeOwners[0] === 1);
  check("which pays out the same round", s.seats[1]!.gold === RULES.startGold + 3 * RULES.baseIncome + 25, `${s.seats[1]!.gold}`);
  s = resolve(s, [], []).state;
  check("a second round flips the post to them", s.postOwners[0] === 1);
  const mine = spawnTiles(getMap("sites"), s, 1);
  check("a held post is a spawn tile", mine.some((p) => p.x === 5 && p.y === 5));
  check("the tiles beside it are not", !mine.some((p) => Math.max(Math.abs(p.x - 5), Math.abs(p.y - 5)) === 1));

  // A healer at (6,4); allies at medicRange (diagonally too) and one beyond.
  const R = RULES.medicRange;
  s.units = [
    unit(7, 0, "rifleman", 0, 0, { hp: 50 }),
    unit(8, 0, "rifleman", 6 - R, 4 - R, { hp: 50 }),
    unit(9, 0, "healer", 6, 4),
    unit(10, 0, "rifleman", 6 + R + 1, 4, { hp: 50 }),
    unit(11, 0, "rifleman", 6, 4 + R, { hp: 50, damaged: true }),
    unit(12, 0, "rifleman", 1, 9, { hp: 50 }),
    unit(13, 0, "engineer", 2, 9),
  ];
  s = resolve(s, [], []).state;
  const heal = RULES.healPerRound;
  check("an unhurt unit heals healPerRound a round", at(s, 7)!.hp === 50 + heal, `${at(s, 7)!.hp}`);
  check("and medicHeal more within medicRange of a healer, diagonals counting", at(s, 8)!.hp === 50 + heal + RULES.medicHeal, `${at(s, 8)!.hp}`);
  check("but not one tile further", at(s, 10)!.hp === 50 + heal, `${at(s, 10)!.hp}`);
  check("a unit hit this round still gets the healer's share", at(s, 11)!.hp === 50 + RULES.medicHeal, `${at(s, 11)!.hp}`);
  check("the healer's tuning: +10 to the tiles next to it", RULES.medicHeal === 10 && RULES.medicRange === 1);
  check("engineers no longer heal", at(s, 12)!.hp === 50 + heal, `${at(s, 12)!.hp}`);
}
{
  board("timeout");
  const s = stateOn("timeout", [unit(1, 0, "rifleman", 0, 0)]);
  check("there is no round limit in the files", RULES.roundLimit === 0, String(RULES.roundLimit));
  s.round = 500;
  const r = resolve(s, [], []).state;
  check("so round 500 just goes on", r.phase === "planning" && r.round === 501, `${r.phase} ${r.round}`);
  // An older game keeps the limit it was made with (its snapshot says 30).
  const old = { ...FILE_TUNING, rules: { ...FILE_TUNING.rules, roundLimit: 30 } };
  const t = stateOn("timeout", [unit(1, 0, "rifleman", 0, 0)]);
  t.round = 30;
  const ended = withTuning(old, () => resolve(t, [], []).state);
  check("an older game with a limit still ends at it", ended.phase === "over" && ended.winner === null, `${ended.phase} ${ended.winner}`);
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
  const R = RULES.baseCaptureRounds;
  let r = resolve(s, [], []);
  s = r.state;
  check(`one round on an enemy base tile isn't enough (it takes ${R})`, s.baseOwners[a] === 1 && s.baseCapture[a]?.seat === 0 && s.baseCapture[a]?.rounds === 1, JSON.stringify(s.baseCapture[a]));
  const prog = r.events.find((e) => e.type === "captureProgress");
  check("with a progress event", prog?.type === "captureProgress" && prog.index === a && prog.rounds === 1 && prog.needed === R);
  for (let i = 1; i < R; i++) r = resolve(r.state, [], []);
  s = r.state;
  check(`after ${R} rounds it turns neutral`, s.baseOwners[a] === null, String(s.baseOwners[a]));
  const ev = r.events.find((e) => e.type === "capture" && e.site === "base");
  check("with a capture event naming the base tile", ev?.type === "capture" && ev.index === a && ev.from === 1 && ev.to === null);
  for (let i = 0; i < R; i++) s = resolve(s, [], []).state;
  check(`and ${R} more make it theirs: ${2 * R} rounds in all`, s.baseOwners[a] === 0);

  // Captured base tiles are spawn tiles for the captor, and lost ones are not for the loser.
  s.units = s.units.filter((u) => u.id !== 1);
  const spawnAt = (seat: number, x: number, y: number) =>
    codeOf(() => applyAction(s, { type: "orders", seat, orders: { moves: [], spawns: [{ kind: "scout", x, y, facing: W }] } }, roll(0.5)));
  check("the captor can deploy on a captured base tile", spawnAt(0, 11, 11) === "no error", spawnAt(0, 11, 11));
  check("the side that lost it can't", spawnAt(1, 11, 11) === "bad_spawn_tile", spawnAt(1, 11, 11));
  check("but can still deploy on the base tiles it kept", spawnAt(1, 10, 11) === "no error", spawnAt(1, 10, 11));

  // Taking it back works the same way.
  s.units = [unit(5, 1, "rifleman", 11, 11), unit(6, 0, "rifleman", 5, 5)];
  for (let i = 0; i < 2 * R; i++) s = resolve(s, [], []).state;
  check("the owner can retake it: neutral, then theirs again", s.baseOwners[a] === 1, String(s.baseOwners[a]));

  // An engineer takes a step every engineerBaseCaptureRounds rounds.
  s.units = [unit(7, 0, "engineer", 11, 11), unit(8, 1, "rifleman", 5, 5)];
  for (let i = 0; i < RULES.engineerBaseCaptureRounds; i++) s = resolve(s, [], []).state;
  check(`an engineer turns it neutral in ${RULES.engineerBaseCaptureRounds}`, s.baseOwners[a] === null, String(s.baseOwners[a]));

  // Walking off loses the progress.
  s.baseOwners[a] = 1;
  s.units = [unit(9, 0, "rifleman", 11, 11), unit(10, 1, "rifleman", 0, 6)];
  s = resolve(s, [], []).state;
  s = resolve(s, [{ unitId: 9, path: [{ x: 11, y: 10 }] }]).state;
  check("leaving the tile loses the progress", s.baseCapture[a] === null && s.baseOwners[a] === 1, JSON.stringify(s.baseCapture[a]));
}
{
  board("bases-blocked");
  const tiles = baseTiles(getMap("bases-blocked"), 2);
  const a = tiles.findIndex((t) => t.x === 11 && t.y === 11);
  // A defender standing on its own base tile: nothing happens to it.
  let s = stateOn("bases-blocked", [unit(1, 1, "rifleman", 11, 11), unit(2, 0, "rifleman", 2, 6, { facing: W })]);
  s = resolve(s, [], []).state;
  check("a defender standing on its own base tile keeps it", s.baseOwners[a] === 1);
  // An enemy on a tile already neutral (or theirs) after the other seat's unit leaves...
  s.baseOwners[a] = null;
  s.units = [unit(1, 1, "rifleman", 11, 11)];
  for (let i = 0; i < RULES.baseCaptureRounds; i++) s = resolve(s, [], []).state;
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
  check("another side's unit count and gold are not in the view", v.seats[1]!.units === null && v.seats[1]!.gold === null);
  check("your own are", v.seats[0]!.units === 1 && v.seats[0]!.gold === RULES.startGold);
  const over = viewFor({ ...s, phase: "over" }, 0);
  check("when the game is over the fog lifts", over.units.length === 4);
  check("and everyone's counts and gold show, as in a replay", over.seats[1]!.units === 3 && viewFor(s, null).seats[1]!.gold === RULES.startGold);
}

{
  // The sniper's scope: a long, narrow strip of sight straight ahead.
  const m = board("scope", () => {}, 30, 30);
  const idx = (x: number, y: number) => y * m.width + x;
  const seesFrom = (u: Unit) => visibleTiles(m, stateOn("scope", [u]), 0);
  const sniper = seesFrom(unit(1, 0, "sniper", 2, 15, { facing: E }));
  check("a sniper sees 18 tiles straight ahead", sniper.has(idx(20, 15)));
  check("but not as far off to the side", !sniper.has(idx(15, 2)));
  check("nor behind", !seesFrom(unit(1, 0, "sniper", 20, 15, { facing: E })).has(idx(2, 15)));
  check("past its plain sight radius only along the strip", !sniper.has(idx(2, 15 - 12)));
  check("turned north, the strip turns with it", !seesFrom(unit(1, 0, "sniper", 2, 15, { facing: N })).has(idx(20, 15)) && seesFrom(unit(1, 0, "sniper", 15, 25, { facing: N })).has(idx(15, 7)));
  check("a rifleman in the same spot sees nothing that far", !seesFrom(unit(1, 0, "rifleman", 2, 15, { facing: E })).has(idx(20, 15)));
  const walled = board("scope-wall", (b) => b.pen().edge(10, 15, "w", "wall"), 30, 30);
  check("walls still block it", !visibleTiles(walled, stateOn("scope-wall", [unit(1, 0, "sniper", 2, 15, { facing: E })]), 0).has(idx(20, 15)));
}

// ---------------------------------------------------------------------------
section("Facings are any whole degree");

{
  const m = getMap("lockstep");
  const s = stateOn("lockstep", [unit(1, 0, "rifleman", 2, 6)]);
  const turn = (facing: number) => codeOf(() => validateOrders(m, s, 0, { moves: [{ unitId: 1, path: [], facing }], spawns: [] }));
  check("0 and 359 are facings", isFacing(0) && isFacing(359) && turn(0) === "no error" && turn(359) === "no error");
  check("so is 37: not just eighths", turn(37) === "no error");
  check("360 is not", !isFacing(360) && turn(360) === "bad_path", turn(360));
  check("nor fractions", turn(7.5) === "bad_path", turn(7.5));
  check("nor negatives", turn(-1) === "bad_path", turn(-1));
  const g = newGame("crossroads", 2);
  const base = getMap("crossroads").bases[0]![0]!;
  const spawn = codeOf(() => validateOrders(getMap("crossroads"), g, 0, { moves: [], spawns: [{ kind: "rifleman", ...base, facing: 400 }] }));
  check("a deployment's facing is checked too", spawn === "bad_spawn_tile", spawn);
  const r = resolve(s, [{ unitId: 1, path: [], facing: 213 }]).state;
  check("a unit ends facing exactly what it was ordered", at(r, 1)!.facing === 213, `${at(r, 1)!.facing}`);
}

// ---------------------------------------------------------------------------
section("Routes over several rounds (standing destinations)");

{
  const m = getMap("lockstep");
  const s = stateOn("lockstep", [unit(1, 0, "rifleman", 2, 6), unit(2, 0, "scout", 2, 8), unit(3, 1, "rifleman", 9, 6)]);
  const far = { x: 11, y: 0 };
  const orders0 = { moves: [{ unitId: 1, path: row(6, 3, 4), facing: E }], spawns: [], routes: [{ unitId: 1, to: far }] };
  const valid = (routes: { unitId: number; to: Point }[]) => codeOf(() => validateOrders(m, s, 0, { moves: [], spawns: [], routes }));
  check("a route to a far tile is accepted", valid([{ unitId: 1, to: far }]) === "no error");
  check("someone else's unit can't be given one", valid([{ unitId: 3, to: far }]) === "not_your_unit", valid([{ unitId: 3, to: far }]));
  check("nor a unit that isn't there", valid([{ unitId: 99, to: far }]) === "no_such_unit");
  check("the tile must be on the map", valid([{ unitId: 1, to: { x: m.width, y: 0 } }]) === "bad_path");
  check("one route per unit", valid([{ unitId: 1, to: far }, { unitId: 1, to: { x: 0, y: 0 } }]) === "duplicate_order");
  check("an unreachable or fogged tile is fine (it's only where the unit is headed)", valid([{ unitId: 2, to: { x: 9, y: 6 } }]) === "no error");
  check("a route may say which way to face on arriving", valid([{ unitId: 1, to: far, facing: 135 } as { unitId: number; to: Point }]) === "no error");
  check("but only a real facing", valid([{ unitId: 1, to: far, facing: 400 } as { unitId: number; to: Point }]) === "bad_path");
  const aimed = applyAction(s, { type: "orders", seat: 0, orders: { ...orders0, routes: [{ unitId: 1, to: far, facing: S }] } }, roll(0.5)).state;
  check("and keeps it for the rounds to come", viewFor(aimed, 0).myRoutes[0]?.facing === S);

  const after0 = applyAction(s, { type: "orders", seat: 0, orders: orders0 }, roll(0.5)).state;
  check("accepted routes are kept for the seat", after0.routes[0]!.length === 1 && after0.routes[0]![0]!.to.x === far.x);
  check("its own view has them", viewFor(after0, 0).myRoutes.length === 1);
  check("the other seat's view doesn't", viewFor(after0, 1).myRoutes.length === 0 && !JSON.stringify(viewFor(after0, 1)).includes('"routes"'));
  check("nor a spectator's", viewFor(after0, null).myRoutes.length === 0);
  const r = applyAction(after0, { type: "orders", seat: 1, orders: { moves: [], spawns: [] } }, roll(0.5)).state;
  check("the server moves only this round's leg", pos(at(r, 1)) === "4,6", pos(at(r, 1)));
  check("routes outlive the round's orders", r.routes[0]!.length === 1);
  check("old-style orders (no routes) leave a seat with none", r.routes[1]!.length === 0);
  const resubmitted = applyAction(after0, { type: "orders", seat: 0, orders: { moves: [], spawns: [] } }, roll(0.5)).state;
  check("new orders replace the seat's routes", resubmitted.routes[0]!.length === 0);
  const dead = { ...after0, units: after0.units.filter((u) => u.id !== 1) };
  check("a dead unit's route isn't sent", viewFor(dead, 0).myRoutes.length === 0);
  check("routes change nothing about how moves resolve",
    JSON.stringify(applyAction(after0, { type: "orders", seat: 1, orders: { moves: [], spawns: [] } }, roll(0.5)).state.units) ===
    JSON.stringify(resolve(s, [{ unitId: 1, path: row(6, 3, 4) }]).state.units));
  // An enemy stops the unit on its leg: the route is over, not steered round it.
  const blocked = stateOn("lockstep", [unit(1, 0, "rifleman", 2, 6), unit(3, 1, "rifleman", 4, 6, { facing: W })]);
  const met = applyAction(
    applyAction(blocked, { type: "orders", seat: 0, orders: { moves: [{ unitId: 1, path: row(6, 3, 4), facing: E }], spawns: [], routes: [{ unitId: 1, to: far }] } }, roll(0.5)).state,
    { type: "orders", seat: 1, orders: { moves: [], spawns: [] } },
    roll(0.5),
  ).state;
  check("a unit an enemy stops loses its route", pos(at(met, 1)) === "3,6" && met.routes[0]!.length === 0, `${pos(at(met, 1))} ${JSON.stringify(met.routes[0])}`);
  check("one that isn't stopped keeps it", r.routes[0]!.length === 1);
  const unlimited = reachable(m, unit(1, 0, "rifleman", 0, 0), new Set(), Infinity);
  check("reachable with no budget limit plans a route across the map", unlimited.cost.has((m.height - 1) * m.width + m.width - 1));
}

// ---------------------------------------------------------------------------
section("Replay");

{
  const script = (): GameState => {
    let g = newGame("crossroads", 2);
    const map = getMap("crossroads");
    const actions: Action[] = [
      { type: "orders", seat: 0, orders: { moves: [], spawns: map.bases[0]!.slice(0, 2).map((p) => ({ kind: "rifleman" as const, ...p, facing: E })) } },
      { type: "orders", seat: 1, orders: { moves: [], spawns: map.bases[1]!.slice(0, 2).map((p) => ({ kind: "scout" as const, ...p, facing: W })) } },
    ];
    actions.forEach((a, i) => (g = applyAction(g, a, streamFor("seed-1", i)).state));
    return g;
  };
  check("the same seed and actions rebuild the same state", JSON.stringify(script()) === JSON.stringify(script()));

  // Watching it again: two bots play a while; the replay, rebuilt from the
  // log alone, must end exactly where the game did.
  const log: ReplayLog = { seed: "replay-seed", seatCount: 2, actions: [] };
  let g = newGame("crossroads", 2);
  const botRandom = streamFor("replay-bots", 0);
  let waited = 0;
  // The replay's last step is the last action that changed something: a set
  // of orders that only waited for the other side is not a step.
  let shown = g;
  for (let seq = 0; seq < 400 && g.phase !== "over" && g.round <= 12; ) {
    let acted = false;
    for (let seat = 0; seat < 2 && g.phase !== "over"; seat++) {
      const choice = chooseAction(viewFor(g, seat), botRandom);
      if (!choice) continue;
      const action = { ...choice, seat } as Action;
      const r = applyAction(g, action, streamFor(log.seed, seq));
      if (r.events.length === 0) waited++;
      else shown = r.state;
      g = r.state;
      log.actions.push({ seq, action });
      seq++;
      acted = true;
    }
    if (!acted) break;
  }
  const steps = replaySteps("crossroads", log);
  const last = steps[steps.length - 1]!;
  check("a replay starts from the empty board", steps[0]!.view.units.length === 0 && steps[0]!.view.round === 1);
  check("and ends exactly where the game did", JSON.stringify(last.view) === JSON.stringify(viewFor(shown, null)), `${last.view.round} vs ${shown.round}`);
  check("one step per action that changed something", steps.length === 1 + log.actions.length - waited, `${steps.length} steps, ${log.actions.length} actions, ${waited} waits`);
  check("with the fog lifted: every tile visible", last.view.visible.length === getMap("crossroads").width * getMap("crossroads").height);
  const a = streamFor("s", 1)();
  const b = streamFor("s", 2)();
  check("each action gets its own stream", a !== b && a >= 0 && a < 1);
}

// ---------------------------------------------------------------------------
section("Computer opponents: three levels, all legal, none cheating");

{
  /** Bots play a game out (or to the round cap); counts refused actions, as the simulator does. */
  const play = (mapId: string, seats: number, levels: BotLevel[], seed: string, cap = 40) => {
    let g = newGame(mapId, seats);
    const random = streamFor(`${seed}-bots`, 0);
    let refused = 0;
    let seq = 0;
    let stuck = false;
    const mostSpawns = new Map<BotLevel, number>();
    while (g.phase !== "over" && g.round <= cap && seq < 5000) {
      let acted = false;
      for (let seat = 0; seat < seats && g.phase !== "over"; seat++) {
        const level = levels[seat % levels.length]!;
        const choice = chooseAction(viewFor(g, seat), random, level);
        if (!choice) continue;
        if (choice.type === "orders") mostSpawns.set(level, Math.max(mostSpawns.get(level) ?? 0, choice.orders.spawns.length));
        try {
          g = applyAction(g, { ...choice, seat } as Action, streamFor(seed, seq++)).state;
        } catch (e) {
          if (!(e instanceof RuleError)) throw e;
          refused++;
          const fallback: Action = g.phase === "planning" ? { type: "orders", seat, orders: { moves: [], spawns: [] } } : { type: "endAttacks", seat };
          g = applyAction(g, fallback, streamFor(seed, seq++)).state;
        }
        acted = true;
      }
      if (!acted) {
        stuck = true;
        break;
      }
    }
    return { g, refused, stuck, mostSpawns };
  };

  for (const level of BOT_LEVELS) {
    const games = [play("crossroads", 2, [level], `lv-${level}-1`), play("riverside", 2, [level], `lv-${level}-2`), play("four-corners", 4, [level], `lv-${level}-3`, 25)];
    const refused = games.reduce((t, r) => t + r.refused, 0);
    check(`${level} bots only ever send legal actions`, refused === 0, `${refused} refused`);
    check(`${level} bots never get stuck`, games.every((r) => !r.stuck));
    check(`${level} bots play their games on past round 5`, games.every((r) => r.g.round > 5));
  }
  const mixed = [play("crossroads", 2, ["veteran", "novice"], "lv-mixed-1"), play("crossroads", 2, ["novice", "regular"], "lv-mixed-2"), play("four-corners", 4, ["veteran", "regular", "novice", "veteran"], "lv-mixed-3", 25)];
  check("levels mixed in one game play legally too", mixed.every((r) => r.refused === 0 && !r.stuck), mixed.map((r) => r.refused).join(","));
  check("a novice deploys at most two units a round", mixed.every((r) => (r.mostSpawns.get("novice") ?? 0) <= 2), mixed.map((r) => r.mostSpawns.get("novice")).join(","));

  // Regular is the default and is the bot as it was: the same view and the
  // same random stream give the same choice, and use up the same draws.
  const sample = play("crossroads", 2, ["regular"], "lv-sample", 8).g;
  let same = true;
  const differs = { novice: false, veteran: false };
  for (let seat = 0; seat < 2; seat++) {
    const view = viewFor(sample, seat);
    const a = streamFor("lv-same", seat);
    const b = streamFor("lv-same", seat);
    const plain = JSON.stringify(chooseAction(view, a));
    if (plain !== JSON.stringify(chooseAction(view, b, "regular")) || a() !== b()) same = false;
    for (const level of ["novice", "veteran"] as const) {
      if (JSON.stringify(chooseAction(view, streamFor("lv-same", seat), level)) !== plain) differs[level] = true;
    }
  }
  check("no level given means regular, draw for draw", same);
  check("novice and veteran decide differently from regular", differs.novice && differs.veteran);

  // No level sees through the fog: an enemy out of sight changes nothing.
  board("bot-fog", () => {}, 20, 12);
  const seen = [unit(1, 0, "rifleman", 3, 5, { facing: E }), unit(2, 0, "heavy", 2, 6, { facing: E }), unit(3, 1, "rifleman", 9, 5, { facing: W })];
  const hidden = unit(4, 1, "sniper", 19, 0, { facing: W });
  const withHidden = stateOn("bot-fog", [...seen, hidden]);
  const without = stateOn("bot-fog", seen);
  const fogged = !viewFor(withHidden, 0).units.some((u) => u.id === hidden.id);
  check("(the extra enemy is out of seat 0's sight)", fogged);
  for (const level of BOT_LEVELS) {
    const a = JSON.stringify(chooseAction(viewFor(withHidden, 0), streamFor("fog", 0), level));
    const b = JSON.stringify(chooseAction(viewFor(without, 0), streamFor("fog", 0), level));
    check(`a ${level} bot plans the same with or without an enemy it can't see`, a === b);
  }

  // A veteran finishes off the wounded: two riflemen in its sights, one nearly dead.
  board("bot-focus");
  const focus = stateOn("bot-focus", [
    unit(1, 0, "rifleman", 2, 5, { facing: E }),
    unit(2, 1, "rifleman", 6, 4, { facing: W }),
    unit(3, 1, "rifleman", 6, 6, { facing: W, hp: 20 }),
  ]);
  focus.phase = "attack";
  focus.attackTurn = 0;
  const vShot = chooseAction(viewFor(focus, 0), streamFor("focus", 0), "veteran");
  check("a veteran shoots the wounded enemy first", vShot?.type === "attack" && vShot.targetId === 3, JSON.stringify(vShot));
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
  const shots = errorOf((t) => (t.units.commando!.shots = 0));
  check("a unit needs at least one shot", shots.includes("commando.json") && shots.includes('"shots"'), shots);
  check("there are ten classes, in the shop's order", UNIT_KINDS.length === 10 && UNIT_KINDS[0] === "rifleman" && UNIT_KINDS[9] === "officer", UNIT_KINDS.join(","));
}
{
  // A snapshot from before version 2: eight classes, the breacher, old fields.
  const old = structuredClone(FILE_TUNING) as unknown as { rules: Record<string, unknown>; units: Record<string, Record<string, unknown>> };
  old.units.breacher = { ...old.units.shotgun!, damage: 77 };
  for (const k of ["shotgun", "healer", "officer"]) delete old.units[k];
  for (const u of Object.values(old.units)) delete u.shots;
  const traits = old.rules.traits as Record<string, unknown>;
  traits.shieldFrontDamage = 0.4;
  traits.steadyMinRange = 3;
  delete traits.splashDamage;
  delete old.rules.damageVariance;
  old.units.rifleman!.accuracy = 61;
  let up: Tuning | null = null;
  let err = "";
  try {
    up = upgradeSnapshot(old as unknown as { rules: unknown; units: Record<string, unknown> });
  } catch (e) {
    err = String(e);
  }
  check("an old snapshot upgrades to a valid tuning", !!up, err);
  if (up) {
    check("with all ten classes", UNIT_KINDS.every((k) => up!.units[k]?.kind === k));
    check("the breacher's numbers become the shotgun's", up.units.shotgun.damage === 77, `${up.units.shotgun.damage}`);
    check("numbers it had are kept", up.units.rifleman.accuracy === 61);
    check("fields it never had come from the files", up.rules.traits.splashDamage === FILE_TUNING.rules.traits.splashDamage && up.units.commando.shots === FILE_TUNING.units.commando.shots);
    check("fields that no longer exist are dropped", !("shieldFrontDamage" in up.rules.traits) && !("steadyMinRange" in up.rules.traits));
  }
  const current = upgradeSnapshot({ version: 2, ...(structuredClone(FILE_TUNING) as unknown as { rules: unknown; units: Record<string, unknown> }) });
  check("a current snapshot passes through unchanged", JSON.stringify(current) === JSON.stringify(FILE_TUNING));

  // A current-format snapshot taken before a field was added to the files
  // (a game created yesterday): it must still load, keeping its own numbers.
  const yesterday = structuredClone(FILE_TUNING) as unknown as { rules: Record<string, unknown>; units: Record<string, Record<string, unknown>> };
  delete yesterday.rules.baseCaptureRounds;
  (yesterday.rules.flank as Record<string, unknown>).side = 1.25;
  yesterday.rules.retiredField = 3;
  let filled: Tuning | null = null;
  let why = "";
  try {
    filled = upgradeSnapshot({ version: 2, ...(yesterday as unknown as { rules: unknown; units: Record<string, unknown> }) });
  } catch (e) {
    why = String(e);
  }
  check("a snapshot missing a newer field still loads", !!filled, why);
  check("taking the new field from the files", filled?.rules.baseCaptureRounds === FILE_TUNING.rules.baseCaptureRounds);
  check("and keeping its own numbers", filled?.rules.flank.side === 1.25, String(filled?.rules.flank.side));
  check("dropping a field the files no longer have", !!filled && !("retiredField" in filled.rules));
}
{
  // A game played under one tuning replays identically under its snapshot,
  // even after the files change; replaying it under the new numbers would not.
  board("snapshot");
  const original: Tuning = structuredClone(FILE_TUNING);
  const changed: Tuning = structuredClone(FILE_TUNING);
  changed.units.rifleman.damage = 99;
  const play = () => {
    let g = stateOn("snapshot", [unit(1, 0, "rifleman", 3, 5, { facing: E }), unit(2, 1, "heavy", 7, 5, { facing: W })]);
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
