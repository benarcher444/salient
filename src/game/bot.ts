// The computer opponent. It decides from a PlayerView only, the same fog-of-war
// view a human gets, so it cannot cheat: it plans around the enemies it can
// see and gets surprised by the ones it can't.
//
// The plan is deliberately simple, and readable as a list of priorities:
//   Buying:    an engineer while there are income sites to take, then a mix.
//   Moving:    stay on a site it is capturing (an enemy base tile, a post,
//              income for engineers). Send the nearest units home when enemies
//              come near its base. Everyone else heads for its own lost base
//              tiles first, then enemy base tiles and posts, preferring tiles
//              with cover, never two units to one tile; face the nearest enemy.
//   Shooting:  the shot with the best expected damage, with a bonus for kills
//              and a bigger one for enemies standing on its base. A blast
//              counts what it does to everyone it catches, its own side
//              against it, and a shot that would hurt it more than the enemy
//              is not taken.
import { blastTiles, previewShot } from "./combat.js";
import { DIRS, TERRAIN, distance, edgeAt, facingToward, inBounds, terrainAt } from "./grid.js";
import { getMap } from "./maps.js";
import { pathTo, reachable } from "./movement.js";
import { targetsFor, validateOrders } from "./rules.js";
import { UNITS, hasTrait } from "./units.js";
import { baseTiles, spawnTiles } from "./visibility.js";
import { stateFromView, type PlayerView } from "./view.js";
import type { Facing, MapDef, MoveOrder, Orders, Point, SpawnOrder, Unit, UnitKind } from "./types.js";

/** What a bot wants to do: an action without its seat, as a client would send it. */
export type BotAction =
  | { type: "orders"; orders: Orders }
  | { type: "attack"; unitId: number; targetId: number }
  | { type: "endAttacks" };

/** Below this hit chance a bot holds fire (see chooseShot). */
const MIN_SHOT_CHANCE = 0.2;

/** Shopping weights once the essentials are covered. Riflemen are the backbone. */
const MIX: [UnitKind, number][] = [
  ["rifleman", 5],
  ["shotgun", 2],
  ["heavy", 2],
  ["sniper", 1],
  ["commando", 1],
  ["scout", 1],
  ["riot", 1],
  ["healer", 1],
  ["officer", 1],
];
const MAX_DEPLOY_PER_ROUND = 4;

/** Is it this seat's move, and if so what should it do? null = nothing to do. */
export function chooseAction(view: PlayerView, random: () => number = Math.random): BotAction | null {
  const seat = view.seat;
  if (seat === null || view.phase === "over" || view.seats[seat]?.eliminated) return null;
  if (view.phase === "planning") return view.seats[seat]!.ready ? null : { type: "orders", orders: planOrders(view, random) };
  if (view.attackTurn === seat) return chooseShot(view);
  return null;
}

// --- Planning ------------------------------------------------------------------------

export function planOrders(view: PlayerView, random: () => number): Orders {
  const map = getMap(view.mapId);
  const state = stateFromView(view);
  const seat = view.seat!;
  const mine = view.units.filter((u) => u.seat === seat);
  const enemies = view.units.filter((u) => u.seat !== seat);
  const blocked = new Set(enemies.map((e) => e.y * map.width + e.x));
  const claimed = new Set<string>();
  const k = (p: Point) => `${p.x},${p.y}`;

  // Sites still to take. A post we already own is done; the enemy's or a
  // neutral one is a target. Income sites matter to engineers only. Base
  // tiles: our own lost ones come first, then the enemy's.
  const posts = map.posts.filter((_, i) => view.postOwners[i] !== seat);
  const income = map.income.filter((_, i) => view.incomeOwners[i] !== seat);
  const bases = baseTiles(map, view.seats.length);
  const lostBase = bases.filter((t, i) => t.home === seat && view.baseOwners[i] !== seat);
  const enemyBaseTiles = bases.filter((t, i) => t.home !== seat && view.baseOwners[i] !== seat);
  const ownBase = bases.filter((_, i) => view.baseOwners[i] === seat);
  const enemyBase = centreOf(enemyBaseTiles);
  const on = (ps: Point[], u: Point) => ps.some((p) => p.x === u.x && p.y === u.y);

  const moves: MoveOrder[] = [];
  // Units already standing on a site they are taking stay put, and claim it.
  for (const u of mine) {
    const capturing =
      on(posts, u) || on(lostBase, u) || on(enemyBaseTiles, u) || (hasTrait(u.kind, "engineer") && on(income, u));
    if (capturing) {
      claimed.add(k(u));
      moves.push({ unitId: u.id, path: [], facing: faceThreat(u, enemies, map) });
    }
  }
  const capturingIds = new Set(moves.map((m) => m.unitId));

  // Defence: for each base tile of ours an enemy is closing on, the nearest
  // free unit goes to stand on it (a defender on the tile blocks the capture).
  const defending = new Map<number, Point>();
  const threatened = ownBase
    .filter((t) => enemies.some((e) => distance(e, t) <= DEFEND_RADIUS))
    .sort((a, b) => nearestEnemy(a, enemies) - nearestEnemy(b, enemies))
    .slice(0, MAX_DEFENDERS);
  for (const t of threatened) {
    const guard = mine
      .filter((u) => !capturingIds.has(u.id) && !defending.has(u.id))
      .sort((a, b) => distance(a, t) - distance(b, t))[0];
    if (guard && distance(guard, t) <= DEFEND_RADIUS + 4) defending.set(guard.id, t);
  }

  // Everyone else heads somewhere. Units that would otherwise stay still
  // must claim their tile first, so nobody plans to land on them.
  const movers = mine.filter((u) => !capturingIds.has(u.id));
  for (const u of movers) {
    const goal = defending.get(u.id) ?? goalFor(u, { posts, income, lostBase, enemyBaseTiles }, enemies, enemyBase, claimed);
    // A unit that fired last round may only turn.
    if (u.fired) {
      claimed.add(k(u));
      moves.push({ unitId: u.id, path: [], facing: faceThreat(u, enemies, map, goal) });
      continue;
    }
    const reach = reachable(map, u, blocked);
    // A sniper with something to shoot holds still rather than spoil its aim.
    const hasShot = enemies.some((e) => previewShot(map, u, e, view.units).possible);
    let best: Point = u;
    let bestScore = hasTrait(u.kind, "steady") && hasShot ? -Infinity : scoreTile(map, u, goal, enemies);
    for (const idx of reach.cost.keys()) {
      const p = { x: idx % map.width, y: Math.floor(idx / map.width) };
      if (claimed.has(k(p))) continue;
      // Routes may end on a seen enemy's tile, but the bot doesn't gamble on it leaving.
      if (blocked.has(idx)) continue;
      // Never aim for a teammate's tile, even one that may move off it: if it
      // ends up staying, two units would be ordered onto one tile.
      if (mine.some((o) => o.id !== u.id && o.x === p.x && o.y === p.y)) continue;
      const score = scoreTile(map, p, goal, enemies) + random() * 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    claimed.add(k(best));
    const path = best.x === u.x && best.y === u.y ? [] : (pathTo(map, reach, best) ?? []);
    const at = path.length ? path[path.length - 1]! : u;
    moves.push({ unitId: u.id, path, facing: faceThreat(at, enemies, map, goal) });
  }

  const spawns = planSpawns(view, map, mine, claimed, random);
  const orders: Orders = { moves, spawns };
  try {
    validateOrders(map, state, seat, orders);
    return orders;
  } catch {
    // Whatever went wrong, standing still is always legal.
    return { moves: [], spawns: [] };
  }
}

/** How close an enemy must be to a base tile before the bot sends someone home. */
const DEFEND_RADIUS = 6;
const MAX_DEFENDERS = 2;

const nearestEnemy = (p: Point, enemies: Unit[]) => Math.min(Infinity, ...enemies.map((e) => distance(p, e)));

interface Targets {
  posts: Point[];
  income: Point[];
  lostBase: Point[];
  enemyBaseTiles: Point[];
}

function goalFor(u: Unit, t: Targets, enemies: Unit[], enemyBase: Point, claimed: Set<string>): Point {
  const free = (p: Point) => !claimed.has(`${p.x},${p.y}`);
  if (hasTrait(u.kind, "engineer")) {
    const site = t.income.filter(free).sort((a, b) => distance(u, a) - distance(u, b))[0];
    if (site) return site;
  }
  // Weighted by distance less a bonus: retaking our own base matters most,
  // then the enemy's base (it wins the game), then command posts.
  const options: [Point, number][] = [
    ...t.lostBase.filter(free).map((p): [Point, number] => [p, distance(u, p) - 6]),
    ...t.enemyBaseTiles.filter(free).map((p): [Point, number] => [p, distance(u, p) - 3]),
    ...t.posts.filter(free).map((p): [Point, number] => [p, distance(u, p)]),
  ];
  options.sort((a, b) => a[1] - b[1]);
  return options[0]?.[0] ?? [...enemies].sort((a, b) => distance(u, a) - distance(u, b))[0] ?? enemyBase;
}

/** Higher is better: close to the goal, in cover, not standing in the open next to enemies. */
function scoreTile(map: MapDef, p: Point, goal: Point, enemies: Unit[]): number {
  let score = -distance(p, goal);
  // Standing on the goal itself is what takes (or holds) it: worth more than cover.
  if (p.x === goal.x && p.y === goal.y) score += 2.5;
  score += coverAround(map, p) * 0.9;
  for (const e of enemies) {
    const d = distance(p, e);
    // Close to an enemy you can be flanked; very close to a shotgun is worse.
    if (d < 2.5) score -= 1.5;
  }
  return score;
}

/** How much cover a tile has: woods underfoot, crates beside it, windows on its edges. */
function coverAround(map: MapDef, p: Point): number {
  let cover = TERRAIN[terrainAt(map, p.x, p.y)].cover ? 1 : 0;
  for (const d of DIRS) {
    const x = p.x + d.x;
    const y = p.y + d.y;
    if (inBounds(map, x, y) && terrainAt(map, x, y) === "crate") cover += 0.6;
  }
  for (const side of ["n", "e", "s", "w"] as const) if (edgeAt(map, p.x, p.y, side) === "window") cover += 0.6;
  return Math.min(cover, 1.5);
}

function faceThreat(at: Point, enemies: Unit[], map: MapDef, fallback?: Point): Facing {
  const threat = [...enemies].sort((a, b) => distance(at, a) - distance(at, b))[0];
  if (threat) return facingToward(at, threat);
  const toward = fallback && (fallback.x !== at.x || fallback.y !== at.y) ? fallback : { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };
  return facingToward(at, toward);
}

function planSpawns(view: PlayerView, map: MapDef, mine: Unit[], claimed: Set<string>, random: () => number): SpawnOrder[] {
  const seat = view.seat!;
  let gold = view.gold;
  const spawns: SpawnOrder[] = [];
  // Any unit it can see standing there, enemies too: a deployment onto an
  // enemy's tile fails (game 3xaupj: bots with no units left kept buying onto
  // the tiles the enemy stood on, and never got a unit out).
  const taken = (p: Point) => claimed.has(`${p.x},${p.y}`) || view.units.some((u) => u.x === p.x && u.y === p.y);
  const centre = { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };
  // Deploy as far forward as possible: tiles nearest the middle first.
  // With enemies near, deploy closest to them instead: that is where help is needed.
  const enemies = view.units.filter((u) => u.seat !== seat);
  const urgency = (p: Point) => (enemies.length && nearestEnemy(p, enemies) <= DEFEND_RADIUS ? nearestEnemy(p, enemies) - 100 : distance(p, centre));
  const tiles = spawnTiles(map, { postOwners: view.postOwners, baseOwners: view.baseOwners, seatCount: view.seats.length }, seat)
    .filter((t) => !taken(t))
    .sort((a, b) => urgency(a) - urgency(b));
  const kinds = new Map<UnitKind, number>();
  for (const u of mine) kinds.set(u.kind, (kinds.get(u.kind) ?? 0) + 1);
  const wantEngineer = map.income.some((_, i) => view.incomeOwners[i] !== seat) && !kinds.get("engineer");

  for (const tile of tiles) {
    if (spawns.length >= MAX_DEPLOY_PER_ROUND) break;
    // Decide what it wants first, then buy it only if it can: otherwise it
    // saves up. Buying the best it can afford meant nothing but scouts, since
    // a round's income rarely covers anything dearer.
    const kind: UnitKind =
      wantEngineer && !spawns.some((s) => s.kind === "engineer") ? "engineer" : pickWeighted(MIX, random)!;
    if (UNITS[kind].cost > gold) break;
    gold -= UNITS[kind].cost;
    spawns.push({ kind, x: tile.x, y: tile.y, facing: facingToward(tile, centre) });
    claimed.add(`${tile.x},${tile.y}`);
  }
  return spawns;
}

function pickWeighted(options: [UnitKind, number][], random: () => number): UnitKind | undefined {
  const total = options.reduce((t, [, w]) => t + w, 0);
  let r = random() * total;
  for (const [kind, w] of options) {
    r -= w;
    if (r < 0) return kind;
  }
  return options[options.length - 1]?.[0];
}

function centreOf(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  const x = Math.round(points.reduce((t, p) => t + p.x, 0) / points.length);
  const y = Math.round(points.reduce((t, p) => t + p.y, 0) / points.length);
  return { x, y };
}

// --- Shooting ---------------------------------------------------------------------------

export function chooseShot(view: PlayerView): BotAction {
  const map = getMap(view.mapId);
  const state = stateFromView(view);
  // Enemies standing on base tiles we own are taking them: shoot those first.
  const ownBase = baseTiles(map, view.seats.length).filter((_, i) => view.baseOwners[i] === view.seat);
  let best: { unitId: number; targetId: number; score: number } | null = null;
  for (const id of view.readyShooters) {
    const shooter = view.units.find((u) => u.id === id);
    if (!shooter) continue;
    for (const target of targetsFor(map, state, shooter)) {
      const p = previewShot(map, shooter, target, view.units);
      const kills = p.damage >= target.hp;
      const raiding = ownBase.some((b) => b.x === target.x && b.y === target.y);
      // Firing pins the shooter down next round, so a long shot isn't free:
      // skip the ones that will almost never land (a riot's shield, from the
      // front), unless the shell bursts anyway or the target is taking our base.
      if (p.chance < MIN_SHOT_CHANCE && p.splash === 0 && !raiding) continue;
      let score = p.chance * p.damage * (kills ? 2 : 1) * (raiding ? 3 : 1);
      if (p.splash > 0) {
        for (const t of blastTiles(map, target)) {
          const u = view.units.find((o) => o.x === t.x && o.y === t.y);
          if (!u) continue;
          // The target takes the blast only when the shell misses it.
          const share = u === target ? 1 - p.chance : 1;
          score += (u.seat === view.seat ? -1.5 : 1) * share * p.splash;
        }
      }
      if (score <= 0) continue;
      if (!best || score > best.score) best = { unitId: shooter.id, targetId: target.id, score };
    }
  }
  return best ? { type: "attack", unitId: best.unitId, targetId: best.targetId } : { type: "endAttacks" };
}
