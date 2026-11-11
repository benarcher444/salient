// The browser's picture of the game: the last view from the server, plus the
// orders being drafted and what is selected. Derived questions (where can this
// unit go, what can it shoot) are answered with the same rule functions the
// server uses, run on the slice of the game this player can see.
import { facingToward, samePoint } from "../game/grid.js";
import type { Tuning } from "../game/tuning.js";
import { moveBudget, pathTo, reachable, type Reach } from "../game/movement.js";
import { targetsFor, validateOrders } from "../game/rules.js";
import { UNITS } from "../game/units.js";
import { spawnTiles, visibleTiles } from "../game/visibility.js";
import { RuleError, ERROR_TEXT, type Facing, type GameState, type MapDef, type MoveOrder, type Orders, type Point, type RouteOrder, type Seat, type Unit } from "../game/types.js";
import { stateFromView, type PlayerView } from "../game/view.js";

export interface Boot {
  gameId: string;
  mapId: string;
  map: MapDef;
  /** The game's own unit stats and rule numbers. */
  tuning: Tuning;
  seat: Seat | null;
  players: { seat: Seat; name: string }[];
}

export type Selection =
  | { type: "unit"; id: number }
  | { type: "spawnTile"; x: number; y: number }
  | { type: "spawn"; index: number }
  | { type: "target"; shooterId: number; targetId: number };

export interface LogLine {
  round: number;
  html: string;
}

export interface ClientState {
  boot: Boot;
  map: MapDef;
  view: PlayerView | null;
  players: { seat: Seat; name: string }[];
  connected: boolean;
  /** Orders being drafted this planning phase. */
  draft: Orders;
  /** False once orders are locked in, until "Change orders". */
  editing: boolean;
  selected: Selection | null;
  hover: Point | null;
  log: LogLine[];
  /** Waiting for the server to answer an action, so buttons don't double-fire. */
  pending: boolean;
  /**
   * Aiming the selected unit or deployment: it turns to follow the pointer
   * until a tap sets it. `before` is the facing to go back to on cancel.
   */
  aiming: {
    before: Facing;
    selection: string;
    /**
     * Started by clicking the unit itself: it turns on the spot, and a right
     * click cancels any move or route it had. The orders it had, to put back
     * if the aim is cancelled (a left click elsewhere, Esc).
     */
    spot?: { move: MoveOrder | null; route: RouteOrder | null };
  } | null;
  /**
   * Watching a finished game again, fog lifted: which step is showing, of
   * how many, whether it plays on by itself and how fast. null otherwise.
   * While set, `view` is the replay's, and nothing is sent to the server.
   */
  replay: { index: number; total: number; playing: boolean; speed: number; loading?: boolean } | null;
}

export const emptyOrders = (): Orders => ({ moves: [], spawns: [], routes: [] });

/** The slice of the game this player can see, shaped for the rule helpers. */
export const partialState = (s: ClientState): GameState => stateFromView(s.view!);

export const mySeat = (s: ClientState) => s.view?.seat ?? null;
export const unitById = (s: ClientState, id: number) => s.view?.units.find((u) => u.id === id);
export const unitAt = (s: ClientState, p: Point) => s.view?.units.find((u) => u.x === p.x && u.y === p.y);
export const isMine = (s: ClientState, u: Unit) => u.seat === mySeat(s);

export function canPlan(s: ClientState): boolean {
  const v = s.view;
  return !!v && v.seat !== null && v.phase === "planning" && s.editing && !v.seats[v.seat]?.eliminated;
}

export function isMyAttackTurn(s: ClientState): boolean {
  const v = s.view;
  return !!v && v.seat !== null && v.phase === "attack" && v.attackTurn === v.seat;
}

/** Tiles of enemies this player can see: a route may end on one, never pass it. */
const enemyTiles = (s: ClientState, unit: Unit) =>
  new Set(s.view!.units.filter((u) => u.seat !== unit.seat).map((u) => u.y * s.map.width + u.x));

const reachCache = new WeakMap<Unit, Reach>();
/** Where a unit can go, avoiding enemies this player can see. */
export function reachOf(s: ClientState, unit: Unit): Reach {
  let r = reachCache.get(unit);
  if (!r && unit.fired) {
    // Fired last round: it may turn, not move. Only its own tile.
    r = { cost: new Map([[unit.y * s.map.width + unit.x, 0]]), from: new Map() };
    reachCache.set(unit, r);
  }
  if (!r) {
    r = reachable(s.map, unit, enemyTiles(s, unit));
    reachCache.set(unit, r);
  }
  return r;
}

// --- Routes over several rounds ---------------------------------------------
// A tile beyond this round's reach becomes a standing destination: the
// whole route is planned with no budget, this round's move is the part of it
// the unit can walk now, and the rest waits for the next planning phases.

const fullReachCache = new WeakMap<Unit, Reach>();
/** Everywhere a unit could get to over any number of rounds, avoiding enemies this player can see. */
export function fullReachOf(s: ClientState, unit: Unit): Reach {
  let r = fullReachCache.get(unit);
  if (!r) {
    r = reachable(s.map, unit, enemyTiles(s, unit), Infinity);
    fullReachCache.set(unit, r);
  }
  return r;
}

/**
 * The way on along a route, walls only: where the unit would go if nothing
 * were in the way. A route carries on along this, never round an enemy.
 */
export function wayOn(s: ClientState, unit: Unit, to: Point): Point[] | null {
  return pathTo(s.map, reachable(s.map, unit, new Set(), Infinity), to);
}

/** The whole way to a tile from where the unit stands now, or null if there is none. */
export function fullPathTo(s: ClientState, unit: Unit, to: Point): Point[] | null {
  return pathTo(s.map, fullReachOf(s, unit), to);
}

export function routeFor(s: ClientState, unitId: number): RouteOrder | undefined {
  return s.draft.routes?.find((r) => r.unitId === unitId);
}

/** How far along `path` (a fullPathTo) the unit gets each round: the index after each leg's last tile. */
export function legBreaks(s: ClientState, unit: Unit, path: readonly Point[], firstLeg: number): number[] {
  const reach = fullReachOf(s, unit);
  const budget = moveBudget(unit);
  const cost = (i: number) => (i < 0 ? 0 : (reach.cost.get(path[i]!.y * s.map.width + path[i]!.x) ?? 0));
  const breaks = [firstLeg];
  let at = firstLeg;
  while (at < path.length) {
    const base = cost(at - 1);
    let next = at;
    while (next < path.length && cost(next) - base <= budget) next++;
    at = Math.max(next, at + 1);
    breaks.push(at);
  }
  return breaks;
}

/**
 * This round's leg of a route: the longest start of the path the unit can
 * walk this round (none, if it fired last round and may only turn).
 */
export function firstLeg(s: ClientState, unit: Unit, path: readonly Point[]): Point[] {
  if (unit.fired) return [];
  return path.slice(0, legBreaks(s, unit, path, 0)[1] ?? 0);
}

/**
 * A drafted route as the board and panel show it: the whole path, how much
 * of it this round's move covers, and where each later round's leg ends.
 * `rounds` counts this one. null when the destination can't be reached now.
 */
export function routePlan(s: ClientState, unit: Unit, route: RouteOrder, orders: Orders = s.draft) {
  const path = fullPathTo(s, unit, route.to);
  if (!path || !path.length) return null;
  const move = orders.moves.find((m) => m.unitId === unit.id)?.path ?? [];
  let done = 0;
  while (done < move.length && done < path.length && samePoint(move[done]!, path[done]!)) done++;
  const breaks = legBreaks(s, unit, path, done);
  return { path, done, ends: breaks.slice(1).map((b) => b - 1), rounds: breaks.length };
}

export function moveOrderFor(s: ClientState, unitId: number) {
  return s.draft.moves.find((m) => m.unitId === unitId);
}

/** Where a unit will finish if its draft order plays out unopposed. */
export function plannedEnd(s: ClientState, u: Unit): Point {
  const m = moveOrderFor(s, u.id);
  return m && m.path.length > 0 ? m.path[m.path.length - 1]! : u;
}

export const goldLeft = (s: ClientState) =>
  (s.view?.gold ?? 0) - s.draft.spawns.reduce((sum, sp) => sum + UNITS[sp.kind].cost, 0);

export function mySpawnTiles(s: ClientState): Point[] {
  const seat = mySeat(s);
  if (seat === null || !s.view) return [];
  return spawnTiles(s.map, { postOwners: s.view.postOwners, baseOwners: s.view.baseOwners, seatCount: s.view.seats.length }, seat);
}

/** A spawn's default facing: towards the middle of the map, where the fight is. */
export function defaultFacing(map: MapDef, p: Point): Facing {
  return facingToward(p, { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) });
}

/** Check the draft with the server's own validation, so the error shows before sending. */
export function draftProblem(s: ClientState): string | null {
  const seat = mySeat(s);
  if (seat === null || !s.view) return null;
  try {
    validateOrders(s.map, partialState(s), seat, s.draft);
    return null;
  } catch (e) {
    return e instanceof RuleError ? ERROR_TEXT[e.code] : String(e);
  }
}

let visibleCache: { view: PlayerView | null; tiles: Set<number> } = { view: null, tiles: new Set() };
function myVisible(s: ClientState): Set<number> {
  if (visibleCache.view !== s.view) {
    visibleCache = { view: s.view, tiles: visibleTiles(s.map, partialState(s), mySeat(s) ?? 0) };
  }
  return visibleCache.tiles;
}

/** Enemies this unit could shoot now: the server's own rule, on what we can see. */
export function targetsOf(s: ClientState, unit: Unit): Unit[] {
  if (!s.view) return [];
  return targetsFor(s.map, partialState(s), unit, myVisible(s));
}

/** Down to its last base tile: one more loss and only its units keep it in the game. */
export const baseWarning = (baseTiles: number) => baseTiles <= 1;
