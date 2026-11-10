// Delete games from the database, for when a rules change leaves old games
// meaningless. A game's players and action log go with it (they cascade).
//   npm run delete-games -- --in-play      every game not yet finished (open or active)
//   npm run delete-games -- <id> [<id>...] those games, whatever their stage
//   add --dry-run to list what would go, and delete nothing
// The server keeps games it has loaded in memory: restart it afterwards
// (systemctl restart salient on the server), or it serves them until then.
import "../src/env.js";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { games, users } from "../src/db/schema.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const inPlay = args.includes("--in-play");
const ids = args.filter((a) => !a.startsWith("--"));
if (!inPlay && ids.length === 0) {
  console.error("Usage: npm run delete-games -- --in-play | <game id>... [--dry-run]");
  process.exit(1);
}

const doomed = db
  .select({ id: games.id, status: games.status, round: games.round, mapId: games.mapId })
  .from(games)
  .where(inPlay ? inArray(games.status, ["open", "active"]) : inArray(games.id, ids))
  .all();
for (const g of doomed) console.log(`  #${g.id}  ${g.status.padEnd(6)}  round ${g.round}  ${g.mapId}`);
if (!doomed.length) console.log("No games match.");
else if (dryRun) console.log(`${doomed.length} game(s) would be deleted (dry run: nothing deleted).`);
else {
  const gone = doomed.map((g) => g.id);
  db.delete(games).where(inArray(games.id, gone)).run();
  // Guests could only reach their one game: they go with it.
  db.delete(users).where(and(eq(users.isGuest, true), inArray(users.guestGameId, gone))).run();
  console.log(`Deleted ${doomed.length} game(s). Restart the server so it forgets them.`);
}
