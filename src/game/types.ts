// The shared vocabulary of the rules engine. Everything under src/game is pure
// TypeScript with no Node or browser imports, because the same code runs on the
// server (the authority) and in the browser (move previews and hit chances).

export interface Point {
  x: number;
  y: number;
}

/** Ground a tile is made of. What each one does lives in TERRAIN in grid.ts. */
export type Terrain = "grass" | "road" | "floor" | "forest" | "rock" | "water" | "crate";

/** Something standing on a tile edge. `null` in an edge array means open ground. */
export type EdgeKind = "wall" | "window" | "door";

export type Side = "n" | "e" | "s" | "w";

/** A seat at the table: 0..3. Colours and names hang off it in seats.ts. */
export type Seat = number;

export interface IncomeSite extends Point {
  value: number;
}

export interface MapDef {
  id: string;
  name: string;
  blurb: string;
  width: number;
  height: number;
  seats: number;
  /** Row-major, `y * width + x`. */
  terrain: Terrain[];
  /**
   * Horizontal edges: the edge along the TOP of tile (x, y), for y in 0..height
   * (row `height` is the bottom border). Index `y * width + x`.
   */
  hEdges: (EdgeKind | null)[];
  /**
   * Vertical edges: the edge along the LEFT of tile (x, y), for x in 0..width
   * (column `width` is the right border). Index `y * (width + 1) + x`.
   */
  vEdges: (EdgeKind | null)[];
  /**
   * Each seat's base: the tiles it starts owning and deploys onto. Every base
   * tile can be captured, one at a time, like a command post.
   */
  bases: Point[][];
  posts: Point[];
  income: IncomeSite[];
}

export type UnitKind =
  | "rifleman"
  | "scout"
  | "engineer"
  | "heavy"
  | "sniper"
  | "riot"
  | "commando"
  | "shotgun"
  | "healer"
  | "officer";

/** Whole degrees, 0..359: 0 = north, clockwise, so 90 = east, 180 = south, 270 = west. */
export type Facing = number;

export interface Unit {
  id: number;
  seat: Seat;
  kind: UnitKind;
  x: number;
  y: number;
  facing: Facing;
  hp: number;
  /** Took at least one step this round (the sniper's braced-aim rule reads it). */
  moved: boolean;
  /** Was hit this round, so it does not heal at the end of it. */
  damaged: boolean;
  /**
   * Fired in the last attack phase, so it may not move in the planning phase
   * that follows (turning on the spot is fine). Cleared once moves resolve.
   */
  fired: boolean;
}

export interface SeatState {
  seat: Seat;
  gold: number;
  eliminated: boolean;
}

export interface MoveOrder {
  unitId: number;
  /** Tiles to step through, NOT including the unit's starting tile. Empty = turn on the spot. */
  path: Point[];
  facing: Facing;
}

export interface SpawnOrder {
  kind: UnitKind;
  x: number;
  y: number;
  facing: Facing;
}

/**
 * A standing destination beyond this round's move: where the unit is headed
 * over several rounds. The server only keeps it for the player (it never
 * moves a unit by itself); each planning phase the browser plans the next
 * leg as an ordinary MoveOrder.
 */
export interface RouteOrder {
  unitId: number;
  to: Point;
  /**
   * Which way to face on arriving: the facing the player aimed at the
   * destination. The legs before it face the way the unit walks. Missing:
   * the way it walks in, too.
   */
  facing?: Facing;
}

export interface Orders {
  moves: MoveOrder[];
  spawns: SpawnOrder[];
  /** Units heading further than one round's move. Missing in older logs: none. */
  routes?: RouteOrder[];
}

export type Phase = "planning" | "attack" | "over";

export interface GameState {
  mapId: string;
  seatCount: number;
  round: number;
  phase: Phase;
  seats: SeatState[];
  units: Unit[];
  nextUnitId: number;
  /** Owner of each command post, by index into map.posts. */
  postOwners: (Seat | null)[];
  /** Owner of each income site, by index into map.income. */
  incomeOwners: (Seat | null)[];
  /**
   * Owner of each base tile, by index into baseTiles(map, seatCount): the
   * playing seats' bases, flattened in seat order. Starts as the home seat.
   */
  baseOwners: (Seat | null)[];
  /**
   * A base tile part way through a step of capture, by the same index: which
   * side has held it and for how many rounds so far. A step takes
   * baseCaptureRounds rounds (an engineer's, engineerBaseCaptureRounds).
   */
  baseCapture: ({ seat: Seat; rounds: number } | null)[];
  /**
   * The same for command posts, by index into map.posts (rules revision 2:
   * a post takes as long as a base tile). Missing in states from before it.
   */
  postCapture?: ({ seat: Seat; rounds: number } | null)[];
  /** Planning phase: each seat's submitted orders, or null while still planning. */
  orders: (Orders | null)[];
  /**
   * Each seat's standing destinations, from its last accepted orders. Kept
   * from round to round (orders are not), so the next leg can be planned
   * after a reload or on another device. Private to the seat, like orders.
   */
  routes: RouteOrder[][];
  /** Attack phase: whose activation it is, and which units have used theirs. */
  attackTurn: Seat | null;
  actedUnitIds: number[];
  /**
   * A unit with more than one shot (the commando) part way through them: its
   * side keeps the turn, and only it may act, until it has fired them all or
   * holds. null otherwise.
   */
  burst: { unitId: number; fired: number } | null;
  /** Set when phase is "over". null with phase "over" is a draw. */
  winner: Seat | null;
}

export type Action =
  | { type: "orders"; seat: Seat; orders: Orders }
  | { type: "attack"; seat: Seat; unitId: number; targetId: number }
  | { type: "hold"; seat: Seat; unitId: number }
  | { type: "endAttacks"; seat: Seat }
  | { type: "resign"; seat: Seat };

/** What happened as a result of an action, for animation and the battle log. */
export type GameEvent =
  | { type: "spawn"; unit: Unit }
  | { type: "spawnFailed"; seat: Seat; kind: UnitKind; x: number; y: number; refund: number }
  | { type: "move"; unitId: number; seat: Seat; from: Point; steps: Point[]; bumped: boolean }
  | {
      type: "shot";
      shooterId: number;
      targetId: number;
      shooterSeat: Seat;
      targetSeat: Seat;
      from: Point;
      to: Point;
      chance: number;
      hit: boolean;
      crit: boolean;
      damage: number;
      killed: boolean;
      /** Explosives: the units caught by the blast (the target too, on a miss). */
      splash: { unitId: number; seat: Seat; at: Point; damage: number; killed: boolean }[];
      /**
       * Set when an enemy the shooter couldn't see stood on the line and took
       * the shot: the unit it was aimed at. `targetId` is the one it struck.
       */
      intendedId?: number;
    }
  | { type: "hold"; unitId: number; seat: Seat }
  | { type: "capture"; site: "post" | "income" | "base"; index: number; from: Seat | null; to: Seat | null }
  | { type: "captureProgress"; site: "base" | "post"; index: number; seat: Seat; rounds: number; needed: number }
  | { type: "income"; seat: Seat; amount: number; upkeep?: number }
  | { type: "eliminated"; seat: Seat }
  | { type: "round"; round: number }
  | { type: "phase"; phase: Phase }
  | { type: "gameOver"; winner: Seat | null };

/** A rule was broken. `code` is stable and shown to the player via ERROR_TEXT. */
export class RuleError extends Error {
  constructor(public readonly code: RuleErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

export type RuleErrorCode =
  | "wrong_phase"
  | "not_your_turn"
  | "eliminated"
  | "no_such_unit"
  | "not_your_unit"
  | "bad_path"
  | "path_too_long"
  | "duplicate_order"
  | "duplicate_destination"
  | "bad_spawn_tile"
  | "spawn_tile_occupied"
  | "spawn_contested"
  | "not_enough_gold"
  | "already_acted"
  | "cannot_shoot"
  | "fired_cannot_move"
  | "finish_burst"
  | "game_over";

export const ERROR_TEXT: Record<RuleErrorCode, string> = {
  wrong_phase: "That can't be done in this phase.",
  not_your_turn: "It's another player's turn.",
  eliminated: "You've been knocked out of this game.",
  no_such_unit: "That unit doesn't exist any more.",
  not_your_unit: "That unit isn't yours.",
  bad_path: "That route isn't possible.",
  path_too_long: "That route is further than the unit can move.",
  duplicate_order: "A unit was given two orders.",
  duplicate_destination: "Two of your units are heading for the same tile.",
  bad_spawn_tile: "Units can only be deployed on base tiles or command posts you hold.",
  spawn_tile_occupied: "Something is already standing there.",
  spawn_contested: "An enemy is right beside that base tile: you can't deploy there while it stays.",
  not_enough_gold: "You can't afford that.",
  already_acted: "That unit has already acted this round.",
  cannot_shoot: "That unit can't hit that target from here.",
  finish_burst: "Your unit still has a shot to take: fire it or hold.",
  fired_cannot_move: "A unit that fired last round can't move this round (it can still turn).",
  game_over: "The game is over.",
};
