// Games as stored records: creating and joining them, and applying actions.
//
// The action log in game_actions is the truth. A game's state is rebuilt by
// replaying the log from newGame(); the in-memory cache only saves doing that
// on every request, and is rebuilt from the database after a restart.
import crypto from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, sqlite } from "./db/index.js";
import { gameActions, gamePlayers, games, users, type Game } from "./db/schema.js";
import { getMap } from "./game/maps.js";
import { streamFor } from "./game/rng.js";
import { applyAction, newGame } from "./game/rules.js";
import { chooseAction } from "./game/bot.js";
import { viewFor } from "./game/view.js";
import type { Action, GameEvent, GameState, Seat } from "./game/types.js";

export interface PlayerInfo {
  seat: Seat;
  userId: number;
  name: string;
  isBot: boolean;
}

export interface LiveGame {
  game: Game;
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
    .select({ seat: gamePlayers.seat, userId: gamePlayers.userId, name: users.displayName, isBot: users.isBot })
    .from(gamePlayers)
    .innerJoin(users, eq(users.id, gamePlayers.userId))
    .where(eq(gamePlayers.gameId, gameId))
    .orderBy(asc(gamePlayers.seat))
    .all();
}

/** Replay a game's whole log. */
function replay(game: Game): { state: GameState; actionCount: number } {
  const rows = db.select().from(gameActions).where(eq(gameActions.gameId, game.id)).orderBy(asc(gameActions.seq)).all();
  let state = newGame(game.mapId, game.seatCount);
  for (const row of rows) {
    state = applyAction(state, JSON.parse(row.payload) as Action, streamFor(game.seed, row.seq)).state;
  }
  return { state, actionCount: rows.length };
}

export function loadGame(id: string): LiveGame | null {
  const cached = cache.get(id);
  if (cached) return cached;
  const game = db.select().from(games).where(eq(games.id, id)).get();
  if (!game) return null;
  const players = loadPlayers(id);
  const { state, actionCount } = game.startedAt ? replay(game) : { state: null, actionCount: 0 };
  const live: LiveGame = { game, players, state, actionCount };
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
 * Create a game with the creator in seat 0. With `bots`, every other seat is
 * filled with a computer opponent and the game starts at once.
 */
export function createGame(userId: number, mapId: string, seatCount: number, bots = false): string {
  const map = getMap(mapId);
  if (seatCount < 2 || seatCount > map.seats) throw new Error("bad seat count");
  const id = newGameId();
  const now = Date.now();
  const botIds = bots ? botUserIds(seatCount - 1) : [];
  sqlite.transaction(() => {
    db.insert(games)
      .values({
        id,
        mapId,
        seatCount,
        seed: crypto.randomBytes(16).toString("hex"),
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
        ...(bots ? { startedAt: now, ...summaryOf(newGame(mapId, seatCount)) } : {}),
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
      db.update(games).set({ startedAt: now, updatedAt: now, ...summaryOf(newGame(game.mapId, game.seatCount)) }).where(eq(games.id, id)).run();
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
    for (const l of listeners.get(id) ?? []) l({ game, players: [], state: null, actionCount: 0 }, []);
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
  const { state, events } = applyAction(live.state, action, streamFor(live.game.seed, seq));
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
  const due = live.players.find((p) => p.isBot && chooseAction(viewFor(state, p.seat)) !== null);
  if (!due) return;
  const timer = setTimeout(() => {
    botTimers.delete(id);
    const current = loadGame(id)?.state;
    if (!current) return;
    const choice = chooseAction(viewFor(current, due.seat));
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
  const players = live?.players ?? [];
  const mySeat = players.find((p) => p.userId === userId)?.seat ?? null;
  const s = live?.state;
  let yourMove = false;
  if (s && mySeat !== null && !s.seats[mySeat]?.eliminated) {
    if (s.phase === "planning") yourMove = s.orders[mySeat] === null;
    if (s.phase === "attack") yourMove = s.attackTurn === mySeat;
  }
  return { game: live?.game ?? game, players, mySeat, yourMove };
}

/** Forget cached games: tests and repair scripts that write to the database directly. */
export function clearCache() {
  cache.clear();
}
