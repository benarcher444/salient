// Remove the demo accounts and every game any of them is in. Touches nothing else.
//   npx tsx scripts/unseed.ts
import "../src/env.js";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { gameActions, gamePlayers, games, sessions, users } from "../src/db/schema.js";
import { DEMO_ACCOUNTS } from "./demo.js";

const demo = db.select().from(users).where(inArray(users.email, DEMO_ACCOUNTS.map((a) => a.email))).all();
const ids = demo.map((u) => u.id);
if (ids.length === 0) {
  console.log("No demo accounts.");
  process.exit(0);
}
const gameIds = [...new Set(db.select().from(gamePlayers).where(inArray(gamePlayers.userId, ids)).all().map((p) => p.gameId))];
// A demo account shares a game with a real one only if someone joined a demo
// game by hand. Refuse rather than delete a real player's game. Computer
// opponents don't count: they are in every game against the computer.
const botIds = new Set(db.select({ id: users.id }).from(users).where(eq(users.isBot, true)).all().map((u) => u.id));
// Guests who joined a demo game by its invite link (the guest suite does) go
// with it: they exist only for that game.
const guests = gameIds.length
  ? db.select({ id: users.id }).from(users).where(and(eq(users.isGuest, true), inArray(users.guestGameId, gameIds))).all().map((u) => u.id)
  : [];
const others = gameIds.length
  ? db
      .select()
      .from(gamePlayers)
      .where(inArray(gamePlayers.gameId, gameIds))
      .all()
      .filter((p) => !ids.includes(p.userId) && !botIds.has(p.userId) && !guests.includes(p.userId))
  : [];
if (others.length) {
  console.error(`Refusing: games ${[...new Set(others.map((o) => o.gameId))].join(", ")} include non-demo players.`);
  process.exit(1);
}
if (gameIds.length) {
  db.delete(gameActions).where(inArray(gameActions.gameId, gameIds)).run();
  db.delete(gamePlayers).where(inArray(gamePlayers.gameId, gameIds)).run();
  db.delete(games).where(inArray(games.id, gameIds)).run();
}
for (const id of [...ids, ...guests]) {
  db.delete(sessions).where(eq(sessions.userId, id)).run();
  db.delete(users).where(eq(users.id, id)).run();
}
console.log(`Removed ${ids.length} demo account(s), ${guests.length} guest(s) and ${gameIds.length} game(s).`);
