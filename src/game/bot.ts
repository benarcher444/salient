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
//
// That is the Regular bot. Every game picks one of three levels (BotLevel),
// and the level only ever changes the *decisions*: every level gets the same
// PlayerView. Novice and Veteran are Regular with these differences:
//   Novice:    buys from a flat mix (poor picks included), at most two units a
//              round, no engineer first; wanders (big random jitter in where it
//              goes, a quarter of its units just hold still), never sends
//              anyone home to defend; a third of its shots go at a random
//              target, and now and then it holds fire for the round.
//   Veteran:   shoots to kill: a target's worth is what it costs and what it
//              can do, the chance the shot finishes it counts, and wounded
//              enemies come first; raiders on its posts count too. Moves weigh
//              what each tile can shoot at against how much the enemies it
//              sees could hit it there, stays near its own, and faces the enemy
//              it can best shoot. Buys to counter what it sees (shotguns and
//              heavies against riots, commandos against snipers), keeps one
//              engineer only while there is income it can reach safely.
//              (Saving up to deploy in pairs and keeping units from going
//              forward alone were tried in the simulator, and won nothing.)
// Regular and Veteran also play each class to its power (bot-roles.ts: riots
// screen, commandos go round behind, snipers and heavies keep back, the
// badly hurt go to be healed, at base under that house rule).
import { blastTiles, damageRange, flankOf, isArmed, previewShot } from "./combat.js";
import { RULES } from "./constants.js";
import { DIRS, TERRAIN, distance, edgeAt, facingToward, inBounds, stepCost, stepOpen, terrainAt } from "./grid.js";
import { getMap } from "./maps.js";
import { pathTo, reachable } from "./movement.js";
import { Roles, rearTile } from "./bot-roles.js";
import { baseContested, targetsFor, validateOrders } from "./rules.js";
import { UNITS, UNIT_KINDS, hasTrait, stealthRange } from "./units.js";
import { baseTiles, spawnTiles } from "./visibility.js";
import { stateFromView, type PlayerView } from "./view.js";
import type { Facing, MapDef, MoveOrder, Orders, Point, SpawnOrder, Unit, UnitKind } from "./types.js";

/** What a bot wants to do: an action without its seat, as a client would send it. */
export type BotAction =
  | { type: "orders"; orders: Orders }
  | { type: "attack"; unitId: number; targetId: number }
  | { type: "endAttacks" };

/** How well a computer opponent plays. Chosen per game; Regular is the default. */
export type BotLevel = "novice" | "regular" | "veteran";
export const BOT_LEVELS: readonly BotLevel[] = ["novice", "regular", "veteran"];
export const BOT_LEVEL_NAME: Record<BotLevel, string> = { novice: "Novice", regular: "Regular", veteran: "Veteran" };
export const isBotLevel = (s: unknown): s is BotLevel => typeof s === "string" && (BOT_LEVELS as readonly string[]).includes(s);

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

/** A novice shops from every class alike, engineers and unarmed riots included. */
const NOVICE_MIX: [UnitKind, number][] = UNIT_KINDS.map((k): [UnitKind, number] => [k, 1]);
/**
 * A novice's handicaps: units a round, the jitter in where it goes (Regular's
 * is 0.3, against a tile's score of about one per tile of distance), the share
 * of units that just stand still, of shots at a random target, of turns it
 * holds fire for the round.
 */
const NOVICE = { maxDeploy: 2, noise: 2.5, holdStill: 0.25, randomShot: 0.35, holdFire: 0.05 };

/** A veteran's shopping before it counters anything: riflemen, officers to lead them, heavies and shotguns. */
const VETERAN_MIX: [UnitKind, number][] = [
  ["rifleman", 5],
  ["officer", 2],
  ["shotgun", 2],
  ["heavy", 2],
  ["sniper", 1],
  ["healer", 1],
  ["commando", 1],
  ["scout", 0.5],
];
/**
 * How a veteran weighs a tile, per 30 damage expected (a rifleman's hit): the
 * best shot it could take from there, against the shots the enemies it sees
 * could take at it there, plus a little for friends close by. Tried in the
 * simulator: more weight on danger made it win no more and stall more often.
 */
const VETERAN = { offense: 0.9, danger: 0.4, company: 0.25, companyMax: 0.75 };

/**
 * Switches for the simulator's comparisons, never set in a real game:
 * `roles: false` plays without the class roles (bot-roles.ts), the bot as it
 * was before them.
 */
export interface BotOptions {
  roles?: boolean;
}

/** Is it this seat's move, and if so what should it do? null = nothing to do. */
export function chooseAction(view: PlayerView, random: () => number = Math.random, level: BotLevel = "regular", opts: BotOptions = {}): BotAction | null {
  const seat = view.seat;
  if (seat === null || view.phase === "over" || view.seats[seat]?.eliminated) return null;
  if (view.phase === "planning") return view.seats[seat]!.ready ? null : { type: "orders", orders: planOrders(view, random, level, opts) };
  if (view.attackTurn === seat) return chooseShot(view, random, level, opts);
  return null;
}

// --- Planning ------------------------------------------------------------------------

export function planOrders(view: PlayerView, random: () => number, level: BotLevel = "regular", opts: BotOptions = {}): Orders {
  const map = getMap(view.mapId);
  const state = stateFromView(view);
  const seat = view.seat!;
  const mine = view.units.filter((u) => u.seat === seat);
  const enemies = view.units.filter((u) => u.seat !== seat);
  const blocked = new Set(enemies.map((e) => e.y * map.width + e.x));
  const claimed = new Set<string>();
  const k = (p: Point) => `${p.x},${p.y}`;
  // Every level but Novice reads the ground (danger) for its class roles;
  // only a Veteran weighs every tile by it.
  const sense = level !== "novice" ? new Tactics(map, view, mine, enemies) : null;
  const tactics = level === "veteran" ? sense : null;
  const roles =
    sense && opts.roles !== false
      ? new Roles(map, view, state, mine, enemies, {
          walk: (from, to) => walkDistance(map, from, to),
          danger: (u, p) => sense.danger(u, p),
          worth,
        })
      : null;

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
  const facing = (u: Unit, at: Point, goal?: Point) => roles?.facing(u, at) ?? tactics?.bestFacing(u, at) ?? faceThreat(at, enemies, map, goal);

  const moves: MoveOrder[] = [];
  // Units already standing on a site they are taking stay put, and claim it.
  for (const u of mine) {
    const capturing =
      on(posts, u) || on(lostBase, u) || on(enemyBaseTiles, u) || (hasTrait(u.kind, "engineer") && on(income, u));
    if (capturing) {
      claimed.add(k(u));
      moves.push({ unitId: u.id, path: [], facing: facing(u, u) });
    }
  }
  const capturingIds = new Set(moves.map((m) => m.unitId));

  // Defence: for each base tile of ours an enemy is closing on, the nearest
  // free unit goes to stand on it (a defender on the tile blocks the capture).
  // A novice doesn't notice.
  const defending = new Map<number, Point>();
  const threatened =
    level === "novice"
      ? []
      : ownBase
          .filter((t) => enemies.some((e) => distance(e, t) <= DEFEND_RADIUS))
          .sort((a, b) => nearestEnemy(a, enemies) - nearestEnemy(b, enemies))
          .slice(0, level === "veteran" ? MAX_DEFENDERS + 1 : MAX_DEFENDERS);
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
    const defend = defending.get(u.id);
    const usual = defend ?? goalFor(map, u, { posts, income, lostBase, enemyBaseTiles }, enemies, enemyBase, claimed);
    const goal = roles && !defend ? roles.goal(u, usual, claimed) : usual;
    // A unit that fired last round may only turn. A novice's sometimes just stays.
    if (u.fired || (level === "novice" && random() < NOVICE.holdStill)) {
      claimed.add(k(u));
      moves.push({ unitId: u.id, path: [], facing: facing(u, u, goal) });
      continue;
    }
    const reach = reachable(map, u, blocked);
    // A sniper with something to shoot holds still rather than spoil its aim.
    const hasShot = enemies.some((e) => previewShot(map, u, e, view.units).possible);
    // A healer only helps the allies touching it: it goes where the hurt are
    // (where they stand now; they may move). A novice doesn't think of it.
    const healing = level !== "novice" && hasTrait(u.kind, "medic");
    const care = (p: Point) =>
      healing ? mine.filter((o) => o.id !== u.id && Math.max(Math.abs(o.x - p.x), Math.abs(o.y - p.y)) <= RULES.medicRange).reduce((t, o) => t + Math.min(RULES.medicHeal, UNITS[o.kind].hp - o.hp), 0) / 4 : 0;
    const score = (p: Point) => scoreTile(map, p, goal, enemies) + (tactics?.score(u, p) ?? 0) + care(p) + (roles?.score(u, p, goal) ?? 0);
    let best: Point = u;
    let bestScore = hasTrait(u.kind, "steady") && hasShot ? -Infinity : score(u);
    const noise = level === "novice" ? NOVICE.noise : 0.3;
    for (const idx of reach.cost.keys()) {
      const p = { x: idx % map.width, y: Math.floor(idx / map.width) };
      if (claimed.has(k(p))) continue;
      // Routes may end on a seen enemy's tile, but the bot doesn't gamble on it leaving.
      if (blocked.has(idx)) continue;
      // Never aim for a teammate's tile, even one that may move off it: if it
      // ends up staying, two units would be ordered onto one tile.
      if (mine.some((o) => o.id !== u.id && o.x === p.x && o.y === p.y)) continue;
      const s = score(p) + random() * noise;
      if (s > bestScore) {
        bestScore = s;
        best = p;
      }
    }
    claimed.add(k(best));
    const path = best.x === u.x && best.y === u.y ? [] : (pathTo(map, reach, best) ?? []);
    const at = path.length ? path[path.length - 1]! : u;
    moves.push({ unitId: u.id, path, facing: facing({ ...u, moved: path.length > 0 }, at, goal) });
  }

  const spawns = planSpawns(view, map, mine, claimed, random, level);
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

/**
 * Walking distance to `goal`, in tiles, round walls and through doors (units
 * ignored: they move). Bots used straight-line distance, and on an indoor map
 * a unit would walk up to the wall nearest its goal and stay there, every
 * step towards the door looking like a step back: four bots on the Warren
 * fought 150 rounds without reaching a base. One field per goal tile, filled
 * outwards from the goal and cached (the walls never change).
 */
const walkFields = new Map<string, Float64Array>();
function walkDistance(map: MapDef, from: Point, goal: Point): number {
  const key = `${map.id}:${goal.x},${goal.y}`;
  let field = walkFields.get(key);
  if (!field) {
    if (walkFields.size > 4000) walkFields.clear();
    field = new Float64Array(map.width * map.height).fill(Infinity);
    const start = goal.y * map.width + goal.x;
    field[start] = 0;
    const open = [start];
    while (open.length) {
      let best = 0;
      for (let i = 1; i < open.length; i++) if (field[open[i]!]! < field[open[best]!]!) best = i;
      const cur = open.splice(best, 1)[0]!;
      const p = { x: cur % map.width, y: Math.floor(cur / map.width) };
      for (const d of DIRS) {
        const n = { x: p.x + d.x, y: p.y + d.y };
        if (!inBounds(map, n.x, n.y) || !stepOpen(map, n, p)) continue;
        const ni = n.y * map.width + n.x;
        const c = field[cur]! + stepCost(map, n, p) / 2;
        if (c < field[ni]!) {
          if (field[ni] === Infinity) open.push(ni);
          field[ni] = c;
        }
      }
    }
    walkFields.set(key, field);
  }
  const d = field[from.y * map.width + from.x]!;
  // Cut off from it (a tile walled in, say): far, but still ordered by the crow's flight.
  return Number.isFinite(d) ? d : 1000 + distance(from, goal);
}

function goalFor(map: MapDef, u: Unit, t: Targets, enemies: Unit[], enemyBase: Point, claimed: Set<string>): Point {
  const far = (p: Point) => walkDistance(map, u, p);
  const free = (p: Point) => !claimed.has(`${p.x},${p.y}`);
  if (hasTrait(u.kind, "engineer")) {
    const site = t.income.filter(free).sort((a, b) => far(a) - far(b))[0];
    if (site) return site;
  }
  // Weighted by distance less a bonus: retaking our own base matters most,
  // then the enemy's base (it wins the game), then command posts.
  const options: [Point, number][] = [
    ...t.lostBase.filter(free).map((p): [Point, number] => [p, far(p) - 6]),
    ...t.enemyBaseTiles.filter(free).map((p): [Point, number] => [p, far(p) - 3]),
    ...t.posts.filter(free).map((p): [Point, number] => [p, far(p)]),
  ];
  options.sort((a, b) => a[1] - b[1]);
  return options[0]?.[0] ?? [...enemies].sort((a, b) => distance(u, a) - distance(u, b))[0] ?? enemyBase;
}

/** Higher is better: close to the goal, in cover, not standing in the open next to enemies. */
function scoreTile(map: MapDef, p: Point, goal: Point, enemies: Unit[]): number {
  let score = -walkDistance(map, p, goal);
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

/**
 * A veteran's sense of the ground, from the enemies it can see: how much they
 * could hit a unit of ours on a tile (if they turned to it: they plan their
 * facings too), how much that unit could hit them from there, and company.
 * Their positions now stand in for where they will be: it knows no more.
 */
class Tactics {
  private dangerCache = new Map<string, number>();
  constructor(
    private map: MapDef,
    private view: PlayerView,
    private mine: Unit[],
    private enemies: Unit[],
  ) {}

  /** Expected damage the enemies it sees could do to `u` standing at `p`. */
  danger(u: Unit, p: Point): number {
    const key = `${u.kind},${p.x},${p.y}`;
    const cached = this.dangerCache.get(key);
    if (cached !== undefined) return cached;
    const target: Unit = { ...u, x: p.x, y: p.y };
    let total = 0;
    // A stealthy unit no enemy is close enough to spot can't be shot at.
    if (hasTrait(u.kind, "stealth") && !this.enemies.some((e) => distance(e, p) <= stealthRange())) {
      this.dangerCache.set(key, 0);
      return 0;
    }
    for (const e of this.enemies) {
      if (!isArmed(e.kind) || distance(e, p) > UNITS[e.kind].range) continue;
      // Facing it, it takes them from the front; they turn to it too.
      const shot = previewShot(this.map, { ...e, facing: facingToward(e, p) }, { ...target, facing: facingToward(p, e) });
      if (shot.possible) total += shot.chance * shot.damage * UNITS[e.kind].shots;
    }
    this.dangerCache.set(key, total);
    return total;
  }

  /** The best shot `u` could take from `p`, as expected damage weighed by the target's worth, and at whom. */
  offense(u: Unit, p: Point): { value: number; target: Unit | null } {
    let best = { value: 0, target: null as Unit | null };
    if (!isArmed(u.kind)) return best;
    const moved = u.moved || p.x !== u.x || p.y !== u.y;
    for (const e of this.enemies) {
      if (distance(e, p) > UNITS[u.kind].range) continue;
      const from: Unit = { ...u, x: p.x, y: p.y, moved, facing: facingToward(p, e) };
      const shot = previewShot(this.map, from, e, this.view.units);
      if (!shot.possible) continue;
      const value = shot.chance * Math.min(shot.damage, e.hp) * UNITS[u.kind].shots * (worth(e) / 100);
      if (value > best.value) best = { value, target: e };
    }
    return best;
  }

  score(u: Unit, p: Point): number {
    const near = this.mine.filter((o) => o.id !== u.id && distance(o, p) <= 2.5).length;
    return (
      (VETERAN.offense * this.offense(u, p).value) / 30 -
      (VETERAN.danger * this.danger(u, p)) / 30 +
      Math.min(VETERAN.companyMax, near * VETERAN.company)
    );
  }

  /** Face the enemy it can best shoot from `at`; null when there is none (the caller faces the nearest). */
  bestFacing(u: Unit, at: Point): Facing | null {
    const t = this.offense(u, at).target;
    return t ? facingToward(at, t) : null;
  }
}

/** What an enemy unit is worth taking out: its price, more if it can shoot back. */
function worth(u: Unit): number {
  return UNITS[u.kind].cost * (isArmed(u.kind) ? 1 : 0.6);
}

function planSpawns(view: PlayerView, map: MapDef, mine: Unit[], claimed: Set<string>, random: () => number, level: BotLevel): SpawnOrder[] {
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
    .filter((t) => !taken(t) && !baseContested(map, { seatCount: view.seats.length }, seat, t, view.units))
    .sort((a, b) => urgency(a) - urgency(b));
  const kinds = new Map<UnitKind, number>();
  for (const u of mine) kinds.set(u.kind, (kinds.get(u.kind) ?? 0) + 1);
  const freeIncome = map.income.filter((_, i) => view.incomeOwners[i] !== seat);
  const wantEngineer =
    level === "novice"
      ? false
      : level === "veteran"
        ? // Only for income it can take without walking into the enemy.
          !kinds.get("engineer") && freeIncome.some((s) => nearestEnemy(s, enemies) > DEFEND_RADIUS)
        : freeIncome.length > 0 && !kinds.get("engineer");
  const mix = level === "novice" ? NOVICE_MIX : level === "veteran" ? counterMix(enemies) : MIX;
  const maxDeploy = level === "novice" ? NOVICE.maxDeploy : MAX_DEPLOY_PER_ROUND;

  for (const tile of tiles) {
    if (spawns.length >= maxDeploy) break;
    // Decide what it wants first, then buy it only if it can: otherwise it
    // saves up. Buying the best it can afford meant nothing but scouts, since
    // a round's income rarely covers anything dearer.
    const kind: UnitKind =
      wantEngineer && !spawns.some((s) => s.kind === "engineer") ? "engineer" : pickWeighted(mix, random)!;
    if (UNITS[kind].cost > gold) break;
    gold -= UNITS[kind].cost;
    spawns.push({ kind, x: tile.x, y: tile.y, facing: facingToward(tile, centre) });
    claimed.add(`${tile.x},${tile.y}`);
  }
  return spawns;
}

/** A veteran's shopping list, shifted by what it can see across the field. */
function counterMix(enemies: Unit[]): [UnitKind, number][] {
  const weights = new Map(VETERAN_MIX);
  const add = (kind: UnitKind, w: number) => weights.set(kind, (weights.get(kind) ?? 0) + w);
  const count = (kind: UnitKind) => enemies.filter((e) => e.kind === kind).length;
  // Shields stop shots from the front: blasts and close, wide spreads get round them.
  add("heavy", 1.5 * count("riot"));
  add("shotgun", 1.5 * count("riot"));
  // Snipers are hopeless up close and fragile: send something fast and quiet.
  add("commando", 1.5 * count("sniper"));
  add("scout", 0.5 * count("sniper"));
  // Bunched up, they are a target for a shell.
  const bunched = enemies.filter((e) => enemies.some((o) => o.id !== e.id && distance(o, e) <= 1.5)).length;
  add("heavy", 0.5 * bunched);
  // Shotguns and commandos win up close: outrange them.
  add("rifleman", count("shotgun") + count("commando"));
  return [...weights];
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

export function chooseShot(view: PlayerView, random: () => number = Math.random, level: BotLevel = "regular", opts: BotOptions = {}): BotAction {
  const map = getMap(view.mapId);
  const state = stateFromView(view);
  // Enemies standing on base tiles we own are taking them: shoot those first.
  // A novice doesn't notice.
  const ownBase = level === "novice" ? [] : baseTiles(map, view.seats.length).filter((_, i) => view.baseOwners[i] === view.seat);
  // A veteran minds its posts and income sites too.
  const ownSites = level === "veteran" ? [...map.posts.filter((_, i) => view.postOwners[i] === view.seat), ...map.income.filter((_, i) => view.incomeOwners[i] === view.seat)] : [];
  const standsOn = (ps: Point[], u: Point) => ps.some((b) => b.x === u.x && b.y === u.y);
  // Could this unit reach an enemy's back next round?
  const stabNext = (u: Unit) =>
    view.units.some((e) => {
      if (e.seat === view.seat) return false;
      const r = rearTile(map, view.units, e);
      return !!r && walkDistance(map, u, r) <= UNITS[u.kind].move;
    });
  let best: { unitId: number; targetId: number; score: number } | null = null;
  const options: { unitId: number; targetId: number }[] = [];
  for (const id of view.readyShooters) {
    const shooter = view.units.find((u) => u.id === id);
    if (!shooter) continue;
    for (const target of targetsFor(map, state, shooter)) {
      const p = previewShot(map, shooter, target, view.units);
      const kills = p.damage >= target.hp;
      const raiding = standsOn(ownBase, target);
      // Firing pins the shooter down next round, so a long shot isn't free:
      // skip the ones that will almost never land (a riot's shield, from the
      // front), unless the shell bursts anyway or the target is taking our base.
      if (p.chance < MIN_SHOT_CHANCE && p.splash === 0 && !raiding) continue;
      // A commando playing its role (bot-roles.ts) saves itself for a back:
      // firing pins it down next round, so a shot at a face that won't kill
      // costs it the stab. It still fires at raiders.
      if (level !== "novice" && opts.roles !== false && hasTrait(shooter.kind, "backstab") && flankOf(shooter, target) === "front" && !kills && !raiding && stabNext(shooter)) continue;
      let score =
        level === "veteran"
          ? veteranValue(p, target) * (raiding ? 3 : standsOn(ownSites, target) ? 1.5 : 1)
          : p.chance * p.damage * (kills ? 2 : 1) * (raiding ? 3 : 1);
      if (p.splash > 0) {
        for (const t of blastTiles(map, target)) {
          const u = view.units.find((o) => o.x === t.x && o.y === t.y);
          if (!u) continue;
          // The target takes the blast only when the shell misses it.
          const share = u === target ? 1 - p.chance : 1;
          // A veteran counts a blast the way it counts a shot (see veteranValue).
          const hurt = level === "veteran" ? (worth(u) * (Math.min(1, p.splash / u.hp) + (p.splash >= u.hp ? 2 : 0))) / 2 : p.splash;
          score += (u.seat === view.seat ? -1.5 : 1) * share * hurt;
        }
      }
      if (score <= 0) continue;
      options.push({ unitId: shooter.id, targetId: target.id });
      if (!best || score > best.score) best = { unitId: shooter.id, targetId: target.id, score };
    }
  }
  if (level === "novice" && options.length) {
    // A novice sometimes holds fire for no good reason, and often takes
    // whatever shot it notices first (though never one that only hurts its own side).
    const roll = random();
    if (roll < NOVICE.holdFire) return { type: "endAttacks" };
    if (roll < NOVICE.holdFire + NOVICE.randomShot) {
      const pick = options[Math.floor(random() * options.length)]!;
      return { type: "attack", ...pick };
    }
  }
  return best ? { type: "attack", unitId: best.unitId, targetId: best.targetId } : { type: "endAttacks" };
}

/**
 * What a shot is worth to a veteran: the share of the target's remaining
 * health it expects to take (so the wounded come first), and the chance of
 * finishing it, both in proportion to what the target is worth.
 */
function veteranValue(p: ReturnType<typeof previewShot>, target: Unit): number {
  const [lo, hi] = damageRange(p);
  // The chance a hit kills: a crit's damage, or where the ±variance falls.
  const ordinary = p.fatal || lo >= target.hp ? 1 : hi < target.hp ? 0 : (hi - target.hp + 1) / (hi - lo + 1);
  const crit = p.fatal || Math.round(lo * RULES.critMultiplier) >= target.hp ? 1 : Math.round(hi * RULES.critMultiplier) < target.hp ? 0 : 0.5;
  const kill = p.chance * (RULES.critChance * crit + (1 - RULES.critChance) * ordinary);
  const share = Math.min(1, (p.chance * p.damage) / target.hp);
  return (worth(target) * (share + 2 * kill)) / 2;
}
