// Games as stored records: creating and joining them, and applying actions.
//
// The action log in game_actions is the truth. A game's state is rebuilt by
// replaying the log from newGame(); the in-memory cache only saves doing that
// on every request, and is rebuilt from the database after a restart.
import crypto from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, sqlite } from "./db/index.js";
import { gameActions, gamePlayers, games, users, type Game } from "./db/schema.js";
import { getMap, registerMap } from "./game/maps.js";
import { streamFor } from "./game/rng.js";
import { applyAction, newGame } from "./game/rules.js";
import { chooseAction } from "./game/bot.js";
import { FILE_TUNING, TUNING_VERSION, upgradeSnapshot, withTuning, type Tuning } from "./game/tuning.js";
import { viewFor } from "./game/view.js";
import { RuleError, type Action, type GameEvent, type GameState, type MapDef, type Seat, type UnitKind } from "./game/types.js";

export interface PlayerInfo {
  seat: Seat;
  userId: number;
  name: string;
  isBot: boolean;
}

export interface LiveGame {
  game: Game;
  /** The map this game is played on: its own snapshot, under the key `game:<id>`. */
  map: MapDef;
  /** The unit stats and rule numbers this game is played under: its own snapshot. */
  tuning: Tuning;
  players: PlayerInfo[];
  /** null until every seat is filled and the game starts. */
  state: GameState | null;
  /** Number of actions in the log. The next action's seq. */
  actionCount: number;
}

export type GameListener = (live: LiveGame, events: GameEvent[]) => void;

const cache = new Map<string, LiveGame>();
const listeners = new Map<string, Set<GameListener>>();

/** Game ids are short so they can be read out loud: 6 characters, no lookalikes. */
const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function newGameId(): string {
  const bytes = crypto.randomBytes(6);
  return [...bytes].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}

function loadPlayers(gameId: string): PlayerInfo[] {
  return db
    .select({ seat: gamePlayers.seat, userId: gamePlayers.userId, name: users.displayName, isBot: users.isBot, isGuest: users.isGuest })
    .from(gamePlayers)
    .innerJoin(users, eq(users.id, gamePlayers.userId))
    .where(eq(gamePlayers.gameId, gameId))
    .orderBy(asc(gamePlayers.seat))
    .all()
    // Guests are marked wherever names show: the scoreboard, the waiting room.
    .map(({ isGuest, ...p }) => ({ ...p, name: isGuest ? `${p.name} (guest)` : p.name }));
}

/**
 * The map a game is played on, registered with the rules under the game's own
 * key so getMap() finds it. Each game carries a snapshot taken when it was
 * created, so editing or deleting the original map never changes it. Games
 * from before snapshots fall back to the built-in map they name.
 */
export function mapFor(game: Pick<Game, "id" | "mapId" | "mapData">): MapDef {
  if (!game.mapData) return getMap(game.mapId);
  const map: MapDef = { ...(JSON.parse(game.mapData) as MapDef), id: `game:${game.id}` };
  registerMap(map);
  return map;
}

/**
 * The tuning a game is played under: the snapshot taken when it was created.
 * Games from before snapshots use the files as they are now.
 */
export function tuningFor(game: Pick<Game, "rulesData">): Tuning {
  return game.rulesData ? upgradeSnapshot(JSON.parse(game.rulesData) as Tuning & { version?: number }) : FILE_TUNING;
}

/** Was this game created before tuning version 2 (eighth-turn facings, the breacher)? */
const isLegacy = (game: Pick<Game, "rulesData">) =>
  !game.rulesData || (JSON.parse(game.rulesData) as { version?: number }).version !== TUNING_VERSION;

/** An action from an older game, in today's terms: facings in degrees, the breacher as the shotgun. */
function upgradeAction(action: Action): Action {
  if (action.type !== "orders") return action;
  const kind = (k: string) => (k === "breacher" ? "shotgun" : k) as UnitKind;
  return {
    ...action,
    orders: {
      moves: action.orders.moves.map((m) => ({ ...m, facing: m.facing * 45 })),
      spawns: action.orders.spawns.map((s) => ({ ...s, kind: kind(s.kind), facing: s.facing * 45 })),
    },
  };
}

/** Run rules code for this game under its own tuning. Every call into src/game for a game goes through here. */
export const inGame = <T>(live: Pick<LiveGame, "tuning">, fn: () => T): T => withTuning(live.tuning, fn);

/**
 * Replay a game's whole log. A game stored under older *rules code* can hit
 * an action the current rules refuse; the replay stops there rather than
 * leave the game unopenable.
 */
function replay(game: Game, map: MapDef): { state: GameState; actionCount: number } {
  const rows = db.select().from(gameActions).where(eq(gameActions.gameId, game.id)).orderBy(asc(gameActions.seq)).all();
  let state = newGame(map.id, game.seatCount);
  const legacy = isLegacy(game);
  for (const row of rows) {
    if (state.phase === "over") break;
    try {
      const action = JSON.parse(row.payload) as Action;
      state = applyAction(state, legacy ? upgradeAction(action) : action, streamFor(game.seed, row.seq)).state;
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      console.warn(`game ${game.id}: replay stopped at action ${row.seq} (${e.message}); it was played under older rules`);
      break;
    }
  }
  return { state, actionCount: rows.length };
}

export function loadGame(id: string): LiveGame | null {
  const cached = cache.get(id);
  if (cached) return cached;
  const game = db.select().from(games).where(eq(games.id, id)).get();
  if (!game) return null;
  const players = loadPlayers(id);
  const map = mapFor(game);
  const tuning = tuningFor(game);
  const { state, actionCount } = game.startedAt ? withTuning(tuning, () => replay(game, map)) : { state: null, actionCount: 0 };
  const live: LiveGame = { game, map, tuning, players, state, actionCount };
  cache.set(id, live);
  return live;
}

/** The summary columns, derived from the state. Never edited any other way. */
function summaryOf(state: GameState | null) {
  if (!state) return { status: "open" as const, round: 1, phase: "planning", winnerSeat: null };
  return {
    status: state.phase === "over" ? ("over" as const) : ("active" as const),
    round: state.round,
    phase: state.phase,
    winnerSeat: state.winner,
  };
}

function refresh(id: string, events: GameEvent[] = []) {
  cache.delete(id);
  const live = loadGame(id);
  if (live) for (const l of listeners.get(id) ?? []) l(live, events);
  return live;
}

/** Computer opponents' accounts. Created on first use; they can never sign in. */
const BOT_NAMES = ["Sgt. Byte", "Cpl. Cog", "Pvt. Pixel"];

function botUserIds(count: number): number[] {
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const email = `bot-${i + 1}@bots.salient`;
    const existing = db.select().from(users).where(eq(users.email, email)).get();
    const user =
      existing ??
      db
        .insert(users)
        // "!" is not an argon2 hash, so no password can ever match it.
        .values({ email, displayName: BOT_NAMES[i]!, passwordHash: "!", isBot: true, createdAt: Date.now() })
        .returning()
        .get();
    ids.push(user.id);
  }
  return ids;
}

/**
 * Create a game with the creator in seat 0, on a snapshot of `map`. With
 * `bots`, every other seat is filled with a computer opponent and the game
 * starts at once. The caller checks the map is playable (checkMap).
 */
export function createGame(userId: number, map: MapDef, seatCount: number, bots = false): string {
  if (seatCount < 2 || seatCount > map.seats) throw new Error("bad seat count");
  const id = newGameId();
  const now = Date.now();
  const botIds = bots ? botUserIds(seatCount - 1) : [];
  const mapData = JSON.stringify(map);
  const snapshot = mapFor({ id, mapId: map.id, mapData });
  const rulesData = JSON.stringify({ version: TUNING_VERSION, ...FILE_TUNING });
  sqlite.transaction(() => {
    db.insert(games)
      .values({
        id,
        mapId: map.id,
        mapData,
        rulesData,
        seatCount,
        seed: crypto.randomBytes(16).toString("hex"),
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
        ...(bots ? { startedAt: now, ...summaryOf(withTuning(FILE_TUNING, () => newGame(snapshot.id, seatCount))) } : {}),
      })
      .run();
    db.insert(gamePlayers).values({ gameId: id, seat: 0, userId, joinedAt: now }).run();
    botIds.forEach((botId, i) => db.insert(gamePlayers).values({ gameId: id, seat: i + 1, userId: botId, joinedAt: now }).run());
  })();
  if (bots) driveBots(id);
  return id;
}

export type JoinResult = "joined" | "already_in" | "full" | "not_found";

/** Take the lowest free seat. The game starts by itself when the last seat fills. */
export function joinGame(id: string, userId: number): JoinResult {
  const result = sqlite.transaction((): JoinResult => {
    const game = db.select().from(games).where(eq(games.id, id)).get();
    if (!game) return "not_found";
    const taken = db.select().from(gamePlayers).where(eq(gamePlayers.gameId, id)).all();
    if (taken.some((p) => p.userId === userId)) return "already_in";
    if (game.startedAt || taken.length >= game.seatCount) return "full";
    let seat = 0;
    while (taken.some((p) => p.seat === seat)) seat++;
    const now = Date.now();
    db.insert(gamePlayers).values({ gameId: id, seat, userId, joinedAt: now }).run();
    if (taken.length + 1 === game.seatCount) {
      const start = withTuning(tuningFor(game), () => newGame(mapFor(game).id, game.seatCount));
      db.update(games).set({ startedAt: now, updatedAt: now, ...summaryOf(start) }).where(eq(games.id, id)).run();
    }
    return "joined";
  })();
  if (result === "joined") {
    refresh(id);
    driveBots(id);
  }
  return result;
}

/** Leave a game that has not started. The creator leaving closes it. */
export function leaveGame(id: string, userId: number): boolean {
  const game = db.select().from(games).where(eq(games.id, id)).get();
  if (!game || game.startedAt) return false;
  if (game.createdBy === userId) {
    db.delete(games).where(eq(games.id, id)).run();
    cache.delete(id);
    for (const l of listeners.get(id) ?? []) l({ game, map: mapFor(game), tuning: tuningFor(game), players: [], state: null, actionCount: 0 }, []);
    return true;
  }
  db.delete(gamePlayers).where(and(eq(gamePlayers.gameId, id), eq(gamePlayers.userId, userId))).run();
  refresh(id);
  return true;
}

/** An action as the client sends it: everything but the seat, which the server fills in. */
export type ClientAction = Action extends infer A ? (A extends Action ? Omit<A, "seat"> : never) : never;

/**
 * Apply an action for a player. The seat comes from the session, never from
 * the client. Throws RuleError when the rules refuse it; nothing is stored.
 */
export function act(id: string, userId: number, clientAction: ClientAction): void {
  const live = loadGame(id);
  if (!live?.state) throw new Error("game not started");
  const player = live.players.find((p) => p.userId === userId);
  if (!player) throw new Error("not a player in this game");
  const action = { ...clientAction, seat: player.seat } as Action;
  const seq = live.actionCount;
  const current = live.state;
  const { state, events } = inGame(live, () => applyAction(current, action, streamFor(live.game.seed, seq)));
  const now = Date.now();
  sqlite.transaction(() => {
    db.insert(gameActions)
      .values({ gameId: id, seq, seat: player.seat, userId, payload: JSON.stringify(action), createdAt: now })
      .run();
    db.update(games).set({ ...summaryOf(state), updatedAt: now }).where(eq(games.id, id)).run();
  })();
  // Keep the cache in step without a full replay; it is the same computation
  // the replay would do, and a restart rebuilds it from the log anyway.
  live.state = state;
  live.actionCount = seq + 1;
  live.game = db.select().from(games).where(eq(games.id, id)).get()!;
  for (const l of listeners.get(id) ?? []) l(live, events);
  driveBots(id);
}

// --- Computer opponents ---------------------------------------------------------

const botTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Pauses before a bot acts, so its moves arrive at a human pace and its shots don't overlap the last animation. */
const BOT_DELAY = { planning: 600, attack: 1300 };

/**
 * If a bot owes this game an action, schedule it. The choice is made when the
 * timer fires, from the state as it is then, and from that bot's own view of
 * the game: it sees exactly what a human in its seat would.
 */
export function driveBots(id: string) {
  if (botTimers.has(id)) return;
  const live = loadGame(id);
  const state = live?.state;
  if (!live || !state || state.phase === "over") return;
  const due = inGame(live, () => live.players.find((p) => p.isBot && chooseAction(viewFor(state, p.seat)) !== null));
  if (!due) return;
  const timer = setTimeout(() => {
    botTimers.delete(id);
    const now = loadGame(id);
    const current = now?.state;
    if (!now || !current) return;
    const choice = inGame(now, () => chooseAction(viewFor(current, due.seat)));
    if (!choice) return driveBots(id);
    try {
      act(id, due.userId, choice);
    } catch (e) {
      // A refused bot action is a bot bug. Fall back to the always-legal
      // move rather than leave the humans waiting for ever.
      console.error(`bot ${due.name} in ${id}: ${choice.type} refused`, e);
      act(id, due.userId, current.phase === "planning" ? { type: "orders", orders: { moves: [], spawns: [] } } : { type: "endAttacks" });
    }
  }, BOT_DELAY[state.phase === "attack" ? "attack" : "planning"]);
  botTimers.set(id, timer);
}

/** At startup, pick up any game left waiting on a bot when the server stopped. */
export function resumeBots() {
  const active = db.select({ id: games.id }).from(games).where(eq(games.status, "active")).all();
  for (const g of active) driveBots(g.id);
}

export function subscribe(id: string, listener: GameListener): () => void {
  let set = listeners.get(id);
  if (!set) listeners.set(id, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(id);
  };
}

export interface GameSummary {
  game: Game;
  map: MapDef;
  players: PlayerInfo[];
  mySeat: Seat | null;
  /** Is the game waiting on this user right now? */
  yourMove: boolean;
}

/** Games this user is in, most recently active first. */
export function gamesFor(userId: number): GameSummary[] {
  const mine = db
    .select({ gameId: gamePlayers.gameId })
    .from(gamePlayers)
    .where(eq(gamePlayers.userId, userId))
    .all()
    .map((r) => r.gameId);
  if (mine.length === 0) return [];
  const rows = db.select().from(games).where(inArray(games.id, mine)).orderBy(desc(games.updatedAt)).all();
  return rows.map((game) => summarise(game, userId));
}

/** Open games with a free seat that this user is not already in. */
export function openGames(userId: number): GameSummary[] {
  const rows = db.select().from(games).where(eq(games.status, "open")).orderBy(desc(games.createdAt)).limit(20).all();
  return rows.map((g) => summarise(g, userId)).filter((s) => s.mySeat === null && s.players.length < s.game.seatCount);
}

function summarise(game: Game, userId: number): GameSummary {
  const live = loadGame(game.id);
  const map = live?.map ?? mapFor(game);
  const players = live?.players ?? [];
  const mySeat = players.find((p) => p.userId === userId)?.seat ?? null;
  const s = live?.state;
  let yourMove = false;
  if (s && mySeat !== null && !s.seats[mySeat]?.eliminated) {
    if (s.phase === "planning") yourMove = s.orders[mySeat] === null;
    if (s.phase === "attack") yourMove = s.attackTurn === mySeat;
  }
  return { game: live?.game ?? game, map, players, mySeat, yourMove };
}

/** Forget cached games: tests and repair scripts that write to the database directly. */
export function clearCache() {
  cache.clear();
}
