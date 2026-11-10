// Tables. Games are stored as an event log: `game_actions` is the source of
// truth and the game state is rebuilt by replaying it. The summary columns on
// `games` (status, round, phase, winner) exist only so the lobby can list games
// without replaying each one, and are recomputed from the replay on every
// write, never updated in place.
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  theme: text("theme", { enum: ["auto", "light", "dark"] }).notNull().default("auto"),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedAt: integer("locked_at"),
  /** A computer opponent. Can never sign in; plays through src/game/bot.ts. */
  isBot: integer("is_bot", { mode: "boolean" }).notNull().default(false),
  /**
   * Someone who joined one game through its invite link, with no account:
   * no email of their own, no password, never signs in. Their session may
   * reach that one game (`guest_game_id`) and nothing else; see src/guest.ts.
   */
  isGuest: integer("is_guest", { mode: "boolean" }).notNull().default(false),
  guestGameId: text("guest_game_id"),
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    /** sha256 of the cookie token, so a leaked database cannot be replayed as sessions. */
    id: text("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("sessions_user").on(t.userId)],
);

export const games = sqliteTable("games", {
  id: text("id").primaryKey(),
  mapId: text("map_id").notNull(),
  seatCount: integer("seat_count").notNull(),
  /** Seeds every die roll; see src/game/rng.ts. */
  seed: text("seed").notNull(),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: integer("created_at").notNull(),
  startedAt: integer("started_at"),
  // Derived summary, rebuilt from the action log on every write.
  status: text("status", { enum: ["open", "active", "over"] }).notNull().default("open"),
  round: integer("round").notNull().default(1),
  phase: text("phase").notNull().default("planning"),
  winnerSeat: integer("winner_seat"),
  updatedAt: integer("updated_at").notNull(),
  /**
   * The map as it was when the game was created, as JSON. A game replays its
   * log against this copy, so editing (or deleting) a map afterwards can never
   * change a game already played on it. Null for games from before map
   * snapshots, which use the built-in map named by map_id.
   */
  mapData: text("map_data"),
  /**
   * The tuning (tuning/*.json: unit stats and rule numbers) as it was when the
   * game was created, as JSON, for the same reason: the log replays under the
   * numbers it was played with. Null for older games, which use the files.
   */
  rulesData: text("rules_data"),
  /**
   * The secret in this game's invite link (/g/<id>/invite/<token>), which
   * lets someone without an account take an open seat as a guest. Made when
   * first shown; replacing it kills every older link.
   */
  inviteToken: text("invite_token"),
});

/** Maps people have made in the editor. `data` is the MapDef as JSON. */
export const maps = sqliteTable(
  "maps",
  {
    id: text("id").primaryKey(),
    ownerId: integer("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    data: text("data").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("maps_owner").on(t.ownerId)],
);

export type SavedMap = typeof maps.$inferSelect;

export const gamePlayers = sqliteTable(
  "game_players",
  {
    gameId: text("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    seat: integer("seat").notNull(),
    userId: integer("user_id").notNull().references(() => users.id),
    joinedAt: integer("joined_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.seat] }), uniqueIndex("game_players_user").on(t.gameId, t.userId)],
);

export const gameActions = sqliteTable(
  "game_actions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    gameId: text("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    /** 0-based position in this game's log. Also picks the action's dice stream. */
    seq: integer("seq").notNull(),
    seat: integer("seat").notNull(),
    userId: integer("user_id").notNull().references(() => users.id),
    /** The Action, as JSON. */
    payload: text("payload").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("game_actions_seq").on(t.gameId, t.seq)],
);

export type User = typeof users.$inferSelect;
export type Game = typeof games.$inferSelect;
export type GamePlayer = typeof gamePlayers.$inferSelect;
