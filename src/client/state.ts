// The browser's picture of the game: the last view from the server, plus the
// orders being drafted and what is selected. Derived questions (where can this
// unit go, what can it shoot) are answered with the same rule functions the
// server uses, run on the slice of the game this player can see.
import { RULES } from "../game/constants.js";
import { facingToward } from "../game/grid.js";
import { reachable, type Reach } from "../game/movement.js";
import { targetsFor, validateOrders } from "../game/rules.js";
import { UNITS } from "../game/units.js";
import { spawnTiles, visibleTiles } from "../game/visibility.js";
import { RuleError, ERROR_TEXT, type Facing, type GameState, type MapDef, type Orders, type Point, type Seat, type Unit } from "../game/types.js";
import { stateFromView, type PlayerView } from "../game/view.js";

export interface Boot {
  gameId: string;
  mapId: string;
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
}

export const emptyOrders = (): Orders => ({ moves: [], spawns: [] });

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

const reachCache = new WeakMap<Unit, Reach>();
/** Where a unit can go, avoiding enemies this player can see. */
export function reachOf(s: ClientState, unit: Unit): Reach {
  let r = reachCache.get(unit);
  if (!r) {
    const blocked = new Set(s.view!.units.filter((u) => u.seat !== unit.seat).map((u) => u.y * s.map.width + u.x));
    r = reachable(s.map, unit, blocked);
    reachCache.set(unit, r);
  }
  return r;
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
  return spawnTiles(s.map, { postOwners: s.view.postOwners }, seat);
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

export const ticketsWarning = (tickets: number) => tickets <= RULES.startTickets / 4;
