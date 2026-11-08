// The computer opponent. It decides from a PlayerView only, the same fog-of-war
// view a human gets, so it cannot cheat: it plans around the enemies it can
// see and gets surprised by the ones it can't.
//
// The plan is deliberately simple, and readable as a list of priorities:
//   Buying:    an engineer while there are income sites to take, then a mix.
//   Moving:    stay on a site it is capturing; otherwise head for the nearest
//              site it doesn't hold, preferring tiles with cover, never two
//              units to one tile; face the nearest enemy it knows of.
//   Shooting:  the shot with the best expected damage, with a bonus for kills.
import { previewShot } from "./combat.js";
import { DIRS, TERRAIN, distance, edgeAt, facingToward, inBounds, terrainAt } from "./grid.js";
import { getMap } from "./maps.js";
import { pathTo, reachable } from "./movement.js";
import { targetsFor, validateOrders } from "./rules.js";
import { UNITS, hasTrait } from "./units.js";
import { spawnTiles } from "./visibility.js";
import { stateFromView, type PlayerView } from "./view.js";
import type { Facing, MapDef, MoveOrder, Orders, Point, SpawnOrder, Unit, UnitKind } from "./types.js";

/** What a bot wants to do: an action without its seat, as a client would send it. */
export type BotAction =
  | { type: "orders"; orders: Orders }
  | { type: "attack"; unitId: number; targetId: number }
  | { type: "endAttacks" };

/** Shopping weights once the essentials are covered. Riflemen are the backbone. */
const MIX: [UnitKind, number][] = [
  ["rifleman", 5],
  ["heavy", 2],
  ["breacher", 2],
  ["sniper", 1],
  ["riot", 1],
  ["commando", 1],
  ["scout", 1],
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
  // neutral one is a target. Income sites matter to engineers only.
  const posts = map.posts.filter((_, i) => view.postOwners[i] !== seat);
  const income = map.income.filter((_, i) => view.incomeOwners[i] !== seat);
  const enemyBase = centreOf(map.bases.filter((_, s) => s !== seat && !view.seats[s]?.eliminated).flat());

  const moves: MoveOrder[] = [];
  // Units already standing on a site they are taking stay put, and claim it.
  for (const u of mine) {
    const capturing =
      posts.some((p) => p.x === u.x && p.y === u.y) || (hasTrait(u.kind, "engineer") && income.some((p) => p.x === u.x && p.y === u.y));
    if (capturing) {
      claimed.add(k(u));
      moves.push({ unitId: u.id, path: [], facing: faceThreat(u, enemies, map) });
    }
  }
  const capturingIds = new Set(moves.map((m) => m.unitId));

  // Everyone else heads somewhere. Units that would otherwise stay still
  // must claim their tile first, so nobody plans to land on them.
  const movers = mine.filter((u) => !capturingIds.has(u.id));
  for (const u of movers) {
    const goal = goalFor(u, posts, income, enemies, enemyBase, claimed);
    const reach = reachable(map, u, blocked);
    // A sniper with something to shoot holds still rather than spoil its aim.
    const hasShot = enemies.some((e) => previewShot(map, u, e).possible);
    let best: Point = u;
    let bestScore = hasTrait(u.kind, "steady") && hasShot ? -Infinity : scoreTile(map, u, goal, enemies);
    for (const idx of reach.cost.keys()) {
      const p = { x: idx % map.width, y: Math.floor(idx / map.width) };
      if (claimed.has(k(p))) continue;
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

function goalFor(u: Unit, posts: Point[], income: Point[], enemies: Unit[], enemyBase: Point, claimed: Set<string>): Point {
  const free = (p: Point) => !claimed.has(`${p.x},${p.y}`);
  const nearest = (ps: Point[]) => ps.filter(free).sort((a, b) => distance(u, a) - distance(u, b))[0];
  if (hasTrait(u.kind, "engineer")) {
    const site = nearest(income);
    if (site) return site;
  }
  return nearest(posts) ?? [...enemies].sort((a, b) => distance(u, a) - distance(u, b))[0] ?? enemyBase;
}

/** Higher is better: close to the goal, in cover, not standing in the open next to enemies. */
function scoreTile(map: MapDef, p: Point, goal: Point, enemies: Unit[]): number {
  let score = -distance(p, goal);
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
  const taken = (p: Point) => claimed.has(`${p.x},${p.y}`) || mine.some((u) => u.x === p.x && u.y === p.y);
  const centre = { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };
  // Deploy as far forward as possible: tiles nearest the middle first.
  const tiles = spawnTiles(map, { postOwners: view.postOwners }, seat)
    .filter((t) => !taken(t))
    .sort((a, b) => distance(a, centre) - distance(b, centre));
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
  let best: { unitId: number; targetId: number; score: number } | null = null;
  for (const id of view.readyShooters) {
    const shooter = view.units.find((u) => u.id === id);
    if (!shooter) continue;
    for (const target of targetsFor(map, state, shooter)) {
      const p = previewShot(map, shooter, target);
      const kills = p.damage >= target.hp;
      const score = p.chance * p.damage * (kills ? 2 : 1);
      if (!best || score > best.score) best = { unitId: shooter.id, targetId: target.id, score };
    }
  }
  return best ? { type: "attack", unitId: best.unitId, targetId: best.targetId } : { type: "endAttacks" };
}
