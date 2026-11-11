// What one seat is allowed to know. The server sends each player only this,
// never the full state, so fog of war cannot be defeated by reading the
// network traffic. (The old prototype sent every unit to every client.)
import { readyShooters } from "./rules.js";
import { baseTilesOwned, unitVisibleTo, visibleTiles } from "./visibility.js";
import { getMap } from "./maps.js";
import type { GameEvent, GameState, Orders, Phase, RouteOrder, Seat, Unit } from "./types.js";

export interface SeatPublic {
  seat: Seat;
  /** Base tiles this seat owns, of any base. */
  baseTiles: number;
  /**
   * Units it has on the field (a count only, never where), and its gold: the
   * viewer's own, or everyone's once the game is over or in a replay. Null
   * for another seat during play: a count would give away what the fog hides.
   */
  units: number | null;
  gold: number | null;
  eliminated: boolean;
  /** Planning phase: has this seat locked in its orders? */
  ready: boolean;
}

export interface PlayerView {
  mapId: string;
  /** The viewer's seat, or null for a spectator of a finished game. */
  seat: Seat | null;
  round: number;
  phase: Phase;
  seats: SeatPublic[];
  gold: number;
  /** Own units, and the enemies this seat can see. */
  units: Unit[];
  /** Visible tile indexes. Everything else is drawn under fog. */
  visible: number[];
  postOwners: (Seat | null)[];
  incomeOwners: (Seat | null)[];
  /** Owner of every base tile, by index into baseTiles(map, seats.length). Public, like posts. */
  baseOwners: (Seat | null)[];
  /** Base tiles part way through a capture step, by the same index. Public: you can see who stands on your base. */
  baseCapture: ({ seat: Seat; rounds: number } | null)[];
  /** The viewer's own submitted orders this round, if any. */
  myOrders: Orders | null;
  /**
   * The viewer's own standing destinations (units headed further than one
   * round's move), from its last accepted orders. Never anyone else's.
   */
  myRoutes: RouteOrder[];
  attackTurn: Seat | null;
  /** Own units that have already acted this attack phase. */
  acted: number[];
  /** Own units that can still shoot something, when it is the viewer's attack turn. */
  readyShooters: number[];
  /** The viewer's own unit part way through its shots (a commando's second), if any. */
  burst: { unitId: number; fired: number } | null;
  winner: Seat | null;
}

export function viewFor(state: GameState, seat: Seat | null): PlayerView {
  const map = getMap(state.mapId);
  const over = state.phase === "over";
  // Once the game is over the fog lifts for everyone.
  const allTiles = () => new Set(map.terrain.map((_, i) => i));
  const tiles = seat === null || over ? allTiles() : visibleTiles(map, state, seat);
  const units =
    seat === null || over ? state.units : state.units.filter((u) => unitVisibleTo(map, state, seat, u, tiles));

  return {
    mapId: state.mapId,
    seat,
    round: state.round,
    phase: state.phase,
    seats: state.seats.map((s) => ({
      seat: s.seat,
      baseTiles: baseTilesOwned(state, s.seat),
      units: seat === null || over || s.seat === seat ? state.units.filter((u) => u.seat === s.seat).length : null,
      gold: seat === null || over || s.seat === seat ? s.gold : null,
      eliminated: s.eliminated,
      ready: state.phase === "planning" && state.orders[s.seat] !== null,
    })),
    gold: seat === null ? 0 : (state.seats[seat]?.gold ?? 0),
    units: structuredClone(units),
    visible: [...tiles].sort((a, b) => a - b),
    postOwners: [...state.postOwners],
    incomeOwners: [...state.incomeOwners],
    baseOwners: [...state.baseOwners],
    baseCapture: structuredClone(state.baseCapture),
    myOrders: seat === null ? null : structuredClone(state.orders[seat] ?? null),
    myRoutes:
      seat === null || over
        ? []
        : (state.routes?.[seat] ?? []).filter((r) => state.units.some((u) => u.id === r.unitId && u.seat === seat)).map((r) => structuredClone(r)),
    attackTurn: state.attackTurn,
    acted: state.actedUnitIds.filter((id) => units.some((u) => u.id === id && u.seat === seat)),
    readyShooters:
      seat !== null && state.attackTurn === seat ? readyShooters(map, state, seat).map((u) => u.id) : [],
    burst: state.burst && units.some((u) => u.id === state.burst!.unitId && u.seat === seat) ? { ...state.burst } : null,
    winner: state.winner,
  };
}

/**
 * The events a seat gets to see. It sees everything that happens to its own
 * units, shots where it can see either end (before or after), and all the
 * public bookkeeping: captures, income, knockouts, rounds. Enemy movement it
 * learns by the units appearing where they now are.
 */
export function eventsFor(
  events: readonly GameEvent[],
  seat: Seat | null,
  before: PlayerView | null,
  after: PlayerView,
): GameEvent[] {
  if (seat === null) return [...events];
  const known = new Set<number>([...(before?.units ?? []), ...after.units].map((u) => u.id));
  return events.filter((e) => {
    switch (e.type) {
      case "spawn":
        return e.unit.seat === seat || known.has(e.unit.id);
      case "spawnFailed":
      case "income":
        return e.seat === seat;
      case "move":
        return e.seat === seat;
      case "hold":
        return e.seat === seat;
      case "shot":
        return (
          e.shooterSeat === seat ||
          e.targetSeat === seat ||
          known.has(e.shooterId) ||
          known.has(e.targetId) ||
          (e.intendedId !== undefined && known.has(e.intendedId)) ||
          e.splash.some((x) => x.seat === seat || known.has(x.unitId))
        );
      default:
        return true;
    }
  });
}

/**
 * A GameState built from one seat's view: its own units and the enemies it
 * can see, its gold, and the public bookkeeping. The rule helpers that answer
 * "what can I do" only need that much, so the browser and the bots can call
 * them without ever being given what the fog hides.
 */
export function stateFromView(v: PlayerView): GameState {
  return {
    mapId: v.mapId,
    seatCount: v.seats.length,
    round: v.round,
    phase: v.phase,
    seats: v.seats.map((p) => ({ seat: p.seat, gold: p.seat === v.seat ? v.gold : 0, eliminated: p.eliminated })),
    units: v.units,
    nextUnitId: 0,
    postOwners: v.postOwners,
    incomeOwners: v.incomeOwners,
    baseOwners: v.baseOwners,
    baseCapture: v.baseCapture,
    orders: v.seats.map(() => null),
    routes: v.seats.map((p) => (p.seat === v.seat ? (v.myRoutes ?? []) : [])),
    attackTurn: v.attackTurn,
    actedUnitIds: v.acted,
    burst: v.burst,
    winner: v.winner,
  };
}
